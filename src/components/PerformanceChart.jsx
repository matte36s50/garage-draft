import { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { calculateUserScore, calculateLeagueStats, calculateMarketAverage } from '../utils/scoreCalculation';

export default function PerformanceChart({ supabase, leagueId, userId }) {
  const [chartData, setChartData] = useState([]);
  const [topUsers, setTopUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPerformanceData = useCallback(async () => {
    try {
      console.log('[Performance Chart] Fetching data for league:', leagueId, 'user:', userId);

      // Get all performance history for this league
      const { data: history, error } = await supabase
        .from('performance_history')
        .select('*')
        .eq('league_id', leagueId)
        .order('timestamp', { ascending: true });

      if (error) throw error;

      console.log('[Performance Chart] History data:', {
        count: history?.length || 0,
        sample: history?.[0]
      });

      // Calculate current market average (always fetch this for real-time display)
      const marketAvg = await calculateMarketAverage(supabase, leagueId);
      console.log('[Performance Chart] Market average (% gain):', marketAvg.marketAverage + '%');

      // If there's no historical data, create a current snapshot using real-time calculations
      if (!history || history.length === 0) {
        console.log('[Performance Chart] No history found, calculating real-time snapshot');

        // Calculate current league stats
        const leagueStats = await calculateLeagueStats(supabase, leagueId);
        const userScore = await calculateUserScore(supabase, userId, leagueId);

        console.log('[Performance Chart] Real-time calculations:', {
          userScore: '$' + userScore.totalScore.toLocaleString(),
          leagueAvg: '$' + leagueStats.leagueAvg.toLocaleString(),
          leagueStats: leagueStats.scores.slice(0, 3).map(u => ({
            username: u.username,
            score: '$' + u.totalScore.toLocaleString()
          }))
        });

        // Create a single data point with current time
        const now = new Date().toISOString();
        const currentPoint = {
          timestamp: now,
          yourGain: userScore.totalScore,
          marketAvg: leagueStats.leagueAvg
        };

        // Add top 3 players' scores
        const topThree = leagueStats.scores.slice(0, 3);
        topThree.forEach((user, index) => {
          currentPoint[`top${index + 1}`] = user.totalScore;
        });

        console.log('[Performance Chart] Current point data:', currentPoint);

        setChartData([currentPoint]);
        setTopUsers(topThree.map(u => ({
          userId: u.userId,
          username: u.username
        })));
      } else {
        // Use historical data if available
        // Get top 3 users by current rank
        const { data: topUsersData } = await supabase
          .from('league_members')
          .select('user_id, users(username)')
          .eq('league_id', leagueId)
          .order('total_score', { ascending: false })
          .limit(3);

        // Format data for charting
        const timestamps = [...new Set(history.map(h => h.timestamp))].sort();

        // Track last known values to avoid dropping to zero
        let lastUserGain = 0;
        const lastTopGains = [0, 0, 0];

        const formattedData = timestamps.map(timestamp => {
          const point = { timestamp };

          // Get user's data at this timestamp
          const userPoint = history.find(h =>
            h.timestamp === timestamp && h.user_id === userId
          );
          // If user has data at this timestamp, use it and update last known value
          // Otherwise, carry forward the last known value (don't drop to zero)
          if (userPoint?.cumulative_gain !== null && userPoint?.cumulative_gain !== undefined) {
            lastUserGain = userPoint.cumulative_gain;
          }
          point.yourGain = lastUserGain;

          // Add market average (use historical if available in snapshot, otherwise current)
          const anyPointAtTimestamp = history.find(h => h.timestamp === timestamp);
          point.marketAvg = anyPointAtTimestamp?.snapshot?.marketAverage ?? marketAvg.marketAverage;

          // Get top 3 users' data
          topUsersData?.forEach((user, index) => {
            const userHistory = history.find(h =>
              h.timestamp === timestamp && h.user_id === user.user_id
            );
            // Carry forward last known value if no data at this timestamp
            if (userHistory?.cumulative_gain !== null && userHistory?.cumulative_gain !== undefined) {
              lastTopGains[index] = userHistory.cumulative_gain;
            }
            point[`top${index + 1}`] = lastTopGains[index];
          });

          return point;
        });

        setChartData(formattedData);
        setTopUsers(topUsersData?.map(u => ({
          userId: u.user_id,
          username: u.users?.username
        })) || []);
      }
    } catch (error) {
      console.error('Failed to fetch performance data:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase, leagueId, userId]);

  useEffect(() => {
    if (leagueId && userId) {
      fetchPerformanceData();
    }
  }, [leagueId, userId, fetchPerformanceData]);

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="animate-pulse">
          <div className="h-6 bg-slate-700 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-slate-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h3 className="text-lg font-bold mb-4 text-teal-400">Portfolio Value Over Time</h3>
        <div className="text-center py-12 text-slate-400">
          <p>Performance data will appear as the week progresses</p>
        </div>
      </div>
    );
  }

  const latestData = chartData[chartData.length - 1] || {};

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h3 className="text-lg font-bold mb-4 text-teal-400">Portfolio Value Over Time</h3>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(ts) => format(new Date(ts), 'MMM d, h:mm a')}
            tick={{ fontSize: 12, fill: '#94a3b8' }}
          />
          <YAxis
            label={{ value: 'Portfolio Value', angle: -90, position: 'insideLeft', fill: '#94a3b8', dx: -10 }}
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            width={70}
          />
          <Tooltip
            labelFormatter={(ts) => format(new Date(ts), 'MMM d, yyyy h:mm a')}
            formatter={(value) => [`$${Number(value).toLocaleString()}`, '']}
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f8fafc' }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend wrapperStyle={{ color: '#94a3b8' }} />

          <Line
            type="monotone"
            dataKey="yourGain"
            stroke="#14b8a6"
            strokeWidth={3}
            name="You"
            dot={{ r: 3, fill: '#14b8a6' }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="top1"
            stroke="#C2A14D"
            strokeWidth={2}
            name={topUsers[0]?.username || "1st Place"}
            strokeDasharray="5 5"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="top2"
            stroke="#94a3b8"
            strokeWidth={2}
            name={topUsers[1]?.username || "2nd Place"}
            strokeDasharray="5 5"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="top3"
            stroke="#64748b"
            strokeWidth={2}
            name={topUsers[2]?.username || "3rd Place"}
            strokeDasharray="5 5"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="marketAvg"
            stroke="#22C55E"
            strokeWidth={2}
            name="League Avg"
            strokeDasharray="3 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-4 bg-teal-500/10 rounded-lg border border-teal-500/20">
          <div className="text-2xl font-bold text-teal-400">
            ${(latestData.yourGain || 0).toLocaleString()}
          </div>
          <div className="text-sm text-slate-400 mt-1">Your Portfolio</div>
        </div>
        <div className="text-center p-4 bg-green-500/10 rounded-lg border border-green-500/20">
          <div className="text-2xl font-bold text-green-400">
            ${(latestData.marketAvg || 0).toLocaleString()}
          </div>
          <div className="text-sm text-slate-400 mt-1">League Avg</div>
        </div>
        <div className="text-center p-4 bg-slate-700/50 rounded-lg border border-slate-600">
          <div className="text-2xl font-bold text-slate-200">
            ${((latestData.top1 || 0) - (latestData.yourGain || 0)).toLocaleString()}
          </div>
          <div className="text-sm text-slate-400 mt-1">Behind Leader (${(latestData.top1 || 0).toLocaleString()})</div>
        </div>
        <div className="text-center p-4 bg-bpGold/10 rounded-lg border border-bpGold/20">
          <div className="text-2xl font-bold text-bpGold">
            #{calculateRank(latestData)}
          </div>
          <div className="text-sm text-slate-400 mt-1">Current Rank</div>
        </div>
      </div>
    </div>
  );
}

function calculateRank(latestData) {
  if (!latestData || latestData.yourGain === undefined) return '-';

  const scores = [
    latestData.top1,
    latestData.top2,
    latestData.top3,
    latestData.yourGain
  ].filter(score => score !== undefined).sort((a, b) => b - a);

  const rank = scores.indexOf(latestData.yourGain) + 1;
  return rank > 0 ? rank : '-';
}
