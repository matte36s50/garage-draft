// Event lifecycle helpers
// ------------------------
// An "event" is a league. Its draft window (draft_starts_at → draft_ends_at) is
// only the first phase; after the draft closes the cars keep trading on BaT until
// the league's last auction ends. Until now the app had no notion of that final
// moment, so a finished event read as perpetually "LIVE". These helpers derive a
// single source of truth for when an event is over so the UI can show a clear
// FINAL / checkered-flag state and an end-of-event recap.

// Returns the Date the event finishes — the latest end time across every auction
// assigned to the league. Mirrors the query the dashboard already used, extracted
// so the whole app can share one "event over" signal.
export async function getLeagueEndTime(supabase, league) {
  if (!league?.id) return null

  try {
    const { data: leagueAuctions, error } = await supabase
      .from('league_auctions')
      .select('custom_end_date, auctions(timestamp_end, final_price)')
      .eq('league_id', league.id)

    if (error) throw error

    if (leagueAuctions && leagueAuctions.length > 0) {
      const endOf = (la) => la.custom_end_date || la.auctions?.timestamp_end
      // While any auction is still unsettled (final_price null) the event ends with
      // the latest of those. Once they have all settled, fall back to the latest end
      // across all of them — i.e. when the event actually finished.
      const active = leagueAuctions.filter((la) => la.auctions?.final_price === null)
      const pool = active.length > 0 ? active : leagueAuctions
      let maxEnd = 0
      pool.forEach((la) => {
        const e = endOf(la)
        if (e && e > maxEnd) maxEnd = e
      })
      return maxEnd > 0 ? new Date(maxEnd * 1000) : null
    }

    // No league-specific auctions assigned: fall back to the 4–5 day auction window
    // measured from the draft start (matches the auto-league window elsewhere).
    const startSec = league.draft_starts_at
      ? Math.floor(new Date(league.draft_starts_at).getTime() / 1000)
      : Math.floor(Date.now() / 1000)
    const { data: auctions } = await supabase
      .from('auctions')
      .select('timestamp_end')
      .gte('timestamp_end', startSec + 4 * 86400)
      .lte('timestamp_end', startSec + 5 * 86400)
      .not('price_at_48h', 'is', null)
      .order('timestamp_end', { ascending: false })
      .limit(1)

    if (auctions && auctions.length > 0) return new Date(auctions[0].timestamp_end * 1000)
    return null
  } catch (e) {
    console.error('getLeagueEndTime failed:', e)
    return null
  }
}

// Pure lifecycle classifier. Mirrors getDraftStatus() but adds the terminal
// 'final' phase once the event's last auction has ended.
//   'upcoming' → draft hasn't opened
//   'drafting' → draft window is open
//   'live'     → draft closed, cars still trading
//   'final'    → every auction has ended; results are in
export function getEventPhase(league, eventEndTime, now = new Date()) {
  const start = league?.draft_starts_at ? new Date(league.draft_starts_at) : null
  const end = league?.draft_ends_at ? new Date(league.draft_ends_at) : null
  const isFinal = !!eventEndTime && now > new Date(eventEndTime)

  if (!start || !end) return isFinal ? 'final' : 'drafting'
  if (now < start) return 'upcoming'
  if (now >= start && now <= end) return 'drafting'
  return isFinal ? 'final' : 'live'
}
