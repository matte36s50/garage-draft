import { useState, useEffect } from 'react';
import StatsCards from './StatsCards';
import PerformanceChart from './PerformanceChart';
import EnhancedLeaderboard from './EnhancedLeaderboard';
import ActivityFeed from './ActivityFeed';
import { calculateUserScore, calculateLeagueStats } from '../utils/scoreCalculation';

export default function Dashboard({ supabase, user, leagues, selectedLeague, onLeagueChange, onNavigate }) {
  const [userStats, setUserStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    if (selectedLeague && user) {
      fetchDashboardStats();
    }
  }, [selectedLeague, user]);

  async function fetchDashboardStats() {
    try {
      setLoading(true);

      // Calculate user's score in real-time
      const userScore = await calculateUserScore(supabase, user.id, selectedLeague.id);

      // Calculate league-wide stats in real-time
      const leagueStats = await calculateLeagueStats(supabase, selectedLeague.id);

      // Find user's rank in the league
      const userRankIndex = leagueStats.scores.findIndex(s => s.userId === user.id);
      const userRank = userRankIndex >= 0 ? userRankIndex + 1 : 0;

      // Get rank change from database (we still need historical data for this)
      const { data: userMember } = await supabase
        .from('league_members')
        .select('rank, rank_change, win_streak')
        .eq('league_id', selectedLeague.id)
        .eq('user_id', user.id)
        .maybeSingle();

      // Calculate how far behind the leader
      const behindLeader = leagueStats.leader
        ? (leagueStats.leader.totalScore - userScore.totalPercentGain)
        : 0;

      setUserStats({
        userId: user.id,
        username: user.user_metadata?.username || user.email?.split('@')[0] || 'Player',
        rank: userRank,
        rankChange: userMember?.rank_change || 0,
        totalGain: userScore.totalPercentGain,
        totalDollarGain: userScore.totalDollarGain,
        leagueAvg: leagueStats.leagueAvg,
        behindLeader,
        budgetUsed: userScore.totalSpent,
        totalMembers: leagueStats.totalMembers,
        winStreak: userMember?.win_streak || 0,
        carsCount: userScore.carsCount,
        avgPercentPerCar: userScore.avgPercentPerCar,
        bestCar: userScore.bestCar,
        worstCar: userScore.worstCar,
        bonusScore: userScore.bonusScore,
        carsData: userScore.carsData
      });
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    await fetchDashboardStats();
    setRecalculating(false);
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
              Real-time performance tracking • Updated just now
            </p>
          </div>

          <div className="flex items-center gap-3">
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

            <button
              onClick={handleRecalculate}
              disabled={recalculating}
              className="bg-bpCream/10 hover:bg-bpCream/20 text-bpCream px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <svg
                className={`w-5 h-5 ${recalculating ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {recalculating ? 'Updating...' : 'Refresh'}
            </button>
          </div>
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

        {/* Best Performing Car Showcase */}
        {userStats?.bestCar && (
          <div className="mb-6 bg-gradient-to-br from-bpGold/20 to-bpGold/5 border-2 border-bpGold rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-32 h-32 rounded-lg overflow-hidden bg-bpNavy border border-bpGold">
                  {userStats.bestCar.imageUrl ? (
                    <img
                      src={userStats.bestCar.imageUrl}
                      alt={userStats.bestCar.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-bpGray">
                      <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-grow">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <svg className="w-5 h-5 text-bpGold" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      <h3 className="text-lg font-bold text-bpGold">Your Best Performer</h3>
                    </div>
                    <p className="text-xl font-semibold text-bpCream mb-1">
                      {userStats.bestCar.title}
                    </p>
                    {userStats.bestCar.reserveNotMet && (
                      <p className="text-sm text-orange-400 mb-2">
                        ⚠️ Reserve not met (25% penalty applied)
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-bpGray mb-1">Purchase Price</p>
                    <p className="text-lg font-bold text-bpCream">
                      ${userStats.bestCar.purchasePrice.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-bpGray mb-1">Current Value</p>
                    <p className="text-lg font-bold text-bpCream">
                      ${userStats.bestCar.currentPrice.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-bpGray mb-1">Gain</p>
                    <p className={`text-lg font-bold ${userStats.bestCar.percentGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {userStats.bestCar.percentGain >= 0 ? '+' : ''}{userStats.bestCar.percentGain.toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-bpGray mb-1">Profit</p>
                    <p className={`text-lg font-bold ${userStats.bestCar.dollarGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {userStats.bestCar.dollarGain >= 0 ? '+' : ''}${userStats.bestCar.dollarGain.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bonus Car Section */}
        {userStats?.bonusScore?.hasPrediction && (
          <div className="mb-6 bg-bpCream/5 border border-bpCream/20 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-6 h-6 text-bpGold" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
              </svg>
              <h3 className="text-xl font-bold text-bpCream">Bonus Car Prediction</h3>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-bpGray mb-1">Your Prediction</p>
                <p className="text-lg font-bold text-bpCream">
                  ${userStats.bonusScore.predicted.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-bpGray mb-1">Actual Price</p>
                <p className="text-lg font-bold text-bpCream">
                  ${userStats.bonusScore.actual.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-bpGray mb-1">Accuracy</p>
                <p className={`text-lg font-bold ${userStats.bonusScore.percentError <= 10 ? 'text-green-400' : 'text-orange-400'}`}>
                  {userStats.bonusScore.percentError.toFixed(1)}% off
                </p>
              </div>
              <div>
                <p className="text-xs text-bpGray mb-1">Bonus Points</p>
                <p className="text-lg font-bold text-bpGold">
                  +{userStats.bonusScore.bonusPoints} pts
                </p>
              </div>
            </div>
          </div>
        )}

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
