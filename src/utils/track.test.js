import {
  _resetTrackingForTests, flush, initTracking, setTrackingContext, setTrackingSession, track, trackOnce,
} from './track'

const SESSION = { access_token: 'player-token' }

function sentBatches() {
  return global.fetch.mock.calls.map(([url, opts]) => ({ url, opts, body: JSON.parse(opts.body) }))
}

beforeEach(() => {
  jest.useFakeTimers()
  _resetTrackingForTests()
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }))
  initTracking({ url: 'https://example.supabase.co/', key: 'anon-key' })
})

afterEach(() => {
  jest.useRealTimers()
})

test('nothing is recorded while signed out', () => {
  track('screen_view', { screen: 'landing' })
  flush()
  expect(global.fetch).not.toHaveBeenCalled()
})

test('events go to log_events as the signed-in player, with the open league', () => {
  setTrackingSession(SESSION)
  setTrackingContext({ league_id: 'league-1' })
  track('draft_add', { auction_id: 1990, ok: true, price: 30000 })
  flush()

  const [{ url, opts, body }] = sentBatches()
  expect(url).toBe('https://example.supabase.co/rest/v1/rpc/log_events')
  expect(opts.keepalive).toBe(true)
  expect(opts.headers.Authorization).toBe('Bearer player-token')
  expect(opts.headers.apikey).toBe('anon-key')
  expect(body.p_session_id).toEqual(expect.any(String))
  expect(body.p_events).toEqual([
    { name: 'draft_add', league_id: 'league-1', auction_id: '1990', props: { ok: true, price: 30000 } },
  ])
})

test('an explicit league_id wins over the open league', () => {
  setTrackingSession(SESSION)
  setTrackingContext({ league_id: 'league-1' })
  track('league_join', { league_id: 'league-2', source: 'invite' })
  flush()
  expect(sentBatches()[0].body.p_events[0].league_id).toBe('league-2')
})

test('events wait for the timer, then go in one batch', () => {
  setTrackingSession(SESSION)
  track('screen_view', { screen: 'cars' })
  track('screen_view', { screen: 'garage' })
  expect(global.fetch).not.toHaveBeenCalled()
  jest.advanceTimersByTime(10000)
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(sentBatches()[0].body.p_events).toHaveLength(2)
})

test('a full batch of 50 goes straight away, and batches never exceed 50', () => {
  setTrackingSession(SESSION)
  for (let i = 0; i < 120; i++) track('screen_view', { screen: `s${i}` })
  flush()
  const sizes = sentBatches().map(b => b.body.p_events.length)
  expect(sizes).toEqual([50, 50, 20])
})

test('trackOnce records a key once per sign-in', () => {
  setTrackingSession(SESSION)
  trackOnce('list:a', 'auction_list_view', { auction_ids: ['1'] })
  trackOnce('list:a', 'auction_list_view', { auction_ids: ['1'] })
  flush()
  expect(sentBatches()[0].body.p_events).toHaveLength(1)

  setTrackingSession(null)
  setTrackingSession(SESSION)
  trackOnce('list:a', 'auction_list_view', { auction_ids: ['1'] })
  flush()
  expect(global.fetch).toHaveBeenCalledTimes(2)
})

test('signing out drops anything still queued', () => {
  setTrackingSession(SESSION)
  track('screen_view', { screen: 'cars' })
  setTrackingSession(null)
  setTrackingSession(SESSION)
  flush()
  expect(global.fetch).not.toHaveBeenCalled()
})

test('a failing network never breaks the game', () => {
  setTrackingSession(SESSION)
  global.fetch = jest.fn(() => { throw new Error('offline') })
  track('screen_view', { screen: 'cars' })
  expect(() => flush()).not.toThrow()
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')))
  track('screen_view', { screen: 'cars' })
  expect(() => flush()).not.toThrow()
})
