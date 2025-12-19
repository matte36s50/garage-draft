import { useState, useEffect } from 'react';
import { Trophy, Target, TrendingUp, Calendar, Car, ChevronRight, Award, Clock } from 'lucide-react';

export default function UserHistory({ supabase, user }) {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState({
    totalLeagues: 0,
    wins: 0,
    bestFinish: null,
    avgRank: 0
  });

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user]);

  async function fetchHistory() {
    try {
      setLoading(true);

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
    } finally {
      setLoading(false);
    }
  }

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
      const gain = ((finalPrice - purchasePrice) / purchasePrice) * 100;

      if (gain > bestGain) {
        bestGain = gain;
        bestCar = { ...car, percentGain: gain };
      }
    });

    return bestCar;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-bpGold"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-bpCream">My History</h2>
          <p className="text-sm text-bpCream/70">Your completed leagues and results</p>
        </div>
        <Clock className="text-bpGold" size={24} />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 text-bpGray text-xs mb-1">
            <Target size={14} />
            <span>Leagues Played</span>
          </div>
          <div className="text-2xl font-bold text-bpCream">{stats.totalLeagues}</div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 text-bpGray text-xs mb-1">
            <Trophy size={14} className="text-bpGold" />
            <span>Wins</span>
          </div>
          <div className="text-2xl font-bold text-bpGold">{stats.wins}</div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 text-bpGray text-xs mb-1">
            <Award size={14} />
            <span>Best Finish</span>
          </div>
          <div className="text-2xl font-bold text-bpCream">
            {stats.bestFinish ? `#${stats.bestFinish}` : '-'}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 text-bpGray text-xs mb-1">
            <TrendingUp size={14} />
            <span>Avg Rank</span>
          </div>
          <div className="text-2xl font-bold text-bpCream">
            {stats.avgRank > 0 ? stats.avgRank.toFixed(1) : '-'}
          </div>
        </div>
      </div>

      {/* League Results List */}
      <div>
        <h3 className="text-lg font-semibold text-bpCream mb-3">Completed Leagues</h3>

        {results.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
            <Trophy className="mx-auto text-bpGray mb-3" size={40} />
            <p className="text-bpGray">No completed leagues yet</p>
            <p className="text-bpGray/70 text-sm mt-1">
              Your league history will appear here once leagues are completed
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((result) => {
              const league = result.leagues;
              const bestCar = getBestCar(result.cars_snapshot);

              return (
                <div
                  key={result.id}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Left side - League info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {result.is_winner && (
                          <Trophy className="text-bpGold flex-shrink-0" size={18} />
                        )}
                        <h4 className="font-semibold text-bpCream truncate">
                          {league?.name || 'Unknown League'}
                        </h4>
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-sm text-bpGray">
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {league?.draft_starts_at && league?.draft_ends_at
                            ? formatDateRange(league.draft_starts_at, league.draft_ends_at)
                            : 'Date unknown'}
                        </span>
                        <span>|</span>
                        <span className="flex items-center gap-1">
                          <Car size={12} />
                          {result.car_count} cars
                        </span>
                      </div>

                      {/* Best performing car */}
                      {bestCar && (
                        <div className="mt-2 text-xs text-bpGray/80">
                          Best pick: <span className="text-bpCream">{bestCar.title}</span>
                          <span className={`ml-1 ${bestCar.percentGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            ({bestCar.percentGain >= 0 ? '+' : ''}{bestCar.percentGain.toFixed(1)}%)
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right side - Score and Rank */}
                    <div className="text-right flex-shrink-0">
                      <div className={`text-lg font-bold ${
                        result.is_winner
                          ? 'text-bpGold'
                          : result.final_rank <= 3
                            ? 'text-green-400'
                            : 'text-bpCream'
                      }`}>
                        #{result.final_rank}
                      </div>
                      <div className={`text-sm font-medium ${
                        result.final_score >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {result.final_score >= 0 ? '+' : ''}{result.final_score.toFixed(1)}%
                      </div>
                      <div className="text-xs text-bpGray mt-1">
                        ${result.total_spent?.toLocaleString() || 0} spent
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
