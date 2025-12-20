import { motion } from 'framer-motion';

// Format dollar amount with commas
const formatDollar = (amount) => {
  if (amount === undefined || amount === null) return '$0';
  return '$' + Math.round(amount).toLocaleString();
};

export default function StatsCards({ stats, spendingLimit = 200000 }) {
  const cards = [
    {
      title: 'Your Rank',
      value: stats?.rank != null && stats.rank > 0 ? `#${stats.rank}` : '-',
      subtitle: `of ${stats?.totalMembers != null ? stats.totalMembers : '-'} players`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      trend: stats?.rankChange,
      trendLabel: stats?.rankChange > 0 ? 'Moved up' : stats?.rankChange < 0 ? 'Moved down' : 'No change',
      bgColor: 'bg-bpCream/10',
      iconColor: 'text-bpCream'
    },
    {
      title: 'Total Value',
      value: formatDollar(stats?.totalScore),
      subtitle: `Avg: ${formatDollar(stats?.leagueAvg)}`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
      // Show dollar difference from average
      dollarDiff: stats?.totalScore !== undefined && stats?.leagueAvg !== undefined
        ? stats.totalScore - stats.leagueAvg
        : undefined,
      trendLabel: 'vs Avg',
      bgColor: 'bg-emerald-500/20',
      iconColor: 'text-emerald-400'
    },
    {
      title: 'Behind Leader',
      value: stats?.behindLeader !== undefined ? formatDollar(stats.behindLeader) : '$0',
      subtitle: stats?.behindLeader === 0 ? "You're in 1st!" : 'To 1st place',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
      bgColor: 'bg-bpGold/20',
      iconColor: 'text-bpGold'
    },
    {
      title: 'Roster',
      value: `${stats?.carsCount || 0}/7`,
      subtitle: stats?.isRosterComplete ? 'Complete!' : `${7 - (stats?.carsCount || 0)} more needed`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      progress: stats?.carsCount !== undefined ? (stats.carsCount / 7) * 100 : 0,
      bgColor: stats?.isRosterComplete ? 'bg-emerald-500/20' : 'bg-bpRed/20',
      iconColor: stats?.isRosterComplete ? 'text-emerald-400' : 'text-bpRed'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <StatCard key={card.title} card={card} index={index} />
      ))}
    </div>
  );
}

function StatCard({ card, index }) {
  const getTrendColor = (trend) => {
    if (trend === undefined || trend === null) return 'text-bpGray';
    if (trend > 0) return 'text-emerald-400';
    if (trend < 0) return 'text-red-400';
    return 'text-bpGray';
  };

  const getTrendIcon = (trend) => {
    if (trend === undefined || trend === null) return (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
      </svg>
    );
    if (trend > 0) return (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
      </svg>
    );
    if (trend < 0) return (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
      </svg>
    );
    return (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
      </svg>
    );
  };

  // Determine which trend value to use
  const trendValue = card.dollarDiff !== undefined ? card.dollarDiff : card.trend;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="bg-bpCream rounded-lg p-6 hover:shadow-lg transition-shadow border border-bpNavy/10"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-bpNavy/70 font-medium">{card.title}</div>
        <div className={`${card.bgColor} ${card.iconColor} p-2 rounded-lg`}>
          {card.icon}
        </div>
      </div>

      <div className="text-3xl font-bold text-bpInk mb-1">
        {card.value}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-bpGray">{card.subtitle}</div>

        {trendValue !== undefined && (
          <div className={`text-xs font-semibold flex items-center gap-1 ${getTrendColor(trendValue)}`}>
            {getTrendIcon(trendValue)}
            {trendValue !== 0 && (
              <span>
                {card.dollarDiff !== undefined
                  ? formatDollar(Math.abs(trendValue))
                  : Math.abs(trendValue).toFixed(1)
                }
              </span>
            )}
          </div>
        )}
      </div>

      {card.progress !== undefined && (
        <div className="mt-3">
          <div className="w-full bg-bpNavy/10 rounded-full h-2">
            <div
              className={`${card.title === 'Roster' && card.progress >= 100 ? 'bg-emerald-500' : 'bg-bpRed'} h-2 rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(card.progress, 100)}%` }}
            />
          </div>
          <div className="text-xs text-bpGray mt-1 text-right">
            {card.progress.toFixed(0)}%
          </div>
        </div>
      )}
    </motion.div>
  );
}
