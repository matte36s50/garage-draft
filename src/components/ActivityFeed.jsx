import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';

export default function ActivityFeed({ supabase, leagueId, limit = 15 }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('league_activities')
        .select('*')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      setActivities(data || []);
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase, leagueId, limit]);

  useEffect(() => {
    if (leagueId) {
      fetchActivities();

      // Set up real-time subscription
      const channel = supabase
        .channel(`activities-${leagueId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'league_activities',
            filter: `league_id=eq.${leagueId}`
          },
          (payload) => {
            setActivities(prev => [payload.new, ...prev].slice(0, limit));
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [leagueId, limit, supabase, fetchActivities]);

  if (loading) {
    return (
      <div className="bg-bpCream rounded-lg p-6 border border-bpNavy/10">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex gap-3">
              <div className="w-8 h-8 bg-bpNavy/10 rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-bpNavy/10 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-bpNavy/10 rounded w-1/4"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bpCream rounded-lg p-6 border border-bpNavy/10">
      <h3 className="text-lg font-bold mb-4 text-bpRed">Live Activity</h3>

      {activities.length === 0 ? (
        <div className="text-center py-8 text-bpGray">
          <p>No activity yet. Be the first!</p>
        </div>
      ) : (
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityItem({ activity }) {
  const getActivityIcon = (type) => {
    switch (type) {
      case 'big_gain':
        return (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bpRed/20 text-bpRed">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
            </svg>
          </span>
        );
      case 'car_added':
        return (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bpNavy/10 text-bpNavy">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </span>
        );
      case 'price_jump':
        return (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </span>
        );
      case 'car_sold':
        return (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bpGold/20 text-bpGold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        );
      case 'rank_change':
        return (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bpGold/20 text-bpGold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bpNavy/5 text-bpGray">
            <span className="text-lg">&#8226;</span>
          </span>
        );
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 hover:bg-bpNavy/5 rounded-lg transition-colors">
      <div className="flex-shrink-0">
        {getActivityIcon(activity.activity_type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-bpInk">
          <span className="font-semibold">{activity.username}</span>
          {' '}{activity.message}
        </p>
        <p className="text-xs text-bpGray mt-1">
          {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}
