import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../../lib/canonicalStore';
import { automobiliaMatch } from '../../../../../lib/automobilia';

/**
 * POST /api/store/review/suggest — Claude-powered first pass over the review
 * queue.
 *
 * Two modes, one endpoint:
 *   { }              — suggest: dedupe the queue into distinct raw make/model
 *                      strings, send them + the existing buckets to Claude, and
 *                      return proposed assignments (existing bucket, new bucket
 *                      with real-world production years, or skip). Nothing is
 *                      written. Bounded work per run (MAX_GROUPS_PER_RUN, plus
 *                      a RUN_BUDGET_MS deadline): a request that outlives the
 *                      platform's execution limit is killed with nothing to
 *                      show for it, so a run returns a slice and reports how
 *                      many strings are left in `remaining`. Busiest strings
 *                      go first. Press the button again for the next slice.
 *   { apply: true,   — apply: create the (possibly user-edited) new buckets
 *     buckets, ...}    once each, then register each approved assignment via
 *                      auction_add_model_alias — the same RPCs the manual
 *                      Assign buttons use.
 *
 * Requires ANTHROPIC_API_KEY (same key as /api/store/extract).
 */

export const maxDuration = 300;

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    buckets_to_create: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: "Stable slug referenced by assignments, e.g. 'porsche-911-964'. Reuse the same key for every raw string that belongs to this vehicle." },
          make: { type: 'string', description: "Clean manufacturer name, e.g. 'Porsche'" },
          model: { type: 'string', description: "Clean model name without make, year, or generation suffixes, e.g. '911'" },
          generation: { type: ['string', 'null'], description: "Generation code only when the raw strings identify one (964, 997, W126, C3, Mk1...), else null" },
          year_min: { type: ['integer', 'null'], description: 'First model year this model/generation was actually produced (real-world knowledge)' },
          year_max: { type: ['integer', 'null'], description: 'Last model year produced; null if still in production' },
        },
        required: ['key', 'make', 'model', 'generation', 'year_min', 'year_max'],
        additionalProperties: false,
      },
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          group_index: { type: 'integer', description: 'Index into the numbered raw-string list from the prompt' },
          action: { type: 'string', description: "'existing' (bucket_id set), 'new' (new_bucket_key set), or 'skip' (not a bucketable vehicle)" },
          bucket_id: { type: ['string', 'null'] },
          new_bucket_key: { type: ['string', 'null'] },
          confidence: { type: 'string', description: "'high', 'medium', or 'low'" },
          note: { type: ['string', 'null'], description: 'Only when helpful — e.g. why skipped or uncertain' },
        },
        required: ['group_index', 'action', 'bucket_id', 'new_bucket_key', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['buckets_to_create', 'assignments'],
  additionalProperties: false,
};

const groupKey = (r) =>
  [r.make, r.model, r.trim].map((s) => (s || '').trim().toLowerCase()).join('|');

// One Claude call per batch of raw strings, a few batches in flight at a time:
// a single call over the whole queue was hitting Vercel's 300s maxDuration.
const BATCH_SIZE = 25;
const BATCH_CONCURRENCY = 3;

// Cost controls. This is bulk classification of short strings against a list
// we hand the model, not open-ended reasoning, so it does not need the top of
// the model range — Sonnet at medium effort matches Opus's answers here at a
// fraction of the price. Both are env-overridable so the tradeoff can be
// retuned without a deploy (SUGGEST_MODEL=claude-haiku-4-5 is the cheapest
// setting; Haiku takes neither thinking nor effort, so those are dropped for
// it automatically).
const MODEL = process.env.SUGGEST_MODEL || 'claude-sonnet-5';
const EFFORT = process.env.SUGGEST_EFFORT || 'medium';
const SUPPORTS_EFFORT = !/^claude-haiku/.test(MODEL);

// Sample titles are the bulkiest per-string input and only need to be long
// enough to spot a generation; two truncated ones carry that.
const MAX_SAMPLE_TITLES = 2;
const MAX_SAMPLE_TITLE_CHARS = 140;

// A run is bounded twice over, because a request that overruns the platform's
// execution limit is killed mid-flight — the browser gets a dead connection
// ("Load failed") and every batch that had already finished is thrown away.
//
//   MAX_GROUPS_PER_RUN — how many distinct raw strings one run will classify.
//     One wave of BATCH_CONCURRENCY batches, so wall time is about one Claude
//     call, whatever the queue's size. What's left is reported back as
//     `remaining`; press the button again for the next slice.
//   RUN_BUDGET_MS — a deadline. Once it passes, workers stop picking up new
//     batches and the run returns what it has. Default sits under the 60s cap
//     that applies on Vercel's Hobby plan; raise it via env on a plan whose
//     functions can run for the declared maxDuration.
const MAX_GROUPS_PER_RUN = Number(process.env.SUGGEST_MAX_GROUPS || 75);
const RUN_BUDGET_MS = Number(process.env.SUGGEST_BUDGET_MS || 45_000);

export async function POST(request) {
  const denied = verifyAdminRequest(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.apply) return apply(body);
  return suggest();
}

// ------------------------------------------------------------------ suggest
async function suggest() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'AI suggestions not configured (set ANTHROPIC_API_KEY in Vercel, then redeploy)' },
      { status: 503 }
    );
  }

  const [queue, buckets] = await Promise.all([
    canonicalGet('auction_listings_all?select=*&needs_review=is.true&order=created_at.asc&limit=200'),
    canonicalGet('auction_buckets?select=*&order=listing_count.desc&limit=1000'),
  ]);
  if (!queue.ok) return NextResponse.json({ error: queue.error }, { status: queue.status });
  if (!buckets.ok) return NextResponse.json({ error: buckets.error }, { status: buckets.status });

  // One suggestion per distinct raw make/model/trim string — assigning a
  // string registers its alias and claims every listing carrying it.
  const groups = new Map();
  for (const r of queue.rows) {
    if (!r.make || !r.model) continue; // no alias key possible; must be handled by hand
    const key = groupKey(r);
    if (!groups.has(key)) {
      groups.set(key, {
        make: r.make, model: r.model, trim: r.trim || null,
        listing_count: 0, years: new Set(), sample_titles: [],
      });
    }
    const g = groups.get(key);
    g.listing_count += 1;
    if (r.year) g.years.add(r.year);
    if (r.raw_title && g.sample_titles.length < MAX_SAMPLE_TITLES) {
      g.sample_titles.push(r.raw_title.slice(0, MAX_SAMPLE_TITLE_CHARS));
    }
  }

  const allGroups = [...groups.values()].map((g) => ({
    ...g,
    years: [...g.years].sort(),
  }));
  if (allGroups.length === 0) {
    return NextResponse.json({ success: true, groups: [], buckets_to_create: [], message: 'Nothing in the queue with a raw make/model to suggest on' });
  }

  // Automobilia never goes to Claude. Posters, badges, literature, wheels and
  // loose engines are not bucketable vehicles, so classifying them is pure
  // spend on an answer we already know — they come back as fixed skips, and
  // apply() refuses them again on the way in.
  const skipped = [];
  const classifiable = [];
  for (const g of allGroups) {
    const hit = automobiliaMatch({ make: g.make, model: g.model, trim: g.trim, titles: g.sample_titles });
    if (hit) {
      skipped.push({
        ...g,
        action: 'skip',
        bucket_id: null,
        new_bucket_key: null,
        confidence: 'high',
        note: `automobilia/parts ("${hit}") — not a vehicle, never bucketed`,
      });
    } else {
      classifiable.push(g);
    }
  }

  // Busiest strings first: if a run only gets through part of the queue, it
  // should be the part that clears the most listings.
  classifiable.sort((a, b) => b.listing_count - a.listing_count);
  const groupList = classifiable.slice(0, MAX_GROUPS_PER_RUN);
  let deferred = classifiable.length - groupList.length;

  if (groupList.length === 0) {
    return NextResponse.json({
      success: true,
      groups: skipped,
      buckets_to_create: [],
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      remaining: 0,
      message: 'Everything left in the queue is automobilia — nothing to classify',
    });
  }

  // Sorted by id, not by listing_count: this list is the cached prompt prefix
  // (see suggestBatch) and prompt caching is a byte-exact prefix match, so an
  // ordering that shifts as listings get claimed would invalidate the cache on
  // every run.
  const bucketLines = buckets.rows
    .map((b) =>
      `${b.id} | ${b.make} ${b.model}${b.generation ? ` (${b.generation})` : ''}${b.year_min || b.year_max ? ` ${b.year_min ?? '?'}-${b.year_max ?? '?'}` : ''}`
    )
    .sort();

  const batches = [];
  for (let i = 0; i < groupList.length; i += BATCH_SIZE) {
    batches.push(groupList.slice(i, i + BATCH_SIZE));
  }

  // maxRetries 1: the SDK's default of 2 can turn one slow batch into three
  // sequential ones, which is exactly how a run overruns its budget.
  const client = new Anthropic({ maxRetries: 1 });
  const results = new Array(batches.length);
  const deadline = Date.now() + RUN_BUDGET_MS;
  let nextBatch = 0;
  const worker = async () => {
    while (nextBatch < batches.length) {
      if (Date.now() >= deadline) return;   // hand the rest to the next run
      const idx = nextBatch++;
      try {
        results[idx] = await suggestBatch(client, bucketLines, batches[idx]);
      } catch (error) {
        results[idx] = { error };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, worker)
  );

  // Batches the deadline cut off aren't failures — nothing was asked of Claude
  // and their strings are simply still in the queue.
  const dispatched = [];
  batches.forEach((batch, idx) => {
    if (results[idx]) dispatched.push(idx);
    else deferred += batch.length;
  });
  if (dispatched.length === 0) {
    return NextResponse.json(
      { error: 'Ran out of time before the first batch came back — lower SUGGEST_MAX_GROUPS or raise SUGGEST_BUDGET_MS' },
      { status: 504 }
    );
  }

  const failures = dispatched.map((i) => results[i]).filter((r) => r.error);
  if (failures.length === dispatched.length) {
    // Nothing succeeded — surface the first failure the way single-call mode did.
    const error = failures[0].error;
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

  // Merge the batches. Bucket keys are stable slugs, so two batches proposing
  // the same vehicle collapse into one bucket (first definition wins); apply()
  // already creates each key exactly once.
  const bucketIds = new Set(buckets.rows.map((b) => b.id));
  const bucketsToCreate = new Map();
  for (const i of dispatched) {
    for (const b of results[i].buckets_to_create || []) {
      if (!bucketsToCreate.has(b.key)) bucketsToCreate.set(b.key, b);
    }
  }

  const suggestions = [];
  const usage = {
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  };
  const warnings = [];
  dispatched.forEach((idx) => {
    const r = results[idx];
    if (r.error) return;
    if (r.warning) warnings.push(r.warning);
    if (r.usage) {
      for (const k of Object.keys(usage)) usage[k] += r.usage[k] || 0;
    }
    const batch = batches[idx];
    for (const a of r.assignments || []) {
      const g = batch[a.group_index];
      if (!g) continue;
      const valid =
        (a.action === 'existing' && bucketIds.has(a.bucket_id)) ||
        (a.action === 'new' && bucketsToCreate.has(a.new_bucket_key)) ||
        a.action === 'skip';
      suggestions.push({
        ...g,
        action: valid ? a.action : 'skip',
        bucket_id: a.action === 'existing' ? a.bucket_id : null,
        new_bucket_key: a.action === 'new' ? a.new_bucket_key : null,
        confidence: ['high', 'medium', 'low'].includes(a.confidence) ? a.confidence : 'low',
        note: valid ? a.note : 'AI referenced an unknown bucket — left for manual review',
      });
    }
  });
  if (failures.length > 0) {
    warnings.push(
      `${failures.length} of ${dispatched.length} batches failed (${failures[0].error.message}) — the strings they covered stay in the queue; run AI suggest again for them`
    );
  }
  if (deferred > 0) {
    warnings.push(
      `${deferred} more raw string(s) are still queued — apply these, then run AI suggest again for the next batch`
    );
  }
  if (skipped.length > 0) {
    warnings.push(`${skipped.length} automobilia/parts string(s) skipped without an AI call`);
  }

  return NextResponse.json({
    success: true,
    groups: [...suggestions, ...skipped],
    buckets_to_create: [...bucketsToCreate.values()],
    usage,
    model: MODEL,
    remaining: deferred,
    ...(warnings.length > 0 ? { warning: warnings.join(' · ') } : {}),
  });
}

// One Claude call over one batch of raw strings. group_index in the result is
// relative to the batch. Returns { assignments, buckets_to_create, usage,
// warning? }; abnormal stop reasons drop the batch with a warning instead of
// failing the whole run.
async function suggestBatch(client, bucketLines, batchGroups) {
  const groupLines = batchGroups.map((g, i) =>
    `${i}. make="${g.make}" model="${g.model}"${g.trim ? ` trim="${g.trim}"` : ''} — ${g.listing_count} listing(s), years seen: ${g.years.join(', ') || 'unknown'}, sample titles: ${g.sample_titles.join(' · ') || 'none'}`
  );

  // The prompt is split in two so the bucket list — by far the biggest part of
  // the request, and identical for every batch and every run — can be cached.
  // Everything before the breakpoint must stay byte-identical, so nothing
  // batch-specific may move into `sharedPrompt`.
  const sharedPrompt = `You are organizing a canonical auction database for collector cars. Each "bucket" is one canonical vehicle (make + model, optionally a generation and its production year range) that groups auction listings for price-history analysis.

You will be given (A) the existing buckets and (B) raw make/model strings from auction listings that matched no bucket. For each raw string, decide:
- action "existing": it belongs in one of the existing buckets (set bucket_id to that bucket's id).
- action "new": propose a bucket for it (add the bucket to buckets_to_create and set new_bucket_key). REUSE the same key across raw strings that describe the same vehicle, so e.g. "Porsche 997 911 Turbo" and "2011 Porsche 911 Turbo S" share one bucket.
- action "skip": not a bucketable production vehicle. This always includes automobilia and memorabilia (posters, signs, badges, hood ornaments, gas pumps and globes, literature and brochures, artwork, scale models, trophies, helmets, race suits, watches) and loose parts (wheels, tires, engines, gearboxes, body panels, parts lots) — never assign these to a bucket or invent a bucket for them, whatever make they carry. Also skip one-off replicas, kit cars with no model identity, and unidentifiable strings.

Rules for new buckets:
- make/model must be clean: no year prefixes, no duplicated make in the model ("Volkswagen Vanagon" -> make "Volkswagen", model "Vanagon"), no generation ranges in the model name.
- Set generation only when the raw string clearly identifies one (chassis/generation codes like 964, 997, 986, W126, R107, E30, C3, Mk1, N50/N60/N70, or an explicit "(1st Generation)" style tag).
- year_min/year_max are the REAL-WORLD production years of that model (or that generation when set), from your automotive knowledge — not the auction years. Use null for year_max if still in production; use null for both only if genuinely unknown.
- Prefer generation-level buckets when the raw string encodes a generation; otherwise model-level buckets spanning the model's full production run.
- Confidence: "high" when the mapping is unambiguous, "medium" when reasonable but debatable (e.g. generation inferred), "low" when guessing.

(A) EXISTING BUCKETS (id | name):
${bucketLines.join('\n') || '(none yet)'}`;

  const batchPrompt = `(B) RAW STRINGS TO CLASSIFY:
${groupLines.join('\n')}

Return one assignment per numbered raw string.`;

  // Cap the call itself, not just the run: the run deadline stops workers from
  // starting new batches but cannot claw back one that hangs, and an
  // overrunning request is killed by the platform with nothing returned. A
  // batch that times out throws, is caught per-batch, and its strings stay in
  // the queue for the next run.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    ...(SUPPORTS_EFFORT ? { thinking: { type: 'adaptive' } } : {}),
    output_config: {
      ...(SUPPORTS_EFFORT ? { effort: EFFORT } : {}),
      format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: sharedPrompt, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: batchPrompt },
      ],
    }],
  }, { timeout: RUN_BUDGET_MS });
  const response = await stream.finalMessage();
  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens || 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
  };

  if (response.stop_reason === 'refusal') {
    return { assignments: [], buckets_to_create: [], usage, warning: 'One batch was declined and skipped' };
  }
  if (response.stop_reason === 'max_tokens') {
    return { assignments: [], buckets_to_create: [], usage, warning: 'One batch ran out of output room and was skipped' };
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    return { assignments: [], buckets_to_create: [], usage, warning: 'One batch returned no output and was skipped' };
  }
  const data = JSON.parse(text);
  return {
    assignments: data.assignments || [],
    buckets_to_create: data.buckets_to_create || [],
    usage,
  };
}

// -------------------------------------------------------------------- apply
async function apply(body) {
  const bucketDefs = Array.isArray(body.buckets) ? body.buckets : [];
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  if (assignments.length === 0) {
    return NextResponse.json({ error: 'No assignments to apply' }, { status: 400 });
  }

  // Second automobilia gate. suggest() already filtered these out, but apply()
  // takes its assignments from the request body, so a stale or hand-edited
  // payload could still carry one — drop them here rather than trust the
  // round trip.
  const rejected = [];
  const cleanAssignments = [];
  for (const a of assignments) {
    const hit = automobiliaMatch({ make: a.make, model: a.model, trim: a.trim });
    if (hit) rejected.push(`${a.make || '?'} ${a.model || '?'}: automobilia/parts ("${hit}") — not bucketed`);
    else cleanAssignments.push(a);
  }
  const usedKeys = new Set(cleanAssignments.map((a) => a.new_bucket_key).filter(Boolean));

  // Create each proposed bucket exactly once, mapping key -> id. Buckets whose
  // only claimants were rejected above are not created at all.
  const keyToId = {};
  for (const b of bucketDefs) {
    if (!b.key || !b.make || !b.model || !usedKeys.has(b.key)) continue;
    const res = await canonicalRpc('auction_create_canonical_model', {
      p_make: b.make,
      p_model: b.model,
      p_generation: b.generation || null,
      p_year_min: b.year_min != null && b.year_min !== '' ? parseInt(b.year_min, 10) : null,
      p_year_max: b.year_max != null && b.year_max !== '' ? parseInt(b.year_max, 10) : null,
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Creating bucket "${b.make} ${b.model}" failed: ${res.error}` }, { status: res.status });
    }
    keyToId[b.key] = res.data;
  }

  let aliases = 0;
  let claimed = 0;
  const errors = [];
  for (const a of cleanAssignments) {
    const bucketId = a.bucket_id || keyToId[a.new_bucket_key];
    if (!bucketId || !a.make || !a.model) {
      errors.push(`${a.make || '?'} ${a.model || '?'}: no target bucket`);
      continue;
    }
    const res = await canonicalRpc('auction_add_model_alias', {
      p_make: a.make, p_model: a.model, p_trim: a.trim || null,
      p_canonical_model_id: bucketId,
    });
    if (res.ok) {
      aliases += 1;
      claimed += Number(res.data) || 0;
    } else {
      errors.push(`${a.make} ${a.model}: ${res.error}`);
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    buckets_created: Object.keys(keyToId).length,
    aliases_registered: aliases,
    listings_claimed: claimed,
    errors: errors.slice(0, 10),
    ...(rejected.length > 0 ? { rejected: rejected.slice(0, 10), rejected_count: rejected.length } : {}),
  });
}
