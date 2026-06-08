import { useState, useEffect, useCallback } from 'react';

export default function UserHistory({ supabase, user }) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState({
    totalLeagues: 0,
    wins: 0,
    bestFinish: null,
    avgRank: 0
  });

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);

      // Fetch user's league results
      const { data: leagueResults, error } = await supabase
        .from('league_results')
        .select(`
          id,
          league_id,
          final_rank,
          final_score,
          total_spent,
          car_count,
          is_winner,
          cars_snapshot,
          created_at,
          leagues (
            id,
            name,
            draft_starts_at,
            draft_ends_at,
            completed_at,
            spending_limit
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching history:', error);
        setFetchError(error.message || 'Failed to load auction history');
        setResults([]);
        return;
      }

      setResults(leagueResults || []);

      // Calculate summary stats
      if (leagueResults && leagueResults.length > 0) {
        const wins = leagueResults.filter(r => r.is_winner).length;
        const bestFinish = Math.min(...leagueResults.map(r => r.final_rank));
        const avgRank = leagueResults.reduce((sum, r) => sum + r.final_rank, 0) / leagueResults.length;

        setStats({
          totalLeagues: leagueResults.length,
          wins,
          bestFinish,
          avgRank: parseFloat(avgRank.toFixed(1))
        });
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
      setFetchError(error.message || 'Failed to load auction history');
    } finally {
      setLoading(false);
    }
  }, [supabase, user]);

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user, fetchHistory]);

  // Format date range
  const formatDateRange = (start, end) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const options = { month: 'short', day: 'numeric' };
    return `${startDate.toLocaleDateString('en-US', options)} - ${endDate.toLocaleDateString('en-US', options)}`;
  };

  // Get best performing car from snapshot
  const getBestCar = (carsSnapshot) => {
    if (!carsSnapshot || carsSnapshot.length === 0) return null;

    let bestCar = null;
    let bestGain = -Infinity;

    carsSnapshot.forEach(car => {
      const purchasePrice = parseFloat(car.purchase_price);
      const finalPrice = parseFloat(car.final_price);
      const gain = purchasePrice > 0 ? ((finalPrice - purchasePrice) / purchasePrice) * 100 : 0;

      if (!isNaN(gain) && gain > bestGain) {
        bestGain = gain;
        bestCar = { ...car, percentGain: gain };
      }
    });

    return bestCar;
  };

  // Direction C tokens (kept local so this component is self-contained)
  const C = {
    bg: '#0a0a0c', surface: '#15161b', surfaceHi: '#1c1d23',
    border: 'rgba(255,255,255,0.08)', borderHi: 'rgba(255,255,255,0.16)',
    text: '#f4f4f5', muted: '#8a8a92', faint: '#52525a',
    red: '#ef3a32', amber: '#f5c542', pos: '#5cd17a', neg: '#ef3a32',
  };
  const mono = 'ui-monospace,"JetBrains Mono",monospace';

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid ${C.border}`, borderTopColor: C.red, animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 22px 0', fontFamily: 'Inter,system-ui,sans-serif' }}>
      {/* Career Stats */}
      <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, letterSpacing: 1.5, marginBottom: 12 }}>{'//'} CAREER STATS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: `1px solid ${C.border}`, background: C.surface }}>
        {[
          { label: 'RACES', value: stats.totalLeagues, color: C.text },
          { label: 'WINS', value: stats.wins, color: stats.wins > 0 ? C.amber : C.text },
          { label: 'BEST FINISH', value: stats.bestFinish ? `P${String(stats.bestFinish).padStart(2, '0')}` : '—', color: stats.bestFinish === 1 ? C.amber : C.text },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: '14px 16px', borderLeft: i === 0 ? 'none' : `1px solid ${C.border}` }}>
            <div style={{ fontFamily: mono, fontSize: 11, color: C.faint, letterSpacing: 1.2, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontFamily: mono, fontSize: 28, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>
      {/* Avg finish row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${C.border}`, borderTop: 'none', background: C.surface, padding: '12px 16px' }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: C.muted, letterSpacing: 1.2 }}>AVG FINISH</span>
        <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
          {stats.avgRank > 0 ? `P${stats.avgRank.toFixed(1)}` : '—'}
        </span>
      </div>

      {/* Past Auctions */}
      <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, letterSpacing: 1.5, margin: '22px 0 12px' }}>{'//'} PAST AUCTIONS</div>

      {fetchError ? (
        <div style={{ background: 'rgba(239,58,50,0.08)', border: `1px solid ${C.red}55`, padding: 24, textAlign: 'center' }}>
          <p style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: C.red, letterSpacing: 1 }}>FAILED TO LOAD HISTORY</p>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>{fetchError}</p>
        </div>
      ) : results.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 28, textAlign: 'center' }}>
          <p style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 1.2 }}>NO COMPLETED AUCTIONS YET</p>
          <p style={{ fontSize: 13, color: C.faint, marginTop: 6 }}>Your auction history will appear here once auctions are completed.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map((result) => {
            const league = result.leagues;
            const bestCar = getBestCar(result.cars_snapshot);
            const podium = result.final_rank <= 3;
            const accent = result.is_winner ? C.amber : podium ? C.pos : C.border;
            const rankColor = result.is_winner ? C.amber : podium ? C.pos : C.text;
            const scoreColor = result.final_score >= 0 ? C.pos : C.neg;
            const cars = Array.isArray(result.cars_snapshot) ? result.cars_snapshot : [];

            return (
              <div key={result.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `4px solid ${accent}`, padding: '14px 16px' }}>
                {/* Top row: rank + earnings */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 800, color: rankColor, letterSpacing: 0.5 }}>
                        P{String(result.final_rank).padStart(2, '0')}
                      </span>
                      {result.is_winner && (
                        <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: C.amber, letterSpacing: 1 }}>★ WIN</span>
                      )}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.2, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {league?.name || 'Unknown Auction'}
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 11, color: C.muted, letterSpacing: 0.5, marginTop: 5 }}>
                      {league?.draft_starts_at && league?.draft_ends_at
                        ? formatDateRange(league.draft_starts_at, league.draft_ends_at)
                        : 'DATE UNKNOWN'}
                      {' · '}{result.car_count} CARS
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 800, color: scoreColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {result.final_score >= 0 ? '+' : ''}{result.final_score.toFixed(1)}%
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 11, color: C.faint, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                      ${result.total_spent?.toLocaleString() || 0} SPENT
                    </div>
                  </div>
                </div>

                {/* Car chips */}
                {cars.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                    {cars.slice(0, 4).map((car, idx) => (
                      <span key={idx} style={{ fontFamily: mono, fontSize: 11, color: C.muted, background: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: 2, padding: '4px 8px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {car.title}
                      </span>
                    ))}
                    {cars.length > 4 && (
                      <span style={{ fontFamily: mono, fontSize: 11, color: C.faint, padding: '4px 4px' }}>+{cars.length - 4}</span>
                    )}
                  </div>
                )}

                {/* Best pick */}
                {bestCar && (
                  <div style={{ fontFamily: mono, fontSize: 11, color: C.faint, letterSpacing: 0.5, marginTop: 10 }}>
                    BEST PICK <span style={{ color: C.muted }}>{bestCar.title}</span>
                    <span style={{ color: bestCar.percentGain >= 0 ? C.pos : C.neg, marginLeft: 6 }}>
                      {isNaN(bestCar.percentGain) ? '—' : `${bestCar.percentGain >= 0 ? '+' : ''}${bestCar.percentGain.toFixed(1)}%`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
