#!/usr/bin/env node
/**
 * Catalogue readability probe: headless browser.
 *
 * The plain-fetch probe (catalogue-probe.mjs) found that every house's lot
 * lists load by JavaScript or sit behind a bot wall. This renders the same
 * pages in headless Chromium, scrolls to trigger lazy loading, and reports:
 *
 *   - whether the browser gets past any wall, and what the rendered page
 *     shows: lot numbers, estimate ranges, text size for Claude;
 *   - the JSON the page itself fetches while loading (the site's own lot
 *     feed). A feed that carries lots and estimates can be read directly,
 *     without a browser or Claude, which is the cheapest and most exact
 *     reader when a house has one.
 *
 * No Claude calls and no writes. Needs the playwright package and Chromium,
 * which the Catalogue probe workflow installs for this run only; they are
 * not app dependencies.
 *
 *   node scripts/catalogue-probe-browser.mjs            # all targets
 *   node scripts/catalogue-probe-browser.mjs rm mecum   # only these houses
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { TARGETS } from './catalogue-probe.mjs';
import { CHROME_UA, count, isWall, kb, measure, redactUrl, summaryTable, verdict } from './probe-lib.mjs';

const GOTO_MS = 45_000;
const SCROLLS = 6;

export async function render(browser, url) {
  const context = await browser.newContext({ userAgent: CHROME_UA, locale: 'en-US', viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const feeds = [];
  page.on('response', async (resp) => {
    const type = resp.headers()['content-type'] || '';
    if (!/json/i.test(type)) return;
    let body = '';
    try { body = await resp.text(); } catch { return; }
    feeds.push({
      url: resp.url(),
      status: resp.status(),
      bytes: body.length,
      estimates: count(/estimate/gi, body),
      lots: count(/"lot[_a-z]*"\s*:/gi, body),
    });
  });

  const t0 = Date.now();
  let status = 0;
  let error = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_MS });
    status = resp?.status() ?? 0;
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // A challenge page may clear itself after a few seconds.
    if (isWall(status, await page.innerText('body').catch(() => ''), await page.content())) {
      await page.waitForTimeout(12_000);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      status = 200; // judged again below on what the page now shows
    }
    // Catalogues add lots as you scroll.
    for (let i = 0; i < SCROLLS; i++) {
      await page.mouse.wheel(0, 5000);
      await page.waitForTimeout(1_200);
    }
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  } catch (e) {
    error = e.message.split('\n')[0];
  }
  const html = await page.content().catch(() => '');
  const visible = await page.innerText('body').catch(() => '');
  const title = await page.title().catch(() => '');
  const finalUrl = page.url();
  await context.close();

  const m = measure(visible);
  const wall = isWall(status, visible, html);
  const r = { status, error, wall, visible, m, feeds, title, finalUrl, ms: Date.now() - t0, htmlBytes: Buffer.byteLength(html) };
  return { ...r, v: verdict(r) };
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = TARGETS.filter((t) => t.kind !== 'index' && (!only.length || only.includes(t.house)));
  const browser = await chromium.launch();
  const rows = [];

  for (const t of targets) {
    const r = await render(browser, t.url);
    rows.push({ t, m: r.m, v: r.v });
    const { m } = r;
    console.log(`\n== ${t.name} · ${t.label} [${t.kind}]`);
    console.log(`   ${t.url}${r.finalUrl !== t.url ? `\n   -> ${r.finalUrl}` : ''}`);
    console.log(`   ${r.v}${r.error ? ` (${r.error})` : ''}`);
    console.log(`   title: ${r.title.slice(0, 120)}`);
    console.log(`   rendered ${kb(r.htmlBytes)} html · ${m.textChars.toLocaleString()} chars text`
      + ` · ~${m.tokens.toLocaleString()} tokens · ${m.slices} slice(s) · ${r.ms} ms`);
    console.log(`   lots ${m.lots} · estimate ranges ${m.ranges} · "estimate" ×${m.estimateWord} · "sold" ×${m.sold}`);
    if (m.lotSample) console.log(`   lot sample: ${m.lotSample}`);
    if (m.estSample) console.log(`   estimate sample: ${m.estSample}`);
    if (!m.lotSample && !m.estSample) console.log(`   page starts: ${r.visible.slice(0, 300).replace(/\s+/g, ' ')}`);

    const feeds = r.feeds
      .filter((f) => f.bytes > 500)
      .sort((a, b) => (b.estimates - a.estimates) || (b.lots - a.lots) || (b.bytes - a.bytes))
      .slice(0, 6);
    console.log(`   JSON the page fetched: ${r.feeds.length} response(s)${feeds.length ? ', largest / most relevant:' : ''}`);
    for (const f of feeds) {
      console.log(`     ${f.status} ${kb(f.bytes)} · "estimate" ×${f.estimates} · lot fields ×${f.lots} · ${redactUrl(f.url)}`);
    }
  }
  await browser.close();

  const summary = summaryTable('Catalogue probe: headless browser', rows);
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
