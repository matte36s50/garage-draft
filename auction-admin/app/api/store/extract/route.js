import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyAdminRequest } from '../../../../lib/adminAuth';
import { normalizeCategory, normalizeFeeSchedule } from '../../../../lib/feeSchedule';

/**
 * POST /api/store/extract — Claude-powered lot extraction for the Live Entry
 * tab. Paste an auction-house catalog or results page (URL or raw text) and
 * get back structured lots ready to stage/import.
 *
 * Body: { url?, text?, mode: 'estimate' | 'result' }
 *   mode 'estimate' — pre-auction catalog: lots with estimate ranges
 *   mode 'result'   — post-auction results: lots with prices/outcomes
 *
 * Returns: { event: {name, house, location, buyer_premium_pct, fee_schedule}, lots: [...] }
 * fee_schedule is the house's buyer-premium table (tiered, per lot category)
 * in the shape lib/feeSchedule.js defines, when the page states one.
 * Nothing is written to the store here — the UI stages the rows for review
 * and imports them through /api/store/entry.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */

export const maxDuration = 300; // the platform ceiling; a run must finish inside it

const MAX_INPUT_CHARS = 400_000; // ~100K tokens of page text, well within 1M context

// One Claude call per slice of the page, a few slices in flight at a time.
// A single call over a whole catalog (Mecum Monterey and friends run to
// hundreds of lots) spends minutes writing one long JSON document and ran past
// the 300s ceiling — the function was killed mid-flight and the browser got a
// 504 with nothing to show for the wait. Slices finish in about the time of one
// short call each, and whatever has come back is returned even if the rest
// doesn't make it.
const CHUNK_CHARS = Number(process.env.EXTRACT_CHUNK_CHARS || 45_000);
const CHUNK_OVERLAP_CHARS = 1_200; // so a lot straddling a slice boundary survives
const CHUNK_CONCURRENCY = Number(process.env.EXTRACT_CONCURRENCY || 4);

// A deadline, not just a limit: once it passes, workers stop picking up slices
// and the run returns what it has. It sits under maxDuration so the response is
// always a real answer rather than a gateway timeout.
const RUN_BUDGET_MS = Number(process.env.EXTRACT_BUDGET_MS || 230_000);

// Extraction is mechanical — copying printed numbers into fields — so it runs
// at medium effort. Both are env-overridable to retune without a deploy.
const MODEL = process.env.EXTRACT_MODEL || 'claude-opus-4-8';
const EFFORT = process.env.EXTRACT_EFFORT || 'medium';

// Per slice, not per page: ~45K chars of catalog is well under 200 lots and
// each lot is a short JSON object.
const MAX_TOKENS_PER_CHUNK = 16_000;

// Don't start a slice with less than this left on the clock.
const MIN_SLICE_MS = 20_000;

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    event: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'], description: "Event/sale name, e.g. 'Amelia Island 2026'" },
        house: { type: ['string', 'null'], description: "Auction house, e.g. 'RM Sotheby's', 'Gooding & Company', 'Mecum'" },
        location: { type: ['string', 'null'] },
        buyer_premium_pct: {
          type: ['number', 'null'],
          description: 'Buyer premium percentage when the house charges one flat rate, e.g. 12. Null when the fees are tiered — use fee_categories for those.',
        },
        fee_categories: {
          type: ['array', 'null'],
          description: 'Buyer premium fee table when the page states one, one entry per lot category.',
          items: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                description: "Lot category the rates apply to: 'cars', 'motorcycles', 'automobilia', or 'default' when the table is not split by category",
              },
              mode: {
                type: 'string',
                description: "'marginal' when each rate applies only to the slice of the hammer price in its band (\"12% up to $250,000, 10% on any balance over\" — the usual wording); 'bracket' when the whole hammer price takes the rate of the band it falls in",
              },
              tiers: {
                type: 'array',
                description: 'Rate bands in ascending order. A flat rate is a single band with up_to null.',
                items: {
                  type: 'object',
                  properties: {
                    up_to: { type: ['number', 'null'], description: 'Top of this band in the catalog currency; null for the open-ended top band' },
                    pct: { type: 'number', description: 'Premium percentage for this band, e.g. 12' },
                  },
                  required: ['up_to', 'pct'],
                  additionalProperties: false,
                },
              },
            },
            required: ['category', 'mode', 'tiers'],
            additionalProperties: false,
          },
        },
      },
      required: ['name', 'house', 'location', 'buyer_premium_pct', 'fee_categories'],
      additionalProperties: false,
    },
    lots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lot: { type: ['string', 'null'], description: 'Lot number as printed' },
          year: { type: ['integer', 'null'] },
          make: { type: ['string', 'null'] },
          model: { type: ['string', 'null'], description: 'Model without make or year' },
          trim: { type: ['string', 'null'] },
          estimate_low: { type: ['number', 'null'], description: 'Low catalog estimate, numeric' },
          estimate_high: { type: ['number', 'null'], description: 'High catalog estimate, numeric' },
          price: { type: ['number', 'null'], description: 'Result amount: hammer/sold price, or high bid for not-sold lots' },
          outcome: { type: ['string', 'null'], description: "One of 'sold', 'reserve_not_met', 'withdrawn'; null if the lot has not run yet" },
          currency: { type: ['string', 'null'], description: 'ISO code like USD, EUR, GBP if stated' },
        },
        required: ['lot', 'year', 'make', 'model', 'trim', 'estimate_low', 'estimate_high', 'price', 'outcome', 'currency'],
        additionalProperties: false,
      },
    },
  },
  required: ['event', 'lots'],
  additionalProperties: false,
};

function blockedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 'Invalid URL';
  }
  if (!['http:', 'https:'].includes(u.protocol)) return 'Only http(s) URLs are supported';
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]' || host.startsWith('fd') || host.startsWith('fe80')
  ) {
    return 'URL host not allowed';
  }
  return null;
}

function looksLikeHtml(s) {
  const head = s.slice(0, 5000);
  if (/^\s*(<!doctype\s|<html[\s>])/i.test(head)) return true;
  const tags = head.match(/<[a-z][a-z0-9-]*[\s/>]/gi);
  return tags !== null && tags.length >= 5;
}

function htmlToText(html) {
  // Client-rendered catalogs (RM Sotheby's, other Next.js sites) carry the lot
  // data in JSON data islands rather than markup. Pull those out before the
  // <script> strip below, and append them after the visible text so real
  // markup wins the MAX_INPUT_CHARS truncation when both are present.
  const dataBlobs = [];
  const jsonScriptRe = /<script\b[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m; (m = jsonScriptRe.exec(html)); ) {
    const blob = m[1].trim();
    if (blob.length > 2) dataBlobs.push(blob);
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
  return dataBlobs.length
    ? `${text}\n\nEMBEDDED PAGE DATA (JSON):\n${dataBlobs.join('\n')}`
    : text;
}

/**
 * Split page text into slices of at most `size` chars, breaking on line
 * boundaries and overlapping slightly so a lot whose block spans a boundary is
 * seen whole by at least one slice. Duplicates from the overlap are merged by
 * mergeLots below.
 */
function splitChunks(text, size) {
  if (text.length <= size) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const brk = text.lastIndexOf('\n', end);
      if (brk > start + size / 2) end = brk;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
  }
  return chunks;
}

const lotKey = (l) => [l.lot, l.year, l.make, l.model, l.trim]
  .map((v) => String(v ?? '').trim().toLowerCase()).join('|');

/**
 * Fold per-slice lots into one list. The overlap between slices means the same
 * lot can come back twice — and a lot cut in half by a boundary can come back
 * once with its estimates and once without, so duplicates fill each other's
 * gaps rather than the first copy simply winning.
 */
function mergeLots(perChunk) {
  const byKey = new Map();
  for (const lots of perChunk) {
    for (const lot of lots) {
      const key = lotKey(lot);
      const seen = byKey.get(key);
      if (!seen) { byKey.set(key, { ...lot }); continue; }
      for (const [field, value] of Object.entries(lot)) {
        if (seen[field] === null || seen[field] === undefined) seen[field] = value;
      }
    }
  }
  return [...byKey.values()];
}

// Event details usually sit in the page header, so the first slice that names
// them wins; later slices only fill in what is still missing.
function mergeEvent(perChunk) {
  const event = {};
  for (const ev of perChunk) {
    for (const [field, value] of Object.entries(ev || {})) {
      if (value !== null && value !== undefined && event[field] === undefined) event[field] = value;
    }
  }
  return event;
}

/** One Claude call over one slice. Returns { event, lots } or throws. */
async function extractChunk(client, prompt, signal) {
  // Stream + finalMessage(): large max_tokens requires streaming (the SDK
  // rejects long non-streaming requests to avoid HTTP timeouts). The signal is
  // the hard stop — a call still running at the deadline is cut so the route
  // answers with the slices that did land instead of being killed at 300s.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS_PER_CHUNK,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  }, { signal });
  const response = await stream.finalMessage();

  // Carry the status these two used to answer with, for the case where they
  // sink the whole run rather than one slice of it.
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('Extraction was declined for this content'), { status: 422 });
  }
  if (response.stop_reason === 'max_tokens') {
    throw Object.assign(
      new Error('A slice of the page held more lots than one pass can return — paste a smaller section'),
      { status: 422 }
    );
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No extraction output returned');
  const data = JSON.parse(text);
  return {
    event: data.event || {},
    lots: data.lots || [],
    usage: response.usage,
  };
}

/**
 * Run the slices with a bounded number of calls in flight and a wall-clock
 * deadline. Workers that find the deadline passed stop taking new slices, so
 * the run returns partial results instead of being killed by the platform.
 */
async function runChunks(chunks, buildPrompt, deadline) {
  const client = new Anthropic();
  const results = new Array(chunks.length).fill(null); // by slice, so lots stay in page order
  const failures = [];
  let next = 0;
  let attempted = 0;

  const worker = async () => {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_SLICE_MS) return; // no point starting one that cannot land
      const i = next++;
      if (i >= chunks.length) return;
      attempted += 1;
      try {
        results[i] = await extractChunk(
          client,
          buildPrompt(chunks[i], i, chunks.length),
          AbortSignal.timeout(remaining)
        );
      } catch (e) {
        failures.push({ chunk: i, error: e });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker)
  );
  return { done: results.filter(Boolean), failures, attempted };
}

export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'AI extraction not configured (set ANTHROPIC_API_KEY in Vercel, then redeploy)' },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mode = body.mode === 'estimate' ? 'estimate' : 'result';
  let pageText = (body.text || '').trim();
  if (pageText && looksLikeHtml(pageText)) {
    pageText = htmlToText(pageText);
  }

  if (!pageText && body.url) {
    const blocked = blockedUrl(body.url);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
    try {
      const resp = await fetch(body.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        return NextResponse.json({ error: `Could not fetch page: HTTP ${resp.status}` }, { status: 502 });
      }
      pageText = htmlToText(await resp.text());
    } catch (e) {
      return NextResponse.json({ error: `Could not fetch page: ${e.message}` }, { status: 502 });
    }
  }

  if (!pageText) {
    return NextResponse.json({ error: 'Provide url or text' }, { status: 400 });
  }
  pageText = pageText.slice(0, MAX_INPUT_CHARS);

  const modeInstructions = mode === 'estimate'
    ? `This is a PRE-AUCTION catalog page. Extract every vehicle lot with its catalog estimate range
(estimate_low / estimate_high). Lots have not run yet, so price and outcome must be null.`
    : `This is a POST-AUCTION results page. Extract every vehicle lot with its result:
price (the sold/hammer amount, or the high bid for lots that did not sell) and outcome
('sold', 'reserve_not_met', or 'withdrawn'). Include estimates too when the page shows them.`;

  const chunks = splitChunks(pageText, CHUNK_CHARS);

  const buildPrompt = (chunk, i, total) => `Extract auction lot data from the following auction-house page text.

${modeInstructions}

Rules:
- One entry per vehicle lot. Skip automobilia/memorabilia unless it is a vehicle.
- Amounts are plain numbers (no currency symbols or separators). "$1,215,000" -> 1215000.
  "Est. $150,000 - $200,000" -> estimate_low 150000, estimate_high 200000.
- year/make/model split: "1962 Ferrari 250 GT SWB Berlinetta" -> year 1962, make "Ferrari",
  model "250 GT SWB", trim "Berlinetta" (trim only when clearly separable, else null).
- Detect the event name, auction house, location, and the buyer premium when stated.
  Houses usually publish a fee table rather than one rate — put it in fee_categories,
  one entry per lot category, and leave buyer_premium_pct null. For example
  "Cars: 12% on a hammer price up to $250,000, 10% on any balance over $250,000.
  Motorcycles: 20% on the total hammer price" becomes
  [{category:'cars', mode:'marginal', tiers:[{up_to:250000,pct:12},{up_to:null,pct:10}]},
   {category:'motorcycles', mode:'marginal', tiers:[{up_to:null,pct:20}]}].
  Only use mode 'bracket' when the page says the rate applies to the whole hammer price
  once it passes a threshold. If no fee table is on the page, fee_categories is null.
- If a value is not on the page, use null. Never guess amounts.
- The text may end with an "EMBEDDED PAGE DATA (JSON)" section (the page's data payload).
  Lots that appear only there count the same as lots in the visible text — but never
  double-count a lot present in both.
${total > 1 ? `- This is slice ${i + 1} of ${total} of one long page, so it may start or end mid-lot
  and mid-sentence, and the event header and fee table may sit in another slice.
  Extract only the lots in this slice; skip a lot whose year/make/model is cut off.
  Leave any event field this slice does not state as null.
` : ''}
PAGE TEXT:
${chunk}`;

  const deadline = Date.now() + RUN_BUDGET_MS;
  let done;
  let failures;
  let attempted;
  try {
    ({ done, failures, attempted } = await runChunks(chunks, buildPrompt, deadline));
  } catch (error) {
    return anthropicError(error);
  }

  // Nothing came back at all: report the first failure with its own status
  // rather than an empty success.
  if (!done.length) {
    const real = failures.find((f) => !isAbort(f.error));
    if (real) return anthropicError(real.error);
    return NextResponse.json(
      { error: 'Extraction ran out of time before finishing a single slice — paste a smaller section of the page' },
      { status: 504 }
    );
  }

  const VALID_OUTCOMES = new Set(['sold', 'reserve_not_met', 'withdrawn']);
  const lots = mergeLots(done.map((d) => d.lots)).map((l) => ({
    ...l,
    outcome: VALID_OUTCOMES.has(l.outcome) ? l.outcome : null,
  }));

  // Fold the extracted fee table into the canonical schedule shape the entry
  // route and the panel share. A malformed table is dropped rather than
  // failing the whole extraction — the admin can still type the tiers in.
  const event = mergeEvent(done.map((d) => d.event));
  let feeSchedule = null;
  try {
    const categories = {};
    for (const c of event.fee_categories || []) {
      categories[normalizeCategory(c.category)] = { mode: c.mode, tiers: c.tiers };
    }
    feeSchedule = Object.keys(categories).length
      ? normalizeFeeSchedule({ categories })
      : normalizeFeeSchedule(event.buyer_premium_pct);
  } catch {
    feeSchedule = null;
  }
  delete event.fee_categories;
  event.fee_schedule = feeSchedule;

  // Say plainly when the page was only partly read, so a short lot list is not
  // mistaken for the whole catalog.
  const missed = chunks.length - done.length;
  const ranOut = attempted < chunks.length || failures.some((f) => isAbort(f.error));
  const realFailure = failures.find((f) => !isAbort(f.error));
  const note = missed > 0
    ? `Read ${done.length} of ${chunks.length} slices of the page`
      + (ranOut ? ' before the time budget ran out' : '')
      + (realFailure ? ` (a slice failed: ${realFailure.error.message})` : '')
      + '. Import these, then paste the rest of the page and extract again.'
    : null;

  return NextResponse.json({
    success: true,
    mode,
    event,
    lots,
    partial: missed > 0,
    note,
    chunks: { total: chunks.length, read: done.length, failed: failures.length },
    usage: {
      input_tokens: done.reduce((n, d) => n + (d.usage?.input_tokens || 0), 0),
      output_tokens: done.reduce((n, d) => n + (d.usage?.output_tokens || 0), 0),
    },
  });
}

const isAbort = (error) => error instanceof Anthropic.APIUserAbortError
  || error?.name === 'TimeoutError' || error?.name === 'AbortError';

// Map an SDK error onto the response the panel shows.
function anthropicError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is invalid' }, { status: 503 });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return NextResponse.json({ error: 'Claude API rate limited — try again shortly' }, { status: 429 });
  }
  if (error instanceof Anthropic.APIError) {
    return NextResponse.json({ error: `Claude API error: ${error.message}` }, { status: 502 });
  }
  if (typeof error?.status === 'number') {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}
