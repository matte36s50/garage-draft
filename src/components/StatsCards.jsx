import { motion } from 'framer-motion';

// Format dollar amount with commas
const formatDollar = (amount) => {
  if (amount === undefined || amount === null) return '$0';
  return '$' + Math.round(amount).toLocaleString();
};

export default function StatsCards({ stats, spendingLimit = 200000 }) {
  const earningsValue = stats?.totalDollarGain || 0;
  const isPositive = earningsValue >= 0;

  const cards = [
    // FEATURED: Auction Earnings - Most prominent card
    {
      title: 'Auction Earnings',
      value: formatDollar(earningsValue),
      subtitle: 'Your profit from auction results',
      description: 'Earnings = Final Values - Purchase Prices',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      bgColor: isPositive ? 'bg-gradient-to-br from-emerald-500/30 to-emerald-600/20' : 'bg-gradient-to-br from-red-500/30 to-red-600/20',
      iconColor: isPositive ? 'text-emerald-400' : 'text-red-400',
      featured: true,
      isPositive
    },
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
        <div key={card.title} className={card.featured ? 'md:col-span-2' : ''}>
          <StatCard card={card} index={index} />
        </div>
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

  // Featured card (Auction Earnings) gets special treatment
  if (card.featured) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1, duration: 0.5 }}
        className={`
          ${card.bgColor}
          rounded-xl p-8
          border-2 ${card.isPositive ? 'border-emerald-400/40' : 'border-red-400/40'}
          hover:shadow-2xl hover:scale-[1.02]
          transition-all duration-300
          relative overflow-hidden
        `}
      >
        {/* Decorative gradient overlay */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-white/5 to-transparent rounded-full blur-3xl" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <div className={`${card.iconColor} p-3 rounded-xl bg-bpNavy/30`}>
                  {card.icon}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-bpCream">{card.title}</h3>
                  <p className="text-sm text-bpCream/60">{card.subtitle}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-3">
            <div className={`text-6xl font-extrabold ${card.isPositive ? 'text-emerald-300' : 'text-red-300'} tracking-tight`}>
              {card.isPositive && '+'}{card.value}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-bpCream/70 italic">
              {card.description}
            </div>
            {card.isPositive ? (
              <div className="flex items-center gap-2 bg-emerald-500/20 px-4 py-2 rounded-full border border-emerald-400/30">
                <svg className="w-5 h-5 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <span className="text-sm font-bold text-emerald-300">Profit</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-red-500/20 px-4 py-2 rounded-full border border-red-400/30">
                <svg className="w-5 h-5 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                </svg>
                <span className="text-sm font-bold text-red-300">Loss</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Standard card styling
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
