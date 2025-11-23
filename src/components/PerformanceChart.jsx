import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

export default function PerformanceChart({ supabase, leagueId, userId }) {
  const [chartData, setChartData] = useState([]);
  const [topUsers, setTopUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (leagueId && userId) {
      fetchPerformanceData();
    }
  }, [leagueId, userId]);

  async function fetchPerformanceData() {
    try {
      // Get all performance history for this league
      const { data: history, error } = await supabase
        .from('performance_history')
        .select('*')
        .eq('league_id', leagueId)
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // Get top 3 users by current rank
      const { data: topUsersData } = await supabase
        .from('league_members')
        .select('user_id, users(username)')
        .eq('league_id', leagueId)
        .order('total_score', { ascending: false })
        .limit(3);

      // Format data for charting
      const timestamps = [...new Set(history?.map(h => h.timestamp) || [])].sort();

      const formattedData = timestamps.map(timestamp => {
        const point = { timestamp };

        // Get user's data at this timestamp
        const userPoint = history?.find(h =>
          h.timestamp === timestamp && h.user_id === userId
        );
        point.yourGain = userPoint?.cumulative_gain || 0;

        // Get top 3 users' data
        topUsersData?.forEach((user, index) => {
          const userHistory = history?.find(h =>
            h.timestamp === timestamp && h.user_id === user.user_id
          );
          point[`top${index + 1}`] = userHistory?.cumulative_gain || 0;
        });

        return point;
      });

      setChartData(formattedData);
      setTopUsers(topUsersData?.map(u => ({
        userId: u.user_id,
        username: u.users?.username
      })) || []);
    } catch (error) {
      console.error('Failed to fetch performance data:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-bpCream rounded-lg p-6 border border-bpNavy/10">
        <div className="animate-pulse">
          <div className="h-6 bg-bpNavy/10 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-bpNavy/10 rounded"></div>
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-bpCream rounded-lg p-6 border border-bpNavy/10">
        <h3 className="text-lg font-bold mb-4 text-bpRed">Performance Over Time</h3>
        <div className="text-center py-12 text-bpGray">
          <p>Performance data will appear as the week progresses</p>
        </div>
      </div>
    );
  }

  const latestData = chartData[chartData.length - 1] || {};

  return (
    <div className="bg-bpCream rounded-lg p-6 border border-bpNavy/10">
      <h3 className="text-lg font-bold mb-4 text-bpRed">Performance Over Time</h3>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0F1A2B20" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(ts) => format(new Date(ts), 'MMM d, h:mm a')}
            tick={{ fontSize: 12, fill: '#111111' }}
          />
          <YAxis
            label={{ value: '% Gain', angle: -90, position: 'insideLeft', fill: '#111111' }}
            tick={{ fontSize: 12, fill: '#111111' }}
            tickFormatter={(value) => `${value.toFixed(1)}%`}
          />
          <Tooltip
            labelFormatter={(ts) => format(new Date(ts), 'MMM d, yyyy h:mm a')}
            formatter={(value) => [`${Number(value).toFixed(2)}%`, '']}
            contentStyle={{ backgroundColor: '#FAF6EE', border: '1px solid #0F1A2B30', borderRadius: '8px' }}
          />
          <Legend />

          <Line
            type="monotone"
            dataKey="yourGain"
            stroke="#D64541"
            strokeWidth={3}
            name="You"
            dot={{ r: 3, fill: '#D64541' }}
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
            stroke="#0F1A2B"
            strokeWidth={2}
            name={topUsers[1]?.username || "2nd Place"}
            strokeDasharray="5 5"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="top3"
            stroke="#B0B3B8"
            strokeWidth={2}
            name={topUsers[2]?.username || "3rd Place"}
            strokeDasharray="5 5"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="text-center p-4 bg-bpRed/10 rounded-lg">
          <div className="text-2xl font-bold text-bpRed">
            {latestData.yourGain?.toFixed(2) || '0.00'}%
          </div>
          <div className="text-sm text-bpInk/70 mt-1">Your Gain</div>
        </div>
        <div className="text-center p-4 bg-bpNavy/5 rounded-lg">
          <div className="text-2xl font-bold text-bpInk">
            {((latestData.top1 || 0) - (latestData.yourGain || 0)).toFixed(2)}%
          </div>
          <div className="text-sm text-bpInk/70 mt-1">Behind Leader</div>
        </div>
        <div className="text-center p-4 bg-bpGold/10 rounded-lg">
          <div className="text-2xl font-bold text-bpGold">
            #{calculateRank(latestData)}
          </div>
          <div className="text-sm text-bpInk/70 mt-1">Current Rank</div>
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
