/**
 * First-party event log: what signed-in players look at and do in the game.
 *
 * It feeds two things: improving the game (where players drop off, what they
 * try and can't do) and the crowd-interest research for MII/MAI (which cars
 * players are shown, open, draft and drop). Events queue in memory and go in
 * batches to the log_events RPC (supabase_migration_events.sql), which takes
 * the player from the session and drops any event name it doesn't know.
 *
 * Nothing is recorded while signed out, and no chat text or other free text
 * is ever sent. Logging must never break the game, so every failure is
 * swallowed.
 */

const FLUSH_MS = 10000
const MAX_BATCH = 50
const MAX_QUEUE = 500
const SESSION_KEY = 'bidprix_session_id'

let config = null       // { url, key }: the Supabase project and anon key
let accessToken = null  // the signed-in player's token; null = don't record
let context = {}        // added to every event, e.g. { league_id }
let queue = []
let timer = null
let sessionId = null
const sentOnce = new Set()

export function initTracking({ url, key }) {
  config = { url: String(url).replace(/\/+$/, ''), key }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }
}

/** Call with every auth event's session; signing out stops recording and drops the queue. */
export function setTrackingSession(session) {
  accessToken = session?.access_token || null
  if (!accessToken) {
    queue = []
    sentOnce.clear()
  }
}

export function setTrackingContext(next) {
  context = { ...context, ...next }
}

/** Record one event. auction_id and league_id get their own columns; the rest goes in props. */
export function track(name, props = {}) {
  if (!config || !accessToken) return
  const { auction_id: auctionId, league_id: leagueId, ...rest } = props
  queue.push({
    name,
    league_id: leagueId ?? context.league_id ?? null,
    auction_id: auctionId == null ? null : String(auctionId),
    props: rest,
  })
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  if (queue.length >= MAX_BATCH) flush()
  else if (!timer) timer = setTimeout(flush, FLUSH_MS)
}

/** Record an event at most once per key for this sign-in (e.g. the same list shown twice). */
export function trackOnce(key, name, props) {
  if (!accessToken || sentOnce.has(key)) return
  sentOnce.add(key)
  track(name, props)
}

/**
 * Send what's queued. keepalive lets the request finish while the page is
 * being hidden or closed, which is when the last batch usually goes.
 */
export function flush() {
  clearTimeout(timer)
  timer = null
  if (!config || !accessToken) return
  while (queue.length) {
    const batch = queue.splice(0, MAX_BATCH)
    try {
      fetch(`${config.url}/rest/v1/rpc/log_events`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_session_id: getSessionId(), p_events: batch }),
      }).catch(() => {})
    } catch {
      // A missing fetch or a refused request costs a batch of events, nothing more.
    }
  }
}

// One id per browser tab, kept across reloads, so a visit's events read in order.
function getSessionId() {
  if (sessionId) return sessionId
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY)
  } catch { /* storage blocked */ }
  if (!sessionId) {
    sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    try { sessionStorage.setItem(SESSION_KEY, sessionId) } catch { /* storage blocked */ }
  }
  return sessionId
}

// For tests only.
export function _resetTrackingForTests() {
  config = null
  accessToken = null
  context = {}
  queue = []
  clearTimeout(timer)
  timer = null
  sessionId = null
  sentOnce.clear()
}
