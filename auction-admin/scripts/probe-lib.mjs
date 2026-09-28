/**
 * Shared page checks for the catalogue probes (catalogue-probe.mjs reads pages
 * the way the extractor does; catalogue-probe-browser.mjs renders them in a
 * headless browser). Heuristics only: they count what a page shows so a
 * human can judge whether a reader works, they don't extract lots.
 */

// Mirrors app/api/store/extract/route.js.
export const MAX_INPUT_CHARS = 400_000;
export const CHUNK_CHARS = 45_000;
export const CHARS_PER_TOKEN = 3.5; // rough; the real count comes from the API's usage

export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Challenge pages, judged on the words a reader sees plus a few vendor markers
// in the markup. Generic words like "captcha" are left out: ordinary pages
// load reCAPTCHA for their sign-in forms.
const WALL_TEXT = [
  /just a moment\.\.\./i, /verify (?:that )?you(?:'|’)re not a robot/i, /are you a robot/i,
  /pardon our interruption/i, /attention required/i, /access denied/i, /request blocked/i,
  /enable javascript and cookies to continue/i,
];
const WALL_MARKUP = [/cf_chl_|\/cdn-cgi\/challenge-platform\//i, /_incapsula_resource/i, /px-captcha/i, /awswaf|aws-waf-token/i];
const NEEDS_JS = /requires javascript|enable javascript|javascript is disabled|javascript is required/i;

export function isWall(status, visible, html) {
  if ([403, 429, 503].includes(status)) return true;
  const head = visible.slice(0, 2000);
  return WALL_TEXT.some((re) => re.test(head)) || WALL_MARKUP.some((re) => re.test(html.slice(0, 50_000)));
}

const MONEY = String.raw`(?:US\$|CA\$|A\$|\$|€|£|CHF|USD|EUR|GBP|AUD|CAD)`;
const NUM = String.raw`\d[\d,.' ]*\d|\d`;
const RANGE_RE = new RegExp(`${MONEY}\\s?(?:${NUM})\\s*(?:k|m)?\\s*(?:-|–|—|to)\\s*${MONEY}?\\s?(?:${NUM})`, 'gi');
const EST_KEY_RE = /"(?:estimate_?low|low_?estimate|estimateLow|lowEstimate|EstimateLow|LowEstimate|estimate_?from|estimateFrom|estimate_?min|estimateMin)"\s*:\s*"?\s*[\d$€£]/gi;
const LOT_TEXT_RE = /\bLot\s*(?:No\.?|#)?\s*([A-Z]?\d{1,4}(?:\.\d)?[A-Z]?)\b/gi;
const LOT_KEY_RE = /"(?:lot_?number|lotNumber|LotNumber|lotNo|lot_?no|lot)"\s*:\s*"?([A-Z]?\d{1,4}(?:\.\d)?[A-Z]?)"?/g;

export function count(re, s) {
  return (s.match(re) || []).length;
}

function distinct(re, s) {
  const seen = new Set();
  for (const m of s.matchAll(re)) seen.add(m[1].toUpperCase());
  return seen.size;
}

function snippet(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const at = Math.max(0, m.index - 120);
  return text.slice(at, m.index + 160).replace(/\s+/g, ' ').trim();
}

/** What a page's text shows: lots, estimates, and how big it is for Claude. */
export function measure(fullText) {
  const text = fullText.slice(0, MAX_INPUT_CHARS);
  return {
    textChars: fullText.length,
    sentChars: text.length,
    truncated: fullText.length > MAX_INPUT_CHARS,
    tokens: Math.round(text.length / CHARS_PER_TOKEN),
    slices: text.length ? Math.ceil(text.length / CHUNK_CHARS) : 0,
    lots: Math.max(distinct(LOT_TEXT_RE, text), distinct(LOT_KEY_RE, text)),
    ranges: count(RANGE_RE, text),
    estKeys: count(EST_KEY_RE, text),
    estimateWord: count(/\bestimate\b/gi, text),
    sold: count(/\bsold\b/gi, text),
    estSample: snippet(text, /\bestimate\b[^\n]{0,80}\d|(?:US\$|\$|€|£|CHF)\s?\d[\d,]*\s*(?:-|–|to)\s*/i),
    lotSample: snippet(text, /\bLot\s*(?:No\.?|#)?\s*[A-Z]?\d{1,4}\b/i),
  };
}

export function verdict({ status, error, wall, visible, m }) {
  if (error && !status) return `unreachable (${error})`;
  if (wall) return 'blocked (bot wall)';
  if (status === 404) return 'not found (URL guess wrong?)';
  if (status >= 400) return `HTTP ${status}`;
  if (m.lots === 0 && (visible.length < 1500 || NEEDS_JS.test(visible.slice(0, 3000)))) {
    return 'needs a browser (lots load by JavaScript)';
  }
  if (m.lots === 0) return 'readable, but no lots found';
  const est = m.ranges + m.estKeys;
  return est === 0 ? `readable: ${m.lots} lots, no estimates` : `readable: ${m.lots} lots, ${est} estimate signals`;
}

/** Hide query values that look like credentials before a URL goes in a log. */
export function redactUrl(raw) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (/key|token|secret|sig|auth|session|password/i.test(k)) u.searchParams.set(k, '…');
    }
    const s = u.toString();
    return s.length > 180 ? `${s.slice(0, 177)}…` : s;
  } catch {
    return raw.slice(0, 180);
  }
}

export const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

export function summaryTable(title, rows) {
  return [
    `## ${title}`,
    '',
    '| House | Page | Kind | Result | Lots | Estimate signals | Text (chars) | ~Tokens | Slices |',
    '|---|---|---|---|---:|---:|---:|---:|---:|',
    ...rows.map(({ t, m, v }) => `| ${t.name} | [${t.label}](${t.url}) | ${t.kind} | ${v} | ${m.lots} | ${m.ranges + m.estKeys} | ${m.sentChars.toLocaleString()} | ${m.tokens.toLocaleString()} | ${m.slices} |`),
  ].join('\n');
}
