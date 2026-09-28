#!/usr/bin/env node
/**
 * Catalogue readability probe.
 *
 * Before scheduling catalogue captures (estimates saved before each sale), find
 * out which auction houses' pages the extractor can read at all. For each
 * target this fetches the page exactly as Live Entry's extractor does
 * (lib/pageText.js), converts it to the text Claude would receive, and reports:
 *
 *   - HTTP status, page size, and the size of the text sent to Claude
 *     (chars, rough tokens, and how many extractor slices that makes);
 *   - how many distinct lot numbers and estimate ranges the text shows;
 *   - signs of a bot wall, a client-rendered empty shell, or pagination;
 *   - for index pages, the catalogue links found on them.
 *
 * A page that is blocked or empty with the extractor's headers is tried once
 * more with fuller browser headers, to see whether that alone fixes it.
 *
 * No Claude calls and no writes: it only reads public pages and prints a
 * report (also to the GitHub Actions job summary when run there).
 *
 *   node scripts/catalogue-probe.mjs            # all targets
 *   node scripts/catalogue-probe.mjs rm mecum   # only these houses
 */

import { appendFileSync } from 'node:fs';
import { fetchPage, htmlToText, PAGE_FETCH_HEADERS } from '../lib/pageText.js';

// Mirrors app/api/store/extract/route.js.
const MAX_INPUT_CHARS = 400_000;
const CHUNK_CHARS = 45_000;
const CHARS_PER_TOKEN = 3.5; // rough; the real count comes from the API's usage

// kind: 'upcoming' (catalogue before the sale), 'past' (after the sale: are the
// estimates still there?), 'index' (a listing of sales: can we find catalogues?)
const TARGETS = [
  { house: 'rm', name: "RM Sotheby's", label: 'London 2026 (31 Oct)', kind: 'upcoming', url: 'https://rmsothebys.com/auctions/lf26/lots/' },
  { house: 'rm', name: "RM Sotheby's", label: 'Munich 2026 (20 Nov)', kind: 'upcoming', url: 'https://rmsothebys.com/auctions/mu26/lots/' },
  { house: 'rm', name: "RM Sotheby's", label: 'Monterey 2026 (sold)', kind: 'past', url: 'https://rmsothebys.com/auctions/mo26/lots/' },
  { house: 'rm', name: "RM Sotheby's", label: 'Upcoming auctions', kind: 'index', url: 'https://rmsothebys.com/upcoming/' },

  { house: 'gooding', name: "Gooding Christie's", label: 'Rétromobile New York 2026 (19–22 Nov)', kind: 'upcoming', url: 'https://www.goodingco.com/auction/retromobile-new-york-auctions-2026' },
  { house: 'gooding', name: "Gooding Christie's", label: 'All lots', kind: 'upcoming', url: 'https://www.goodingco.com/lots' },
  { house: 'gooding', name: "Gooding Christie's", label: 'Pebble Beach 2026 (sold)', kind: 'past', url: 'https://www.goodingco.com/auction/pebble-beach-auctions-2026' },
  { house: 'gooding', name: "Gooding Christie's", label: 'Pebble Beach 2026, bidding site (sold)', kind: 'past', url: 'https://bid.goodingco.com/auctions/1-B4OUFM/pebble-beach-auctions-2026' },

  { house: 'broadarrow', name: 'Broad Arrow', label: 'Available lots', kind: 'upcoming', url: 'https://www.broadarrowauctions.com/vehicles' },
  { house: 'broadarrow', name: 'Broad Arrow', label: 'All lots, bidding site', kind: 'upcoming', url: 'https://bid.broadarrowauctions.com/lots/' },
  { house: 'broadarrow', name: 'Broad Arrow', label: 'Quail 2026 lot (sold)', kind: 'past', url: 'https://www.broadarrowauctions.com/vehicles/ql26_r0158/2025-bugatti-w16-mistral' },
  { house: 'broadarrow', name: 'Broad Arrow', label: 'Upcoming auctions, bidding site', kind: 'index', url: 'https://bid.broadarrowauctions.com/' },

  { house: 'bonhams', name: 'Bonhams', label: 'Golden Age of Motoring', kind: 'upcoming', url: 'https://cars.bonhams.com/auction/27524/the-golden-age-of-motoring/' },
  { house: 'bonhams', name: 'Bonhams', label: 'London to Brighton sale (sold)', kind: 'past', url: 'https://www.bonhams.com/auctions/24879/' },
  { house: 'bonhams', name: 'Bonhams', label: 'Bonhams Cars home', kind: 'index', url: 'https://cars.bonhams.com/' },

  { house: 'mecum', name: 'Mecum', label: 'Auctions', kind: 'index', url: 'https://www.mecum.com/auctions/' },
  { house: 'mecum', name: 'Mecum', label: 'Kissimmee 2027 (guessed URL)', kind: 'upcoming', url: 'https://www.mecum.com/auctions/kissimmee-2027/lots/' },

  { house: 'bj', name: 'Barrett-Jackson', label: 'Las Vegas 2026 docket (sold)', kind: 'past', url: 'https://www.barrett-jackson.com/2026-las-vegas/docket?type=Vehicles' },
  { house: 'bj', name: 'Barrett-Jackson', label: 'Scottsdale 2027 docket (guessed URL)', kind: 'upcoming', url: 'https://www.barrett-jackson.com/2027-scottsdale/docket?type=Vehicles' },
  { house: 'bj', name: 'Barrett-Jackson', label: 'Auctions', kind: 'index', url: 'https://www.barrett-jackson.com/auctions' },
];

// Fuller headers for a second attempt when the first is blocked or empty.
const BROWSER_HEADERS = {
  ...PAGE_FETCH_HEADERS,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const BOT_WALL = [
  /just a moment\.\.\./i, /cf-browser-verification|challenge-platform|cf_chl_/i,
  /attention required! \| cloudflare/i, /access denied/i, /pardon our interruption/i,
  /_incapsula_resource|incapsula incident/i, /px-captcha|perimeterx/i,
  /captcha/i, /request blocked/i, /are you a robot/i,
];

const MONEY = String.raw`(?:US\$|CA\$|A\$|\$|€|£|CHF|USD|EUR|GBP|AUD|CAD)`;
const NUM = String.raw`\d[\d,.' ]*\d|\d`;
const RANGE_RE = new RegExp(`${MONEY}\\s?(?:${NUM})\\s*(?:k|m)?\\s*(?:-|–|—|to)\\s*${MONEY}?\\s?(?:${NUM})`, 'gi');
const EST_KEY_RE = /"(?:estimate_?low|low_?estimate|estimateLow|lowEstimate|EstimateLow|LowEstimate|estimate_?from|estimateFrom|estimate_?min|estimateMin)"\s*:\s*"?\s*[\d$€£]/gi;
const LOT_TEXT_RE = /\bLot\s*(?:No\.?|#)?\s*([A-Z]?\d{1,4}(?:\.\d)?[A-Z]?)\b/gi;
const LOT_KEY_RE = /"(?:lot_?number|lotNumber|LotNumber|lotNo|lot_?no|lot)"\s*:\s*"?([A-Z]?\d{1,4}(?:\.\d)?[A-Z]?)"?/g;

function distinct(re, s) {
  const seen = new Set();
  for (const m of s.matchAll(re)) seen.add(m[1].toUpperCase());
  return seen.size;
}

function count(re, s) {
  return (s.match(re) || []).length;
}

function catalogueLinks(html, base) {
  const out = new Set();
  const baseHost = new URL(base).hostname.replace(/^(www|bid|cars)\./, '');
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (!u.hostname.endsWith(baseHost)) continue;
    if (!/auction|lots|docket|catalog|vehicles|event|sale/i.test(u.pathname)) continue;
    if (/\.(css|js|png|jpe?g|svg|webp|pdf)$/i.test(u.pathname)) continue;
    out.add(u.origin + u.pathname + u.search);
  }
  return [...out].slice(0, 25);
}

function snippet(text, re) {
  const m = re.exec(text);
  re.lastIndex = 0;
  if (!m) return null;
  const at = Math.max(0, m.index - 120);
  return text.slice(at, m.index + 160).replace(/\s+/g, ' ').trim();
}

async function read(url, headers) {
  const t0 = Date.now();
  try {
    const resp = await fetchPage(url, { headers });
    const html = await resp.text();
    return { status: resp.status, finalUrl: resp.url, html, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, error: e.cause?.code || e.name || String(e), html: '', ms: Date.now() - t0 };
  }
}

function assess(page) {
  const html = page.html;
  const fullText = html ? htmlToText(html) : '';
  const text = fullText.slice(0, MAX_INPUT_CHARS);
  const visible = fullText.split('\n\nEMBEDDED PAGE DATA (JSON):\n')[0];
  const wall = page.status === 403 || page.status === 429 || page.status === 503
    || BOT_WALL.some((re) => re.test(html.slice(0, 20000)));
  const lots = Math.max(distinct(LOT_TEXT_RE, text), distinct(LOT_KEY_RE, text));
  const ranges = count(RANGE_RE, text);
  const estKeys = count(EST_KEY_RE, text);
  const estimateWord = count(/\bestimate\b/gi, text);
  return {
    wall,
    empty: !wall && page.status === 200 && visible.length < 1500 && lots === 0,
    htmlBytes: Buffer.byteLength(html),
    textChars: fullText.length,
    sentChars: text.length,
    truncated: fullText.length > MAX_INPUT_CHARS,
    tokens: Math.round(text.length / CHARS_PER_TOKEN),
    slices: text.length ? Math.ceil(text.length / CHUNK_CHARS) : 0,
    lots,
    ranges,
    estKeys,
    estimateWord,
    sold: count(/\b(?:sold for|sold\b)/gi, text),
    dataIslands: {
      nextData: /id=["']__NEXT_DATA__["']/i.test(html),
      nuxt: /window\.__NUXT__|id=["']__NUXT_DATA__["']/i.test(html),
      ldJson: count(/type=["']application\/ld\+json["']/gi, html),
      appJson: count(/type=["']application\/json["']/gi, html),
    },
    paginated: /[?&]page=2\b|load more|show more|next page|rel=["']next["']/i.test(html),
    estSample: snippet(text, /\bestimate\b[^\n]{0,80}\d|(?:US\$|\$|€|£|CHF)\s?\d[\d,]*\s*(?:-|–|to)\s*/i),
    lotSample: snippet(text, /\bLot\s*(?:No\.?|#)?\s*[A-Z]?\d{1,4}\b/),
    head: visible.slice(0, 300).replace(/\s+/g, ' '),
  };
}

function verdict(page, a) {
  if (page.status === 0) return `unreachable (${page.error})`;
  if (a.wall) return 'blocked (bot wall)';
  if (page.status === 404) return 'not found (URL guess wrong?)';
  if (page.status >= 400) return `HTTP ${page.status}`;
  if (a.empty) return 'empty shell (lots load in the browser)';
  if (a.lots === 0) return 'readable, but no lots found';
  const est = a.ranges + a.estKeys;
  if (est === 0) return `readable: ${a.lots} lots, no estimates`;
  return `readable: ${a.lots} lots, ${est} estimate signals`;
}

const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

async function main() {
  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = only.length ? TARGETS.filter((t) => only.includes(t.house)) : TARGETS;
  const rows = [];

  for (const t of targets) {
    let page = await read(t.url, PAGE_FETCH_HEADERS);
    let a = assess(page);
    let retried = null;
    if (a.wall || a.empty || page.status === 0) {
      const again = await read(t.url, BROWSER_HEADERS);
      const b = assess(again);
      retried = verdict(again, b);
      if (!b.wall && !b.empty && again.status === 200) { page = again; a = b; }
    }
    const v = verdict(page, a);
    rows.push({ t, page, a, v, retried });

    console.log(`\n== ${t.name} · ${t.label} [${t.kind}]`);
    console.log(`   ${t.url}${page.finalUrl && page.finalUrl !== t.url ? `\n   -> ${page.finalUrl}` : ''}`);
    console.log(`   ${v}`);
    if (retried) console.log(`   retry with browser headers: ${retried}`);
    console.log(`   HTTP ${page.status} · ${kb(a.htmlBytes)} html · ${a.textChars.toLocaleString()} chars text`
      + `${a.truncated ? ` (cut to ${MAX_INPUT_CHARS.toLocaleString()})` : ''}`
      + ` · ~${a.tokens.toLocaleString()} tokens · ${a.slices} slice(s) · ${page.ms} ms`);
    console.log(`   lots ${a.lots} · estimate ranges ${a.ranges} · estimate fields ${a.estKeys}`
      + ` · "estimate" ×${a.estimateWord} · "sold" ×${a.sold}`);
    const d = a.dataIslands;
    console.log(`   page data: __NEXT_DATA__ ${d.nextData ? 'yes' : 'no'} · nuxt ${d.nuxt ? 'yes' : 'no'}`
      + ` · ld+json ×${d.ldJson} · json ×${d.appJson} · paginated ${a.paginated ? 'maybe' : 'no'}`);
    if (a.lotSample) console.log(`   lot sample: ${a.lotSample}`);
    if (a.estSample) console.log(`   estimate sample: ${a.estSample}`);
    if (!a.lotSample && !a.estSample && a.head) console.log(`   page starts: ${a.head}`);
    if (t.kind === 'index' && page.html) {
      const links = catalogueLinks(page.html, page.finalUrl || t.url);
      console.log(`   catalogue-looking links (${links.length}):`);
      for (const l of links) console.log(`     ${l}`);
    }
  }

  const summary = [
    '## Catalogue readability probe',
    '',
    '| House | Page | Kind | Result | Lots | Estimate signals | Text sent (chars) | ~Tokens | Slices |',
    '|---|---|---|---|---:|---:|---:|---:|---:|',
    ...rows.map(({ t, a, v }) => `| ${t.name} | [${t.label}](${t.url}) | ${t.kind} | ${v} | ${a.lots} | ${a.ranges + a.estKeys} | ${a.sentChars.toLocaleString()} | ${a.tokens.toLocaleString()} | ${a.slices} |`),
  ].join('\n');
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
