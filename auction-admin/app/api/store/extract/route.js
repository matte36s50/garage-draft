import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyAdminRequest } from '../../../../lib/adminAuth';

/**
 * POST /api/store/extract — Claude-powered lot extraction for the Live Entry
 * tab. Paste an auction-house catalog or results page (URL or raw text) and
 * get back structured lots ready to stage/import.
 *
 * Body: { url?, text?, mode: 'estimate' | 'result' }
 *   mode 'estimate' — pre-auction catalog: lots with estimate ranges
 *   mode 'result'   — post-auction results: lots with prices/outcomes
 *
 * Returns: { event: {name, house, location, buyer_premium_pct}, lots: [...] }
 * Nothing is written to the store here — the UI stages the rows for review
 * and imports them through /api/store/entry.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */

export const maxDuration = 300; // Claude extraction of a long page can take a while

const MAX_INPUT_CHARS = 400_000; // ~100K tokens of page text, well within 1M context

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    event: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'], description: "Event/sale name, e.g. 'Amelia Island 2026'" },
        house: { type: ['string', 'null'], description: "Auction house, e.g. 'RM Sotheby's', 'Gooding & Company', 'Mecum'" },
        location: { type: ['string', 'null'] },
        buyer_premium_pct: { type: ['number', 'null'], description: 'Buyer premium percentage if stated, e.g. 12' },
      },
      required: ['name', 'house', 'location', 'buyer_premium_pct'],
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

function htmlToText(html) {
  return html
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

  const prompt = `Extract auction lot data from the following auction-house page text.

${modeInstructions}

Rules:
- One entry per vehicle lot. Skip automobilia/memorabilia unless it is a vehicle.
- Amounts are plain numbers (no currency symbols or separators). "$1,215,000" -> 1215000.
  "Est. $150,000 - $200,000" -> estimate_low 150000, estimate_high 200000.
- year/make/model split: "1962 Ferrari 250 GT SWB Berlinetta" -> year 1962, make "Ferrari",
  model "250 GT SWB", trim "Berlinetta" (trim only when clearly separable, else null).
- Detect the event name, auction house, location, and stated buyer premium % when present.
- If a value is not on the page, use null. Never guess amounts.

PAGE TEXT:
${pageText}`;

  try {
    const client = new Anthropic();
    // Stream + finalMessage(): large max_tokens requires streaming (the SDK
    // rejects long non-streaming requests to avoid HTTP timeouts).
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'Extraction was declined for this content' }, { status: 422 });
    }
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json(
        { error: 'Page too large to extract in one pass — paste a smaller section' },
        { status: 422 }
      );
    }

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return NextResponse.json({ error: 'No extraction output returned' }, { status: 502 });
    const data = JSON.parse(text);

    const VALID_OUTCOMES = new Set(['sold', 'reserve_not_met', 'withdrawn']);
    const lots = (data.lots || []).map((l) => ({
      ...l,
      outcome: VALID_OUTCOMES.has(l.outcome) ? l.outcome : null,
    }));

    return NextResponse.json({
      success: true,
      mode,
      event: data.event || {},
      lots,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is invalid' }, { status: 503 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Claude API rate limited — try again shortly' }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error: ${error.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
