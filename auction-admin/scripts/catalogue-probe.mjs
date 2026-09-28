#!/usr/bin/env node
/**
 * Catalogue readability probe: plain fetch, as the extractor reads a URL.
 *
 * Before scheduling catalogue captures (estimates saved before each sale), find
 * out which auction houses' pages the extractor can read at all. For each
 * target this fetches the page exactly as Live Entry's extractor does
 * (lib/pageText.js), converts it to the text Claude would receive, and reports:
 *
 *   - HTTP status, page size, and the size of the text sent to Claude
 *     (chars, rough tokens, and how many extractor slices that makes);
 *   - how many distinct lot numbers and estimate ranges the text shows;
 *   - signs of a bot wall, a page whose lots load by JavaScript, or pagination;
 *   - for index pages, the catalogue links found on them.
 *
 * A page that is blocked or empty with the extractor's headers is tried once
 * more with fuller browser headers, to see whether that alone fixes it.
 * catalogue-probe-browser.mjs renders the same kinds of pages in a real
 * browser.
 *
 * No Claude calls and no writes: it only reads public pages and prints a
 * report (also to the GitHub Actions job summary when run there).
 *
 *   node scripts/catalogue-probe.mjs            # all targets
 *   node scripts/catalogue-probe.mjs rm mecum   # only these houses
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fetchPage, htmlToText, PAGE_FETCH_HEADERS } from '../lib/pageText.js';
import { CHROME_UA, MAX_INPUT_CHARS, isWall, kb, measure, summaryTable, verdict } from './probe-lib.mjs';

// kind: 'upcoming' (catalogue before the sale), 'past' (after the sale: are the
// estimates still there?), 'index' (a listing of sales: can we find catalogues?)
export const TARGETS = [
  { house: 'rm', name: "RM Sotheby's", label: 'London 2026 (31 Oct)', kind: 'upcoming', url: 'https://rmsothebys.com/auctions/lf26/lots/' },
  { house: 'rm', name: "RM Sotheby's", label: 'Munich 2026 (20 Nov)', kind: 'upcoming', url: 'https://rmsothebys.com/auctions/mu26/lots/' },
  { house: 'rm', name: "RM Sotheby's", label: 'Monterey 2026 (sold)', kind: 'past', url: 'https://rmsothebys.com/auctions/mo26/lots/' },
  { house: 'rm', name: "RM Sotheby's", label: 'Upcoming auctions', kind: 'index', url: 'https://rmsothebys.com/upcoming/' },

  { house: 'gooding', name: "Gooding Christie's", label: 'Rétromobile New York 2026 (19–22 Nov)', kind: 'upcoming', url: 'https://www.goodingco.com/auction/retromobile-new-york-auctions-2026' },
  { house: 'gooding', name: "Gooding Christie's", label: 'Available lots', kind: 'upcoming', url: 'https://www.goodingco.com/lots' },
  { house: 'gooding', name: "Gooding Christie's", label: 'Pebble Beach 2026 (sold)', kind: 'past', url: 'https://www.goodingco.com/auction/pebble-beach-auctions-2026' },
  { house: 'gooding', name: "Gooding Christie's", label: 'Pebble Beach 2026, bidding site (sold)', kind: 'past', url: 'https://bid.goodingco.com/auctions/1-B4OUFM/pebble-beach-auctions-2026' },

  { house: 'broadarrow', name: 'Broad Arrow', label: 'Zoute Concours 2026, bidding site', kind: 'upcoming', url: 'https://bid.broadarrowauctions.com/auctions/1-D1BC37/the-zoute-concours-auction-2026' },
  { house: 'broadarrow', name: 'Broad Arrow', label: 'Available lots', kind: 'upcoming', url: 'https://www.broadarrowauctions.com/vehicles' },
  { house: 'broadarrow', name: 'Broad Arrow', label: 'Quail 2026 lot (sold)', kind: 'past', url: 'https://www.broadarrowauctions.com/vehicles/ql26_r0158/2025-bugatti-w16-mistral' },
  { house: 'broadarrow', name: 'Broad Arrow', label: 'Upcoming auctions, bidding site', kind: 'index', url: 'https://bid.broadarrowauctions.com/' },

  { house: 'bonhams', name: 'Bonhams', label: 'Golden Age of Motoring', kind: 'upcoming', url: 'https://cars.bonhams.com/auction/27524/the-golden-age-of-motoring/' },
  { house: 'bonhams', name: 'Bonhams', label: 'London to Brighton sale (sold)', kind: 'past', url: 'https://www.bonhams.com/auctions/24879/' },
  { house: 'bonhams', name: 'Bonhams', label: 'Bonhams Cars home', kind: 'index', url: 'https://cars.bonhams.com/' },

  { house: 'mecum', name: 'Mecum', label: 'Dallas/Fort Worth 2026', kind: 'upcoming', url: 'https://www.mecum.com/auctions/dallas-fort-worth-2026/lots/' },
  { house: 'mecum', name: 'Mecum', label: 'Kissimmee 2027', kind: 'upcoming', url: 'https://www.mecum.com/auctions/kissimmee-2027/lots/' },
  { house: 'mecum', name: 'Mecum', label: 'Monterey 2026 (sold)', kind: 'past', url: 'https://www.mecum.com/auctions/monterey-2026/lots/' },
  { house: 'mecum', name: 'Mecum', label: 'Auctions', kind: 'index', url: 'https://www.mecum.com/auctions/' },

  { house: 'bj', name: 'Barrett-Jackson', label: 'November Digital Select 2026', kind: 'upcoming', url: 'https://www.barrett-jackson.com/2026-november-digital-select/docket' },
  { house: 'bj', name: 'Barrett-Jackson', label: 'Scottsdale 2027 docket', kind: 'upcoming', url: 'https://www.barrett-jackson.com/2027-scottsdale/docket?type=Vehicles' },
  { house: 'bj', name: 'Barrett-Jackson', label: 'Las Vegas 2026 docket (sold)', kind: 'past', url: 'https://www.barrett-jackson.com/2026-las-vegas/docket?type=Vehicles' },
  { house: 'bj', name: 'Barrett-Jackson', label: 'Auctions', kind: 'index', url: 'https://www.barrett-jackson.com/auctions' },
];

// Fuller headers for a second attempt when the first is blocked or empty.
const BROWSER_HEADERS = {
  ...PAGE_FETCH_HEADERS,
  'User-Agent': CHROME_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

export function catalogueLinks(html, base) {
  const out = new Set();
  const baseHost = new URL(base).hostname.replace(/^(www|bid|cars)\./, '');
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (!u.hostname.endsWith(baseHost)) continue;
    if (!/auction|lots|docket|catalog|vehicles|event|sale/i.test(u.pathname)) continue;
    if (/\.(css|js|png|jpe?g|svg|webp|pdf)$/i.test(u.pathname) || /[{}]|%7B/i.test(u.pathname)) continue;
    out.add(u.origin + u.pathname);
  }
  return [...out].slice(0, 25);
}

async function read(url, headers) {
  const t0 = Date.now();
  let status = 0;
  let finalUrl = url;
  let html = '';
  let error = null;
  try {
    const resp = await fetchPage(url, { headers });
    status = resp.status;
    finalUrl = resp.url;
    html = await resp.text();
  } catch (e) {
    error = e.cause?.code || e.name || String(e);
  }
  const fullText = html ? htmlToText(html) : '';
  const visible = fullText.split('\n\nEMBEDDED PAGE DATA (JSON):\n')[0];
  const m = measure(fullText);
  const wall = isWall(status, visible, html);
  const r = { status, finalUrl, html, error, visible, m, wall, ms: Date.now() - t0 };
  return { ...r, v: verdict(r) };
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = only.length ? TARGETS.filter((t) => only.includes(t.house)) : TARGETS;
  const rows = [];

  for (const t of targets) {
    let r = await read(t.url, PAGE_FETCH_HEADERS);
    let retried = null;
    if (r.wall || r.error || r.v.startsWith('needs a browser')) {
      const again = await read(t.url, BROWSER_HEADERS);
      retried = again.v;
      if (again.v.startsWith('readable')) r = again;
    }
    rows.push({ t, m: r.m, v: r.v });

    const { m } = r;
    console.log(`\n== ${t.name} · ${t.label} [${t.kind}]`);
    console.log(`   ${t.url}${r.finalUrl && r.finalUrl !== t.url ? `\n   -> ${r.finalUrl}` : ''}`);
    console.log(`   ${r.v}`);
    if (retried) console.log(`   retry with browser headers: ${retried}`);
    console.log(`   HTTP ${r.status} · ${kb(Buffer.byteLength(r.html))} html · ${m.textChars.toLocaleString()} chars text`
      + `${m.truncated ? ` (cut to ${MAX_INPUT_CHARS.toLocaleString()})` : ''}`
      + ` · ~${m.tokens.toLocaleString()} tokens · ${m.slices} slice(s) · ${r.ms} ms`);
    console.log(`   lots ${m.lots} · estimate ranges ${m.ranges} · estimate fields ${m.estKeys}`
      + ` · "estimate" ×${m.estimateWord} · "sold" ×${m.sold}`);
    if (m.lotSample) console.log(`   lot sample: ${m.lotSample}`);
    if (m.estSample) console.log(`   estimate sample: ${m.estSample}`);
    if (!m.lotSample && !m.estSample && r.visible) console.log(`   page starts: ${r.visible.slice(0, 300).replace(/\s+/g, ' ')}`);
    if (t.kind === 'index' && r.html) {
      const links = catalogueLinks(r.html, r.finalUrl || t.url);
      console.log(`   catalogue-looking links (${links.length}):`);
      for (const l of links) console.log(`     ${l}`);
    }
  }

  const summary = summaryTable('Catalogue probe: plain fetch (as the extractor reads a URL)', rows);
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

// Run as a script; imported by the browser probe for TARGETS.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
