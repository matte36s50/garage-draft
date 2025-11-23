import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export default function EnhancedLeaderboard({ supabase, leagueId, currentUserId }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (leagueId) {
      fetchLeaderboard();

      // Refresh every minute
      const interval = setInterval(fetchLeaderboard, 60000);
      return () => clearInterval(interval);
    }
  }, [leagueId]);

  async function fetchLeaderboard() {
    try {
      // Get all league members with their stats
      const { data: members, error } = await supabase
        .from('league_members')
        .select(`
          user_id,
          total_score,
          rank,
          rank_change,
          users (
            id,
            username
          )
        `)
        .eq('league_id', leagueId)
        .order('total_score', { ascending: false });

      if (error) throw error;

      // Get garage info for each member
      const membersWithGarages = await Promise.all(
        (members || []).map(async (member, index) => {
          const { data: garageCars } = await supabase
            .from('garage_cars')
            .select('purchase_price')
            .eq('league_id', leagueId)
            .eq('user_id', member.user_id);

          const totalSpent = garageCars?.reduce((sum, car) =>
            sum + (car.purchase_price || 0), 0
          ) || 0;

          const carCount = garageCars?.length || 0;

          return {
            userId: member.user_id,
            username: member.users?.username || 'Anonymous',
            totalScore: member.total_score || 0,
            rank: member.rank || index + 1,
            rankChange: member.rank_change || 0,
            totalSpent,
            carCount,
            qualifies: totalSpent >= 125000
          };
        })
      );

      setLeaderboard(membersWithGarages);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-bold mb-4">Leaderboard</h3>

      <div className="space-y-2">
        {leaderboard.map((member, index) => (
          <LeaderboardRow
            key={member.userId}
            member={member}
            index={index}
            isCurrentUser={member.userId === currentUserId}
          />
        ))}
      </div>

      {leaderboard.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No players yet</p>
        </div>
      )}
    </div>
  );
}

function LeaderboardRow({ member, index, isCurrentUser }) {
  const getRankDisplay = (rank) => {
    if (rank === 1) return <span className="text-2xl">1st</span>;
    if (rank === 2) return <span className="text-2xl">2nd</span>;
    if (rank === 3) return <span className="text-2xl">3rd</span>;
    return `#${rank}`;
  };

  const getRankChangeIcon = (change) => {
    if (change > 0) return (
      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
      </svg>
    );
    if (change < 0) return (
      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
      </svg>
    );
    return (
      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
      </svg>
    );
  };

  const getTrendColor = (change) => {
    if (change > 0) return 'text-green-600';
    if (change < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`
        flex items-center gap-4 p-4 rounded-lg border-2 transition-all
        ${isCurrentUser
          ? 'bg-blue-50 border-blue-300 shadow-md'
          : 'bg-white border-gray-200 hover:border-gray-300'
        }
      `}
    >
      {/* Rank */}
      <div className="text-xl font-bold w-12 text-center text-gray-700">
        {getRankDisplay(member.rank)}
      </div>

      {/* Username */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-900 truncate flex items-center gap-2">
          {member.username}
          {isCurrentUser && (
            <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded">
              YOU
            </span>
          )}
          {!member.qualifies && (
            <span className="text-xs bg-yellow-500 text-white px-2 py-1 rounded" title="Below $125K minimum spend">
              DQ
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {member.carCount} cars | ${(member.totalSpent / 1000).toFixed(0)}K spent
        </div>
      </div>

      {/* Score */}
      <div className="text-right">
        <div className={`text-xl font-bold ${member.totalScore >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {member.totalScore >= 0 ? '+' : ''}{member.totalScore.toFixed(2)}%
        </div>
        <div className={`text-xs font-semibold flex items-center justify-end gap-1 ${getTrendColor(member.rankChange)}`}>
          {getRankChangeIcon(member.rankChange)}
          {member.rankChange !== 0 && (
            <span>{Math.abs(member.rankChange)}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
