import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyAdminRequest } from '../../../../../lib/adminAuth';
import { canonicalGet, canonicalRpc } from '../../../../../lib/canonicalStore';

/**
 * POST /api/store/review/suggest — Claude-powered first pass over the review
 * queue.
 *
 * Two modes, one endpoint:
 *   { }              — suggest: dedupe the queue into distinct raw make/model
 *                      strings, send them + the existing buckets to Claude, and
 *                      return proposed assignments (existing bucket, new bucket
 *                      with real-world production years, or skip). Nothing is
 *                      written.
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
const BATCH_SIZE = 35;
const BATCH_CONCURRENCY = 3;

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
    if (r.raw_title && g.sample_titles.length < 3) g.sample_titles.push(r.raw_title);
  }

  const groupList = [...groups.values()].map((g) => ({
    ...g,
    years: [...g.years].sort(),
  }));
  if (groupList.length === 0) {
    return NextResponse.json({ success: true, groups: [], buckets_to_create: [], message: 'Nothing in the queue with a raw make/model to suggest on' });
  }

  const bucketLines = buckets.rows.map((b) =>
    `${b.id} | ${b.make} ${b.model}${b.generation ? ` (${b.generation})` : ''}${b.year_min || b.year_max ? ` ${b.year_min ?? '?'}-${b.year_max ?? '?'}` : ''}`
  );

  const batches = [];
  for (let i = 0; i < groupList.length; i += BATCH_SIZE) {
    batches.push(groupList.slice(i, i + BATCH_SIZE));
  }

  const client = new Anthropic();
  const results = new Array(batches.length);
  let nextBatch = 0;
  const worker = async () => {
    while (nextBatch < batches.length) {
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

  const failures = results.filter((r) => r.error);
  if (failures.length === results.length) {
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
  for (const r of results) {
    for (const b of r.buckets_to_create || []) {
      if (!bucketsToCreate.has(b.key)) bucketsToCreate.set(b.key, b);
    }
  }

  const suggestions = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const warnings = [];
  results.forEach((r, idx) => {
    if (r.error) return;
    if (r.warning) warnings.push(r.warning);
    if (r.usage) {
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
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
      `${failures.length} of ${results.length} batches failed (${failures[0].error.message}) — the strings they covered stay in the queue; run AI suggest again for them`
    );
  }

  return NextResponse.json({
    success: true,
    groups: suggestions,
    buckets_to_create: [...bucketsToCreate.values()],
    usage,
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

  const prompt = `You are organizing a canonical auction database for collector cars. Each "bucket" is one canonical vehicle (make + model, optionally a generation and its production year range) that groups auction listings for price-history analysis.

Below are (A) the existing buckets and (B) raw make/model strings from auction listings that matched no bucket. For each raw string, decide:
- action "existing": it belongs in one of the existing buckets (set bucket_id to that bucket's id).
- action "new": propose a bucket for it (add the bucket to buckets_to_create and set new_bucket_key). REUSE the same key across raw strings that describe the same vehicle, so e.g. "Porsche 997 911 Turbo" and "2011 Porsche 911 Turbo S" share one bucket.
- action "skip": not a bucketable production vehicle (one-off replicas, kit cars with no model identity, wheels/parts, unidentifiable strings).

Rules for new buckets:
- make/model must be clean: no year prefixes, no duplicated make in the model ("Volkswagen Vanagon" -> make "Volkswagen", model "Vanagon"), no generation ranges in the model name.
- Set generation only when the raw string clearly identifies one (chassis/generation codes like 964, 997, 986, W126, R107, E30, C3, Mk1, N50/N60/N70, or an explicit "(1st Generation)" style tag).
- year_min/year_max are the REAL-WORLD production years of that model (or that generation when set), from your automotive knowledge — not the auction years. Use null for year_max if still in production; use null for both only if genuinely unknown.
- Prefer generation-level buckets when the raw string encodes a generation; otherwise model-level buckets spanning the model's full production run.
- Confidence: "high" when the mapping is unambiguous, "medium" when reasonable but debatable (e.g. generation inferred), "low" when guessing.

(A) EXISTING BUCKETS (id | name):
${bucketLines.join('\n') || '(none yet)'}

(B) RAW STRINGS TO CLASSIFY:
${groupLines.join('\n')}

Return one assignment per numbered raw string.`;

  const stream = client.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });
  const response = await stream.finalMessage();
  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };

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

  // Create each proposed bucket exactly once, mapping key -> id.
  const keyToId = {};
  for (const b of bucketDefs) {
    if (!b.key || !b.make || !b.model) continue;
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
  for (const a of assignments) {
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
  });
}
