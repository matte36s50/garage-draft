import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { calculateUserScore } from '../utils/scoreCalculation';

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
      // Get all league members
      const { data: members, error } = await supabase
        .from('league_members')
        .select(`
          user_id,
          rank_change,
          users (
            id,
            username
          )
        `)
        .eq('league_id', leagueId);

      if (error) throw error;

      // Get league spending limit for qualification check
      const { data: league } = await supabase
        .from('leagues')
        .select('spending_limit')
        .eq('id', leagueId)
        .single();

      const spendingLimit = league?.spending_limit || 200000;
      const minimumSpend = spendingLimit * 0.5; // 50% of spending limit

      // Calculate real-time scores for each member
      const membersWithScores = await Promise.all(
        (members || []).map(async (member) => {
          const score = await calculateUserScore(supabase, member.user_id, leagueId);

          return {
            userId: member.user_id,
            username: member.users?.username || 'Anonymous',
            totalScore: score.totalPercentGain,
            rankChange: member.rank_change || 0,
            totalSpent: score.totalSpent,
            carCount: score.carsCount,
            qualifies: score.totalSpent >= minimumSpend,
            minimumSpend: minimumSpend
          };
        })
      );

      // Sort by total score descending and assign ranks
      membersWithScores.sort((a, b) => b.totalScore - a.totalScore);
      const rankedMembers = membersWithScores.map((member, index) => ({
        ...member,
        rank: index + 1
      }));

      setLeaderboard(rankedMembers);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-bpCream rounded-lg p-6 border border-bpNavy/10">
        <div className="animate-pulse">
          <div className="h-6 bg-bpNavy/10 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 bg-bpNavy/10 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bpCream rounded-lg p-6 border border-bpNavy/10">
      <h3 className="text-lg font-bold mb-4 text-bpRed">Leaderboard</h3>

      <div className="space-y-2">
        {leaderboard.map((member, index) => (
          <LeaderboardRow
            key={member.userId}
            member={member}
            index={index}
            isCurrentUser={member.userId === currentUserId}
            minimumSpend={member.minimumSpend}
          />
        ))}
      </div>

      {leaderboard.length === 0 && (
        <div className="text-center py-8 text-bpGray">
          <p>No players yet</p>
        </div>
      )}
    </div>
  );
}

function LeaderboardRow({ member, index, isCurrentUser, minimumSpend }) {
  const getRankDisplay = (rank) => {
    if (rank === 1) return <span className="text-2xl text-bpGold">1st</span>;
    if (rank === 2) return <span className="text-2xl text-bpGray">2nd</span>;
    if (rank === 3) return <span className="text-2xl text-amber-700">3rd</span>;
    return `#${rank}`;
  };

  const getRankChangeIcon = (change) => {
    if (change > 0) return (
      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
      </svg>
    );
    if (change < 0) return (
      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
      </svg>
    );
    return (
      <svg className="w-4 h-4 text-bpGray" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
      </svg>
    );
  };

  const getTrendColor = (change) => {
    if (change > 0) return 'text-emerald-600';
    if (change < 0) return 'text-red-500';
    return 'text-bpGray';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`
        flex items-center gap-4 p-4 rounded-lg border-2 transition-all
        ${isCurrentUser
          ? 'bg-bpRed/10 border-bpRed shadow-md'
          : 'bg-white border-bpNavy/10 hover:border-bpNavy/30'
        }
      `}
    >
      {/* Rank */}
      <div className="text-xl font-bold w-12 text-center text-bpInk">
        {getRankDisplay(member.rank)}
      </div>

      {/* Username */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-bpInk truncate flex items-center gap-2">
          {member.username}
          {isCurrentUser && (
            <span className="text-xs bg-bpRed text-bpCream px-2 py-1 rounded">
              YOU
            </span>
          )}
          {!member.qualifies && (
            <span className="text-xs bg-bpGold text-bpNavy px-2 py-1 rounded" title={`Below $${(minimumSpend / 1000).toFixed(0)}K minimum spend`}>
              DQ
            </span>
          )}
        </div>
        <div className="text-xs text-bpGray">
          {member.carCount} cars | ${(member.totalSpent / 1000).toFixed(0)}K spent
        </div>
      </div>

      {/* Score */}
      <div className="text-right">
        <div className={`text-xl font-bold ${member.totalScore >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
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
