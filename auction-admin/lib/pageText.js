/**
 * Reading an auction-house page as text: the fetch Live Entry's extractor
 * (app/api/store/extract) makes for a pasted URL, and the HTML-to-text pass
 * whose output goes to Claude. Shared with scripts/catalogue-probe.mjs so the
 * probe sees exactly what the extractor would.
 */

export const PAGE_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  Accept: 'text/html,application/xhtml+xml',
};

export function fetchPage(url, { headers = PAGE_FETCH_HEADERS, timeoutMs = 30000 } = {}) {
  return fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
}

export function looksLikeHtml(s) {
  const head = s.slice(0, 5000);
  if (/^\s*(<!doctype\s|<html[\s>])/i.test(head)) return true;
  const tags = head.match(/<[a-z][a-z0-9-]*[\s/>]/gi);
  return tags !== null && tags.length >= 5;
}

export function htmlToText(html) {
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
