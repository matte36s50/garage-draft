#!/usr/bin/env node
/**
 * Catalogue watch: gets auction-house catalogue estimates into the store
 * before each sale, and the results after it, without anyone pasting pages.
 *
 * Runs daily in GitHub Actions (.github/workflows/catalogue-watch.yml):
 *
 *   1. Finds each house's upcoming sales on its index pages (lib/catalogueWatch.js).
 *   2. Renders every catalogue in headless Chromium, page by page, marking each
 *      lot with its own page link ("[lot: URL]") so the lot keeps one key
 *      from the first pass to the results.
 *   3. Sends a catalogue to the Live Entry extractor (/api/store/extract) only
 *      when it is worth paying for: the first sighting; a changed page, at most
 *      weekly, then daily from 8 days before the sale through its last day;
 *      and the first run after the sale, for results (again if the results
 *      page changes in the fortnight after).
 *   4. Writes the lots through /api/store/catalogue/ingest as scraper writes,
 *      so a correction made by hand in the admin panel always stands.
 *   5. Reports every sale it saw (lots, estimates, what it did, what it cost)
 *      in the job summary, so a house whose pages change shows up that day.
 *
 * Its record of what it captured (page fingerprints, dates, lot links) lives in
 * a JSON file the workflow keeps in the Actions cache. Losing it costs one
 * extra capture per sale; sales still owed a results pass are also read back
 * from the store.
 *
 * Environment
 *   CATALOGUE_WATCH_APP_URL  the admin app, e.g. https://bid-prix-admin.vercel.app
 *   CRON_SECRET              the admin app's cron secret (Bearer auth)
 *   CATALOGUE_WATCH_STATE    state file (default .catalogue-watch/state.json)
 *   CATALOGUE_WATCH_MAX_CAPTURES  extractions per run (default 15), a cost cap
 *
 *   node scripts/catalogue-watch.mjs [--dry-run] [house ...] [--only <catalogue url>]
 *
 * --dry-run reads and reports everything but calls neither Claude nor the
 * store and leaves the state file alone. Without the app URL and secret the
 * run is a dry run.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  HOUSES, LOT_MARKER, estimatesOnly, eventNameFromTitle, parseSaleDates, resultsDue, shouldCapture,
} from '../lib/catalogueWatch.js';
import { CHROME_UA, isWall } from './probe-lib.mjs';

const APP_URL = (process.env.CATALOGUE_WATCH_APP_URL || '').replace(/\/+$/, '');
const SECRET = process.env.CRON_SECRET || '';
const STATE_PATH = process.env.CATALOGUE_WATCH_STATE || '.catalogue-watch/state.json';
const MAX_CAPTURES = Number(process.env.CATALOGUE_WATCH_MAX_CAPTURES || 15);
const LOTS_PER_CALL = 50; // one extractor call per 50 lots: quick, never a partial read
const EXTRACT_TIMEOUT_MS = 310_000;

// USD per million tokens (input, output), for the report's cost line.
const PRICES = {
  'claude-opus-4-8': [5, 25], 'claude-opus-5': [5, 25], 'claude-opus-5-5': [4, 20],
  'claude-sonnet-5': [2, 10], 'claude-haiku-4-5': [1, 5],
};

const MONEY_RANGE = /(?:US\$|CA\$|A\$|\$|€|£|CHF|USD|EUR|GBP|AUD|CAD)\s?\d[\d,.' ]*\d\s*(?:-|–|—|to)\s*(?:US\$|CA\$|A\$|\$|€|£|CHF|USD|EUR|GBP|AUD|CAD)?\s?\d/i;

/* ----------------------------- page reading ----------------------------- */

async function settle(page, ms = 10_000) {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
  await page.waitForTimeout(600);
}

async function open(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await settle(page, 15_000);
  const status = resp?.status() ?? 0;
  if (isWall(status, await page.innerText('body').catch(() => ''), await page.content())) {
    await page.waitForTimeout(10_000); // some challenges clear themselves
    await settle(page);
  }
  const visible = await page.innerText('body').catch(() => '');
  return { status, wall: isWall(200, visible, await page.content()), title: await page.title().catch(() => '') };
}

/** Links on the page, absolute, without tracking parameters or fragments. */
async function links(page) {
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  return [...new Set(hrefs.map(cleanUrl).filter(Boolean))];
}

/** A lot's identity: its page's origin and path (as the "[lot: ...]" markers carry it). */
function lotUrl(href) {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

function cleanUrl(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

/** Pick the largest "per page" / "view" size a catalogue offers, if any. */
async function widenPage(page) {
  let picked = await pickSize(page);
  if (!picked) {
    // A closed size menu: its toggle shows the current size ("36").
    const opened = await page.evaluate(() => {
      const t = [...document.querySelectorAll('button, [role=button], .dropdown-toggle')]
        .find((el) => /^\d{2,3}$/.test(el.textContent.trim()) && (el.offsetParent || el.getClientRects().length));
      if (!t) return false;
      t.setAttribute('data-cw-toggle', '1');
      return true;
    }).catch(() => false);
    if (opened) {
      await page.click('[data-cw-toggle]', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(500);
      picked = await pickSize(page);
    }
  }
  if (!picked) return null;
  try {
    if (picked.select) await page.selectOption('select[data-cw-size]', String(picked.size));
    else await page.click('[data-cw-size]', { timeout: 5_000 });
    await settle(page);
    return picked.size;
  } catch {
    return null;
  }
}

async function pickSize(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
    for (const sel of document.querySelectorAll('select')) {
      const sizes = [...sel.options].map((o) => Number(o.value || o.textContent)).filter((n) => n >= 20 && n <= 500);
      if (sizes.length >= 2 && vis(sel)) {
        sel.setAttribute('data-cw-size', String(Math.max(...sizes)));
        return { select: true, size: Math.max(...sizes) };
      }
    }
    // A size picker is a small group of sibling sizes: "VIEW 40 100 200" on
    // RM, a 12/24/36/48/96 menu on the bidding sites. A row of page numbers
    // counts up from 1, so it never qualifies.
    const groups = new Map();
    for (const el of document.querySelectorAll('a, button, [role=button], li, span')) {
      const n = Number(el.textContent.trim());
      if (!vis(el) || !(n >= 10 && n <= 500) || el.children.length > 1) continue;
      const box = el.closest('ul, ol, nav, fieldset, [role=menu], [role=listbox]') || el.parentElement;
      if (!box) continue;
      if (!groups.has(box)) groups.set(box, new Map());
      const sizes = groups.get(box);
      // The same size can be both an <li> and its link: keep the clickable one.
      if (!sizes.has(n) || /^(A|BUTTON)$/.test(el.tagName)) sizes.set(n, el);
    }
    const picks = [...groups.values()]
      .filter((g) => g.size >= 2 && g.size <= 8 && !g.has(1) && [...g.keys()].some((n) => n >= 20))
      .sort((a, b) => b.size - a.size);
    if (!picks.length) return null;
    const [size, el] = [...picks[0].entries()].sort((a, b) => b[0] - a[0])[0];
    el.setAttribute('data-cw-size', String(size));
    return { select: false, size };
  }).catch(() => null);
}

/** Scroll and press "load more" until no new lot links appear. */
async function loadAll(page, lotRe) {
  let last = -1;
  for (let round = 0; round < 15; round++) {
    const n = (await links(page)).filter((u) => lotRe.test(new URL(u).pathname)).length;
    if (n === last) break;
    last = n;
    await page.mouse.wheel(0, 20_000);
    await page.waitForTimeout(900);
    // Only a button worded exactly like a "more lots" control: a lot card's
    // "view more" link would take the page away from the catalogue.
    const more = page.locator('button, [role=button]')
      .filter({ hasText: /^\s*(load|show|view) more(\s+(lots|results|vehicles|items))?\s*$/i }).first();
    const here = page.url();
    if (await more.isVisible().catch(() => false)) await more.click({ timeout: 5_000 }).catch(() => {});
    await settle(page, 6_000);
    if (page.url() !== here && !page.url().startsWith(here.split('#')[0])) {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      break;
    }
  }
}

/** Go to the next catalogue page; false when there is none. */
async function nextPage(page) {
  const target = await page.evaluate(() => {
    const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
    const off = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true'
      || /\bdisabled\b/i.test(el.className || '') || /\bdisabled\b/i.test(el.parentElement?.className || '');
    const rel = document.querySelector('link[rel="next"][href], a[rel="next"][href]');
    if (rel && !off(rel)) return { href: rel.href };
    const cands = [...document.querySelectorAll('a, button, [role=button]')].filter((el) => vis(el) && !off(el));
    let el = cands.find((e) => /^(go to )?next( page)?$/i.test((e.getAttribute('aria-label') || '').trim()))
      || cands.find((e) => /^(next|next page|›|>|→)$/i.test(e.textContent.trim()))
      // An arrow drawn by CSS: <button class="next btn"> (the bidding sites)
      || cands.find((e) => /(^|\s)(next|page-next|pagination-next)(\s|$)/i.test(String(e.className || '')));
    if (!el) {
      // Numbered pages without an arrow: the number after the current one.
      const cur = document.querySelector('[aria-current="page"], .active, .current, .is-active, .selected');
      const n = Number(cur?.textContent.trim());
      const box = cur?.closest('nav, ul, ol, div');
      if (Number.isInteger(n) && box) {
        el = [...box.querySelectorAll('a, button, [role=button]')].find((e) => vis(e) && !off(e) && e.textContent.trim() === String(n + 1));
      }
    }
    if (!el) return null;
    el.setAttribute('data-cw-next', '1');
    return { click: true, href: el.tagName === 'A' ? el.href : null };
  }).catch(() => null);
  if (!target) return false;
  try {
    if (target.click) await page.click('[data-cw-next]', { timeout: 5_000 });
    else await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settle(page);
    return true;
  } catch {
    return false;
  }
}

/**
 * The page's text with "[lot: URL]" before each lot's first link. When the
 * house's lot pattern matches nothing, the most repeated link shape on the
 * page stands in (and the report says so).
 */
async function markedText(page, lotRe) {
  return page.evaluate(({ src, flags, marker }) => {
    const re = new RegExp(src, flags);
    // A lot is its page: origin and path. Query strings carry list context
    // (Gooding appends the catalogue's filters), not identity.
    const clean = (href) => {
      const u = new URL(href);
      return `${u.origin}${u.pathname}`;
    };
    let anchors = [...document.querySelectorAll('a[href]')].filter((a) => {
      try { return re.test(new URL(a.href).pathname); } catch { return false; }
    });
    let auto = null;
    if (!anchors.length) {
      // Group links by shape (digits -> #, last slug -> *) and take the most varied.
      const shape = (p) => p.replace(/\d+/g, '#').replace(/\/[^/]*[a-z][^/]*\/?$/i, '/*');
      const groups = new Map();
      for (const a of document.querySelectorAll('a[href]')) {
        let u;
        try { u = new URL(a.href); } catch { continue; }
        if (u.origin !== location.origin || u.pathname === location.pathname) continue;
        const k = shape(u.pathname);
        if (!groups.has(k)) groups.set(k, new Set());
        groups.get(k).add(u.pathname);
      }
      const best = [...groups.entries()].sort((a, b) => b[1].size - a[1].size)[0];
      if (best && best[1].size >= 5) {
        auto = best[0];
        anchors = [...document.querySelectorAll('a[href]')].filter((a) => {
          try { const u = new URL(a.href); return best[1].has(u.pathname) && u.origin === location.origin; } catch { return false; }
        });
      }
    }
    const seen = new Set();
    const added = [];
    for (const a of anchors) {
      const url = clean(a.href);
      if (seen.has(url)) continue;
      seen.add(url);
      const mark = document.createElement('span');
      mark.textContent = `\n${marker}${url}]\n`;
      a.parentNode.insertBefore(mark, a);
      added.push(mark);
    }
    const text = document.body.innerText;
    added.forEach((m) => m.remove());
    return { text, urls: [...seen], auto };
  }, { src: lotRe.source, flags: lotRe.flags.replace('g', ''), marker: LOT_MARKER });
}

/** Split marked text into the header and one segment per lot (keyed by URL). */
function segments(text) {
  const parts = String(text).split(`\n${LOT_MARKER}`);
  const head = parts.shift();
  const lots = new Map();
  for (const p of parts) {
    const end = p.indexOf(']');
    const url = p.slice(0, end);
    if (!lots.has(url)) lots.set(url, `${LOT_MARKER}${p}`);
  }
  return { head, lots };
}

/** Render a whole catalogue: every page, every lot, once. */
async function readCatalogue(page, url, house) {
  const t0 = Date.now();
  const opened = await open(page, url);
  if (opened.wall) return { ...opened, error: 'blocked by a bot wall', lots: new Map(), head: '', pages: 0, ms: Date.now() - t0 };
  const widened = await widenPage(page);
  let head = '';
  let auto = null;
  const lots = new Map();
  let pages = 0;
  let lastFirst = null;
  while (pages < house.maxPages) {
    await loadAll(page, house.lotLink);
    const marked = await markedText(page, house.lotLink);
    auto = auto || marked.auto;
    const seg = segments(marked.text);
    const first = [...seg.lots.keys()][0] || null;
    if (pages > 0 && first === lastFirst) break; // "next" changed nothing
    lastFirst = first;
    if (!pages) head = seg.head;
    for (const [k, v] of seg.lots) if (!lots.has(k)) lots.set(k, v);
    pages += 1;
    if (!(await nextPage(page))) break;
    // Lists re-rendered in place can lag the click: wait for new lots.
    for (let t = 0; t < 16; t++) {
      const now = await page.$$eval('a[href]', (as) => as.map((a) => a.href)).catch(() => []);
      const firstNow = now.map(lotUrl).find((u) => { try { return house.lotLink.test(new URL(u).pathname); } catch { return false; } });
      if (firstNow && firstNow !== lastFirst) break;
      await page.waitForTimeout(500);
    }
  }
  const pager = pages === 1 && lots.size >= 24 ? await pagerHints(page) : null;
  return { ...opened, head, lots, pages, widened, auto, pager, ms: Date.now() - t0 };
}

/** What looks like paging on a page, for the dry-run report. */
async function pagerHints(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
    return [...document.querySelectorAll('a, button, [role=button], li, span, i')]
      .filter((el) => vis(el) && el.children.length <= 2)
      .filter((el) => {
        const t = el.textContent.trim();
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.className || ''}`;
        return /^(\d{1,3}|[<>‹›«»→←]|next|prev(ious)?|more|load more|show more)$/i.test(t)
          || /next|pagination|pager|page-link|load-?more/i.test(label);
      })
      .slice(-15)
      .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`
        + ` "${el.textContent.trim().slice(0, 20)}"${el.getAttribute('aria-label') ? ` aria="${el.getAttribute('aria-label')}"` : ''}`
        + `${el.getAttribute('href') ? ` href=${el.getAttribute('href').slice(0, 80)}` : ''}`);
  }).catch(() => []);
}

/** Sale dates: the catalogue's header, else its lots, else the sale's own page. */
async function saleDates(page, url, cat, salePage) {
  const found = parseSaleDates(cat.head) || parseSaleDates([...cat.lots.values()].slice(0, 20).join('\n'));
  if (found) return found;
  const landing = salePage || url.replace(/lots\/?$/, '');
  if (landing === url) return null;
  try {
    await open(page, landing);
    return parseSaleDates(await page.innerText('body'));
  } catch {
    return null;
  }
}

/* ---------------------------- app round-trips --------------------------- */

async function api(path, { method = 'GET', body, timeout = 60_000 } = {}) {
  const resp = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  if (!resp.ok) throw new Error(`${method} ${path}: HTTP ${resp.status} ${data.error || ''}`.trim());
  return data;
}

/** Extract lots from the marked text, LOTS_PER_CALL lots per call, header on each. */
async function extract(head, lotSegments, mode) {
  const lots = [];
  const usage = { input_tokens: 0, output_tokens: 0, model: null, calls: 0 };
  let event = {};
  for (let i = 0; i < lotSegments.length; i += LOTS_PER_CALL) {
    const text = [head.slice(0, 4000), ...lotSegments.slice(i, i + LOTS_PER_CALL)].join('\n');
    const res = await api('/api/store/extract', { method: 'POST', body: { text, mode }, timeout: EXTRACT_TIMEOUT_MS });
    lots.push(...(res.lots || []));
    event = { ...res.event, ...Object.fromEntries(Object.entries(event).filter(([, v]) => v)) };
    usage.input_tokens += res.usage?.input_tokens || 0;
    usage.output_tokens += res.usage?.output_tokens || 0;
    usage.model = res.usage?.model || usage.model;
    usage.calls += 1;
    if (res.partial) throw new Error(`extractor read only part of a ${LOTS_PER_CALL}-lot batch: ${res.note}`);
  }
  return { lots, event, usage };
}

const costOf = (u) => {
  const p = PRICES[u?.model];
  return p ? (u.input_tokens * p[0] + u.output_tokens * p[1]) / 1e6 : null;
};

/* --------------------------------- run ---------------------------------- */

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { version: 1, sales: {} };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 1)}\n`);
}

/** A catalogue's fingerprint: its lots' text (order-free) and its dates. */
const fingerprint = (head, lots) => createHash('sha256')
  .update([...lots.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.replace(/\s+/g, ' ')).join('\n'))
  .update(JSON.stringify(parseSaleDates(head)))
  .digest('hex').slice(0, 16);

function parseArgs(argv) {
  const args = { dryRun: false, houses: [], only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--only') args.only = argv[++i];
    else args.houses.push(argv[i].toLowerCase());
  }
  return args;
}

export async function main(argv = process.argv.slice(2), houses = HOUSES) {
  const args = parseArgs(argv);
  const live = !args.dryRun && APP_URL && SECRET;
  if (!args.dryRun && !live) console.log('::warning::CATALOGUE_WATCH_APP_URL or CRON_SECRET not set: dry run.');
  const today = new Date().toISOString().slice(0, 10);
  const houseIds = Object.keys(houses)
    .filter((h) => (args.houses.length ? args.houses.includes(h) : houses[h].enabled !== false));
  const state = loadState();
  const rows = [];
  const problems = [];
  let captures = 0;
  const spent = { input_tokens: 0, output_tokens: 0, cost: 0 };

  // Sales the store says are finished but still hold upcoming lots.
  let owed = [];
  if (live) {
    try {
      owed = (await api('/api/store/catalogue/ingest')).awaiting_results || [];
    } catch (e) {
      problems.push(`Could not read sales awaiting results: ${e.message}`);
    }
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: CHROME_UA, locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  for (const houseId of houseIds) {
    const house = houses[houseId];
    console.log(`\n### ${house.name}`);
    const found = new Set();
    const hops = [];
    const referrer = new Map(); // catalogue -> the sale page that links to it
    // Catalogue links on the current page, as their canonical URLs.
    const catalogueLinks = async () => (await links(page))
      .map((u) => (house.catalogueUrl ? u : u.split('?')[0]))
      .filter((u) => house.catalogue.test(u))
      .map((u) => (house.catalogueUrl ? house.catalogueUrl(u) : u));
    for (const idx of house.index) {
      try {
        const o = await open(page, idx);
        if (o.wall) throw new Error('blocked by a bot wall');
        (await catalogueLinks()).forEach((u) => found.add(u));
        const all = (await links(page)).map((u) => u.split('?')[0]);
        if (house.follow) hops.push(...all.filter((u) => house.follow.test(u)));
      } catch (e) {
        problems.push(`${house.name}: index ${idx} unreadable (${e.message.split('\n')[0]})`);
      }
    }
    // Sale pages that link on to the catalogue (Gooding: goodingco.com -> bid site).
    for (const hop of [...new Set(hops)].slice(0, 8)) {
      try {
        await open(page, hop);
        const hits = await catalogueLinks();
        for (const u of hits) {
          found.add(u);
          if (!referrer.has(u)) referrer.set(u, hop);
        }
        if (!live && !hits.length) {
          const near = (await links(page)).filter((u) => /bid\.|\/lots?\b|catalog/i.test(u)).slice(0, 8);
          console.log(`   ${hop}: no catalogue link${near.length ? `; nearby:\n${near.map((u) => `     ${u}`).join('\n')}` : ''}`);
        }
      } catch (e) {
        console.log(`   ${hop}: unreadable (${e.message.split('\n')[0]})`);
      }
    }
    console.log(`   index: ${found.size} catalogue(s) listed`);
    if (!found.size) {
      problems.push(`${house.name}: no catalogues found on the index page(s)`);
      if (!live) {
        const sample = (await links(page).catch(() => [])).filter((u) => /auction|lots|catalog/i.test(u)).slice(0, 15);
        console.log(`   auction-looking links on the index:\n${sample.map((u) => `     ${u}`).join('\n') || '     (none)'}`);
      }
    }

    const urls = new Set(found);
    for (const [u, s] of Object.entries(state.sales)) if (s.house === houseId && !s.done) urls.add(u);
    for (const o of owed) if (o.house === houseId) urls.add(o.catalogue_url);
    if (args.only) for (const u of [...urls]) if (u !== args.only) urls.delete(u);

    const firstRow = rows.length;
    for (const url of urls) {
      const entry = state.sales[url] || {};
      const fromStore = owed.find((o) => o.catalogue_url === url);
      let cat;
      try {
        cat = await readCatalogue(page, url, house);
      } catch (e) {
        cat = { error: e.message.split('\n')[0], lots: new Map(), head: '', pages: 0 };
      }
      const name = entry.name || (house.eventName ? house.eventName(url) : eventNameFromTitle(cat.title, houseId));
      const dates = (entry.starts_on && { starts_on: entry.starts_on, ends_on: entry.ends_on })
        || (cat.error ? null : await saleDates(page, url, cat, referrer.get(url)))
        || (fromStore && { starts_on: fromStore.starts_on, ends_on: fromStore.starts_on });
      const lotSegs = [...cat.lots.values()];
      const withEst = lotSegs.filter((s) => MONEY_RANGE.test(s)).length;
      const hash = fingerprint(cat.head, cat.lots);
      const row = {
        house: house.name, url, name: name || '(no title)', dates, pages: cat.pages, lots: cat.lots.size,
        withEst, action: '', cost: null,
      };
      rows.push(row);

      if (cat.error || !cat.lots.size) {
        row.action = cat.error ? `unreadable: ${cat.error}` : 'no lots on the page';
        // An upcoming sale may not have published lots yet; a captured one
        // going empty means the reader broke.
        if (cat.error || entry.capturedAt) problems.push(`${house.name} · ${row.name}: ${row.action}`);
        console.log(`   ${row.name}: ${row.action}${cat.auto ? ` (auto lot links: ${cat.auto})` : ''}`);
        continue;
      }

      const res = resultsDue(entry, { hash, today, sale: dates });
      const cap = res.due ? { capture: true, reason: res.reason } : shouldCapture(entry, { hash, today, sale: dates });
      const mode = res.due ? 'result' : 'estimate';
      let sendSegs = lotSegs;
      let note = '';
      if (house.estimatesOnly) {
        // Huge catalogues: only lots with a published estimate go to Claude;
        // for results, the lots captured before the sale (or, with that
        // record lost, those still showing an estimate).
        if (mode === 'result' && entry.lotUrls?.length) {
          const keep = new Set(entry.lotUrls);
          sendSegs = [...cat.lots.entries()].filter(([u]) => keep.has(u)).map(([, v]) => v);
          note = ` (${sendSegs.length} watched lots)`;
        } else {
          const f = estimatesOnly([cat.head, ...lotSegs].join('\n'));
          sendSegs = [...segments(f.text).lots.values()];
          note = ` (${f.kept} with estimates of ${f.kept + f.dropped})`;
        }
      }

      console.log(`   ${row.name} · ${dates ? `${dates.starts_on}..${dates.ends_on}` : 'no date'} · ${cat.pages} page(s)`
        + `${cat.widened ? ` at ${cat.widened}/page` : ''} · ${cat.lots.size} lots, ${withEst} with estimates`
        + `${cat.auto ? ` · auto lot links ${cat.auto}` : ''} · ${cap.reason}`);
      if (!dates) problems.push(`${house.name} · ${row.name}: no sale date found, so no results pass will be scheduled`);
      if (!cap.capture) { row.action = cap.reason; continue; }
      if (!sendSegs.length) { row.action = `${cap.reason}: nothing to send${note}`; continue; }
      if (!live) {
        row.action = `would read ${mode === 'result' ? 'results' : 'estimates'}${note}: ${cap.reason}`;
        console.log(`      sample: ${sendSegs[0].slice(0, 240).replace(/\s+/g, ' ')}`);
        if (!withEst && cat.lots.size) {
          const first = [...cat.lots.keys()][0];
          try {
            await open(page, first);
            const body = await page.innerText('body');
            const at = body.search(/estimate|est\./i);
            console.log(`      cards show no estimates; the first lot's page ${at >= 0 ? 'says' : 'starts'}: `
              + `${body.slice(Math.max(0, at - 150), (at >= 0 ? at : 0) + 250).replace(/\s+/g, ' ')}`);
          } catch (e) {
            console.log(`      cards show no estimates; the first lot's page is unreadable (${e.message.split('\n')[0]})`);
          }
        }
        if (cat.pager?.length) console.log(`      stopped after one page; paging controls seen:\n${cat.pager.map((h) => `        ${h}`).join('\n')}`);
        continue;
      }
      if (captures >= MAX_CAPTURES) {
        row.action = `deferred: ${MAX_CAPTURES} extractions already this run`;
        continue;
      }
      captures += 1;
      try {
        const got = await extract(cat.head, sendSegs, mode);
        const event = {
          name,
          location: entry.location || got.event.location || undefined,
          starts_on: dates?.starts_on,
          ends_on: dates?.ends_on,
        };
        const written = await api('/api/store/catalogue/ingest', {
          method: 'POST',
          body: { house: houseId, event, catalogue_url: url, mode, lots: got.lots },
        });
        const cost = costOf(got.usage);
        row.cost = cost;
        spent.input_tokens += got.usage.input_tokens;
        spent.output_tokens += got.usage.output_tokens;
        spent.cost += cost || 0;
        row.action = `${mode === 'result' ? 'results' : 'estimates'}: ${written.written} lots written`
          + `${written.skipped?.length ? `, ${written.skipped.length} skipped` : ''}${note} (${cap.reason})`;
        const next = {
          ...entry, house: houseId, name, location: event.location, ...dates,
          lots: cat.lots.size, withEstimates: withEst, lastSeen: today, firstSeen: entry.firstSeen || today,
        };
        if (mode === 'result') Object.assign(next, { resultsAt: today, resultsHash: hash });
        else Object.assign(next, { capturedAt: today, hash, lotUrls: [...new Set([...(entry.lotUrls || []), ...cat.lots.keys()])] });
        state.sales[url] = next;
      } catch (e) {
        row.action = `failed: ${e.message.split('\n')[0]}`;
        problems.push(`${house.name} · ${row.name}: ${row.action}`);
      }
    }
    const houseRows = rows.slice(firstRow);
    if (houseRows.length && houseRows.every((r) => !r.lots)) {
      problems.push(`${house.name}: no lots read in any of ${houseRows.length} catalogue(s): the reader may need updating`);
    }
  }
  await browser.close();

  // Forget sales a month after their results.
  for (const [u, s] of Object.entries(state.sales)) {
    if (s.resultsAt && s.ends_on && today > s.ends_on && (Date.parse(today) - Date.parse(s.ends_on)) / 86_400_000 > 30) delete state.sales[u];
  }
  if (live) saveState(state);

  const money = (c) => (c == null ? '' : `$${c.toFixed(2)}`);
  const summary = [
    `## Catalogue watch — ${today}${live ? '' : ' (dry run)'}`,
    '',
    '| House | Sale | Dates | Pages | Lots | With estimate | Action | Cost |',
    '|---|---|---|---:|---:|---:|---|---:|',
    ...rows.map((r) => `| ${r.house} | [${r.name}](${r.url}) | ${r.dates ? `${r.dates.starts_on}${r.dates.ends_on !== r.dates.starts_on ? ` – ${r.dates.ends_on}` : ''}` : '—'} | ${r.pages} | ${r.lots} | ${r.withEst} | ${r.action} | ${money(r.cost)} |`),
    '',
    live ? `Claude: ${spent.input_tokens.toLocaleString()} input + ${spent.output_tokens.toLocaleString()} output tokens, ${money(spent.cost)} this run.` : '',
    ...(problems.length ? ['', '### Needs attention', ...problems.map((p) => `- ${p}`)] : []),
  ].join('\n');
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  for (const p of problems) console.log(`::warning::${p}`);
  // A live run with a failed capture or an unreadable house fails, so GitHub
  // emails about it; a dry run only reports.
  return live && problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { segments, fingerprint, readCatalogue, saleDates };

