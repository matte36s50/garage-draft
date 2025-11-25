import { motion } from 'framer-motion';

export default function StatsCards({ stats }) {
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
      title: 'Total Gain',
      value: stats?.totalGain !== undefined ? `${stats.totalGain >= 0 ? '+' : ''}${stats.totalGain.toFixed(2)}%` : '0.00%',
      subtitle: `League Avg: ${stats?.leagueAvg?.toFixed(2) || '0.00'}%`,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
      trend: stats?.totalGain !== undefined && stats?.leagueAvg !== undefined
        ? stats.totalGain - stats.leagueAvg
        : undefined,
      trendLabel: 'vs Average',
      bgColor: 'bg-emerald-500/20',
      iconColor: 'text-emerald-400'
    },
    {
      title: 'Behind Leader',
      value: stats?.behindLeader !== undefined ? `${stats.behindLeader.toFixed(2)}%` : '0.00%',
      subtitle: 'Gap to close',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
      bgColor: 'bg-bpGold/20',
      iconColor: 'text-bpGold'
    },
    {
      title: 'Budget Used',
      value: stats?.budgetUsed !== undefined ? `$${(stats.budgetUsed / 1000).toFixed(0)}K` : '$0K',
      subtitle: 'of $200K',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      progress: stats?.budgetUsed !== undefined ? (stats.budgetUsed / 200000) * 100 : 0,
      bgColor: 'bg-bpRed/20',
      iconColor: 'text-bpRed'
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

        {card.trend !== undefined && (
          <div className={`text-xs font-semibold flex items-center gap-1 ${getTrendColor(card.trend)}`}>
            {getTrendIcon(card.trend)}
            {card.trend !== 0 && (
              <span>
                {Math.abs(card.trend).toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      {card.progress !== undefined && (
        <div className="mt-3">
          <div className="w-full bg-bpNavy/10 rounded-full h-2">
            <div
              className="bg-bpRed h-2 rounded-full transition-all duration-500"
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
