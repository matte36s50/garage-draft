#!/usr/bin/env node
/**
 * Extractor comparison: reads one auction catalogue the way the catalogue watch
 * does, sends the same text through the Live Entry extractor once per model
 * setting, and reports every lot where the settings disagree, with what each
 * run cost. Use it before changing the extractor's default model or effort.
 *
 * Writes nothing: no store writes, no watch state. The only side effect is
 * the Claude spend for the extraction calls, shown in the report.
 *
 * Runs from .github/workflows/extract-compare.yml: by manual dispatch, or by a
 * push to a claude/extract-compare/* branch that changes
 * .github/extract-compare.json (the comparisons to run). A push run posts the
 * report as a comment on the commit that asked for it.
 *
 *   node scripts/extract-compare.mjs --house rm --url <catalogue url> \
 *     --mode result|estimate \
 *     [--models claude-opus-4-8:medium,claude-sonnet-5:low] [--max-lots 100]
 *
 * The first setting is the baseline the others are compared against.
 *
 * Environment: CATALOGUE_WATCH_APP_URL and CRON_SECRET, as for the watch;
 * COMPARE_REPORT, a file the report is also appended to (the workflow posts it).
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { HOUSES, estimatesOnly } from '../lib/catalogueWatch.js';
import { CHROME_UA } from './probe-lib.mjs';
import { costOf, extract, readCatalogue, segments } from './catalogue-watch.mjs';

// Fields where any disagreement changes a recorded figure or outcome.
const FIGURE_FIELDS = ['lot', 'year', 'estimate_low', 'estimate_high', 'price', 'outcome', 'currency'];
// Fields where a disagreement changes how a car is named, not what it made.
const NAME_FIELDS = ['make', 'model', 'trim'];

function parseArgs(argv) {
  const args = { models: 'claude-opus-4-8:medium,claude-sonnet-5:low', maxLots: 100 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--house') { args.house = value; i++; }
    else if (flag === '--url') { args.url = value; i++; }
    else if (flag === '--mode') { args.mode = value; i++; }
    else if (flag === '--models') { args.models = value; i++; }
    else if (flag === '--max-lots') { args.maxLots = Number(value); i++; }
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!HOUSES[args.house]) throw new Error(`--house must be one of: ${Object.keys(HOUSES).join(', ')}`);
  if (!args.url) throw new Error('--url (the catalogue) is required');
  if (!['estimate', 'result'].includes(args.mode)) throw new Error('--mode must be estimate or result');
  args.settings = args.models.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [model, effort] = s.split(':');
    return effort ? { model, effort } : { model };
  });
  if (args.settings.length < 2) throw new Error('--models needs at least two settings to compare');
  if (!(args.maxLots > 0)) throw new Error('--max-lots must be a positive number');
  return args;
}

const label = (s) => (s.effort ? `${s.model} (${s.effort})` : s.model);

// A lot's own page link identifies it, as in the watch; the lot number and
// year/make stand in when a run left the link out.
const keyOf = (l) => (l.lot_url ? String(l.lot_url).trim() : `lot ${l.lot ?? '?'} · ${l.year ?? ''} ${l.make ?? ''}`.trim());

const norm = (v) => (v == null ? null : String(v).trim().replace(/\s+/g, ' ').toLowerCase());
const sameFigure = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return norm(a) === norm(b);
};

/** Every disagreement between a baseline lot list and a challenger's. */
export function diffLots(baseLots, otherLots) {
  const base = new Map(baseLots.map((l) => [keyOf(l), l]));
  const other = new Map(otherLots.map((l) => [keyOf(l), l]));
  const figures = [];
  const names = [];
  const onlyBase = [];
  const onlyOther = [];
  for (const [key, b] of base) {
    const o = other.get(key);
    if (!o) { onlyBase.push(b); continue; }
    for (const f of FIGURE_FIELDS) if (!sameFigure(b[f], o[f])) figures.push({ lot: b, field: f, base: b[f], other: o[f] });
    for (const f of NAME_FIELDS) if (norm(b[f]) !== norm(o[f])) names.push({ lot: b, field: f, base: b[f], other: o[f] });
  }
  for (const [key, o] of other) if (!base.has(key)) onlyOther.push(o);
  return { figures, names, onlyBase, onlyOther };
}

const describe = (l) => `${l.lot != null ? `Lot ${l.lot}: ` : ''}${[l.year, l.make, l.model].filter(Boolean).join(' ') || '(unnamed)'}`;
const show = (v) => (v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
const money = (c) => (c == null ? 'n/a' : `$${c.toFixed(2)}`);
const pct = (a, b) => (a == null || b == null || !b ? '' : ` (${a <= b ? '−' : '+'}${Math.round(Math.abs(1 - a / b) * 100)}%)`);

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!process.env.CATALOGUE_WATCH_APP_URL || !process.env.CRON_SECRET) {
    throw new Error('CATALOGUE_WATCH_APP_URL and CRON_SECRET must be set: the comparison calls the live extractor');
  }
  const house = HOUSES[args.house];

  const browser = await chromium.launch();
  let cat;
  try {
    const context = await browser.newContext({ userAgent: CHROME_UA, locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    cat = await readCatalogue(await context.newPage(), args.url, house);
  } finally {
    await browser.close();
  }
  if (cat.error || !cat.lots.size) throw new Error(`Catalogue unreadable: ${cat.error || 'no lots on the page'}`);

  // Send what the watch would send: for houses read by estimate only, the
  // lots that show one.
  let segs = [...cat.lots.values()];
  if (house.estimatesOnly) segs = [...segments(estimatesOnly([cat.head, ...segs].join('\n')).text).lots.values()];
  const sent = segs.slice(0, args.maxLots);
  console.log(`${house.name}: ${cat.lots.size} lots on ${cat.pages} page(s); sending ${sent.length} to each setting.`);

  const runs = [];
  for (const s of args.settings) {
    const t0 = Date.now();
    try {
      const got = await extract(cat.head, sent, args.mode, s);
      runs.push({ setting: s, ...got, cost: costOf(got.usage), seconds: (Date.now() - t0) / 1000 });
      console.log(`${label(s)}: ${got.lots.length} lots, ${got.usage.input_tokens} in / ${got.usage.output_tokens} out, ${money(costOf(got.usage))}`);
    } catch (e) {
      runs.push({ setting: s, error: e.message, seconds: (Date.now() - t0) / 1000 });
      console.log(`${label(s)}: failed — ${e.message}`);
    }
  }

  const [baseline, ...challengers] = runs;
  const lines = [
    `## Extractor comparison — ${house.name}, ${args.mode === 'result' ? 'results' : 'estimates'}`,
    '',
    `Catalogue: ${args.url}`,
    `${sent.length} of ${cat.lots.size} lots sent to each setting; the same text every time. Nothing was written to the store.`,
    '',
    '| Setting | Lots back | Input tokens | Output tokens | Cost | Time |',
    '|---|---:|---:|---:|---:|---:|',
    ...runs.map((r) => (r.error
      ? `| ${label(r.setting)} | failed: ${r.error} | | | | ${r.seconds.toFixed(0)}s |`
      : `| ${label(r.setting)}${r === baseline ? ' — baseline' : ''} | ${r.lots.length} | ${r.usage.input_tokens.toLocaleString()} | ${r.usage.output_tokens.toLocaleString()} | ${money(r.cost)}${r === baseline ? '' : pct(r.cost, baseline.cost)} | ${r.seconds.toFixed(0)}s |`)),
  ];

  const failed = runs.some((r) => r.error);
  if (!baseline.error) {
    for (const c of challengers.filter((r) => !r.error)) {
      const d = diffLots(baseline.lots, c.lots);
      const lotsWithFigureDiffs = new Set(d.figures.map((x) => keyOf(x.lot))).size;
      lines.push(
        '',
        `### ${label(c.setting)} vs ${label(baseline.setting)}`,
        '',
        `- Figures (lot, year, estimates, price, outcome, currency): **${lotsWithFigureDiffs === 0 ? 'identical' : `${lotsWithFigureDiffs} lot(s) differ`}**`,
        `- Names (make, model, trim): ${d.names.length === 0 ? 'identical' : `${d.names.length} field(s) differ`}`,
        `- Lots only the baseline found: ${d.onlyBase.length}; only this setting found: ${d.onlyOther.length}`,
      );
      if (d.figures.length) {
        lines.push('', '| Lot | Field | Baseline | This setting |', '|---|---|---|---|',
          ...d.figures.slice(0, 60).map((x) => `| ${describe(x.lot)} | ${x.field} | ${show(x.base)} | ${show(x.other)} |`));
        if (d.figures.length > 60) lines.push(`| … ${d.figures.length - 60} more | | | |`);
      }
      if (d.names.length) {
        lines.push('', '<details><summary>Naming differences</summary>', '', '| Lot | Field | Baseline | This setting |', '|---|---|---|---|',
          ...d.names.slice(0, 40).map((x) => `| ${describe(x.lot)} | ${x.field} | ${show(x.base)} | ${show(x.other)} |`), '', '</details>');
      }
      for (const [title, list] of [['Only the baseline found', d.onlyBase], ['Only this setting found', d.onlyOther]]) {
        if (list.length) lines.push('', `${title}:`, ...list.slice(0, 20).map((l) => `- ${describe(l)}${l.lot_url ? ` (${l.lot_url})` : ''}`));
      }
    }
  }

  writeReport(lines.join('\n'));
  return failed ? 1 : 0;
}

function writeReport(report) {
  console.log(`\n${report}`);
  for (const file of [process.env.GITHUB_STEP_SUMMARY, process.env.COMPARE_REPORT]) {
    if (file) appendFileSync(file, `${report}\n\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((e) => {
    writeReport(`## Extractor comparison failed\n\n${process.argv.slice(2).join(' ')}\n\n${e.message}`);
    process.exit(1);
  });
}
