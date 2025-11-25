import { useState, useEffect } from 'react';
import StatsCards from './StatsCards';
import PerformanceChart from './PerformanceChart';
import EnhancedLeaderboard from './EnhancedLeaderboard';
import ActivityFeed from './ActivityFeed';

export default function Dashboard({ supabase, user, leagues, selectedLeague, onLeagueChange, onNavigate }) {
  const [userStats, setUserStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (selectedLeague && user) {
      fetchDashboardStats();
    }
  }, [selectedLeague, user]);

  async function fetchDashboardStats() {
    try {
      setLoading(true);

      // Get user's league member data
      const { data: userMember } = await supabase
        .from('league_members')
        .select('*')
        .eq('league_id', selectedLeague.id)
        .eq('user_id', user.id)
        .single();

      // Get total members count
      const { count: totalMembers } = await supabase
        .from('league_members')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', selectedLeague.id);

      // Get league average
      const { data: avgData } = await supabase
        .from('league_members')
        .select('total_score')
        .eq('league_id', selectedLeague.id);

      const leagueAvg = avgData?.length > 0
        ? avgData.reduce((sum, m) => sum + (m.total_score || 0), 0) / avgData.length
        : 0;

      // Get leader's score
      const { data: leader } = await supabase
        .from('league_members')
        .select('total_score')
        .eq('league_id', selectedLeague.id)
        .order('total_score', { ascending: false })
        .limit(1)
        .single();

      const behindLeader = leader ? (leader.total_score - (userMember?.total_score || 0)) : 0;

      // Get user's garage info
      const { data: garageCars } = await supabase
        .from('garage_cars')
        .select('purchase_price')
        .eq('league_id', selectedLeague.id)
        .eq('user_id', user.id);

      const budgetUsed = garageCars?.reduce((sum, car) => sum + (car.purchase_price || 0), 0) || 0;

      setUserStats({
        userId: user.id,
        username: user.user_metadata?.username || user.email?.split('@')[0] || 'Player',
        rank: userMember?.rank || 0,
        rankChange: userMember?.rank_change || 0,
        totalGain: userMember?.total_score || 0,
        leagueAvg,
        behindLeader,
        budgetUsed,
        totalMembers,
        winStreak: userMember?.win_streak || 0
      });
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading && !userStats) {
    return (
      <div className="min-h-screen bg-bpNavy flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">
            <svg className="animate-spin h-10 w-10 mx-auto text-bpGold" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <div className="text-lg text-bpGray">Loading your dashboard...</div>
        </div>
      </div>
    );
  }

  if (!selectedLeague) {
    return (
      <div className="min-h-screen bg-bpNavy flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <div className="text-6xl mb-4">
            <svg className="w-16 h-16 mx-auto text-bpGray" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2 text-bpCream">No Active Leagues</h1>
          <p className="text-bpGray mb-6">
            Join or create a league to start playing!
          </p>
          <button
            onClick={() => onNavigate('leagues')}
            className="bg-bpRed text-bpCream px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"
          >
            Browse Leagues
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bpNavy">
      {/* Main Content - no separate header, integrates with app nav */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Welcome Section */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-bpCream">
              Welcome back, {userStats?.username || 'Player'}!
            </h1>
            <p className="text-bpGray mt-1">
              Track your performance and climb the leaderboard
            </p>
          </div>

          {userStats?.winStreak > 0 && (
            <div className="bg-bpGold/20 border-2 border-bpGold rounded-lg px-4 py-2 text-center">
              <div className="text-2xl">
                <svg className="w-6 h-6 mx-auto text-bpGold" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="text-sm font-bold text-bpGold">
                {userStats.winStreak} Week Streak!
              </div>
            </div>
          )}
        </div>

        {/* League Tabs */}
        {leagues.length > 1 && (
          <div className="mb-6 bg-bpNavy border border-bpCream/20 rounded-lg p-2 flex gap-2 overflow-x-auto">
            {leagues.map((league) => (
              <button
                key={league.id}
                onClick={() => onLeagueChange(league)}
                className={`
                  px-4 py-2 rounded-md font-medium whitespace-nowrap transition-colors
                  ${selectedLeague?.id === league.id
                    ? 'bg-bpRed text-bpCream'
                    : 'bg-bpCream/10 text-bpCream hover:bg-bpCream/20'
                  }
                `}
              >
                {league.name}
              </button>
            ))}
          </div>
        )}

        {/* Stats Overview */}
        <div className="mb-6">
          <StatsCards stats={userStats} />
        </div>

        {/* Performance Chart */}
        <div className="mb-6">
          <PerformanceChart
            supabase={supabase}
            leagueId={selectedLeague.id}
            userId={user.id}
          />
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Leaderboard */}
          <div className="lg:col-span-2">
            <EnhancedLeaderboard
              supabase={supabase}
              leagueId={selectedLeague.id}
              currentUserId={user.id}
            />
          </div>

          {/* Right Column - Activity Feed */}
          <div>
            <ActivityFeed
              supabase={supabase}
              leagueId={selectedLeague.id}
              limit={20}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
