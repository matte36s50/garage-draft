import { useState, useEffect, useCallback } from 'react';

export default function LeaguePredictions({ supabase, leagueId, currentUserId, bonusCar }) {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPredictions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch all predictions for this league with user info
      const { data, error: fetchError } = await supabase
        .from('bonus_predictions')
        .select(`
          predicted_price,
          user_id,
          users(username)
        `)
        .eq('league_id', leagueId)
        .order('predicted_price', { ascending: true });

      if (fetchError) {
        console.error('Error fetching predictions:', fetchError);
        setError('Failed to load predictions');
        return;
      }

      // Transform data to include username
      const transformedData = (data || []).map(p => ({
        userId: p.user_id,
        username: p.users?.username || 'Unknown Player',
        predictedPrice: parseFloat(p.predicted_price),
        isCurrentUser: p.user_id === currentUserId
      }));

      setPredictions(transformedData);
    } catch (err) {
      console.error('Error fetching predictions:', err);
      setError('Failed to load predictions');
    } finally {
      setLoading(false);
    }
  }, [supabase, leagueId, currentUserId]);

  useEffect(() => {
    if (leagueId) {
      fetchPredictions();
    }
  }, [leagueId, fetchPredictions]);

  if (loading) {
    return (
      <div className="bg-bpCream/5 border border-bpCream/20 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
          <h3 className="text-xl font-bold text-bpCream">League Predictions</h3>
        </div>
        <div className="text-center py-4">
          <svg className="animate-spin h-6 w-6 mx-auto text-bpGold" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-bpGray mt-2">Loading predictions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-bpCream/5 border border-bpCream/20 rounded-lg p-6">
        <div className="text-center py-4 text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (predictions.length === 0) {
    return (
      <div className="bg-bpCream/5 border border-bpCream/20 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
          <h3 className="text-xl font-bold text-bpCream">League Predictions</h3>
        </div>
        <p className="text-bpGray text-center py-4">No predictions submitted yet.</p>
      </div>
    );
  }

  // Calculate prediction stats
  const minPrediction = Math.min(...predictions.map(p => p.predictedPrice));
  const maxPrediction = Math.max(...predictions.map(p => p.predictedPrice));
  const avgPrediction = predictions.reduce((sum, p) => sum + p.predictedPrice, 0) / predictions.length;

  return (
    <div className="bg-bpCream/5 border border-bpCream/20 rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
        </svg>
        <h3 className="text-xl font-bold text-bpCream">League Bonus Car Predictions</h3>
      </div>

      {/* Bonus Car Info */}
      {bonusCar && (
        <div className="mb-4 p-3 bg-bpNavy rounded-lg border border-bpGold/30">
          <p className="text-sm text-bpGray mb-1">Bonus Car</p>
          <p className="text-bpCream font-semibold">{bonusCar.title}</p>
          {bonusCar.currentBid && (
            <p className="text-bpGold text-sm mt-1">
              Current Bid: ${bonusCar.currentBid.toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Prediction Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-bpNavy rounded-lg p-3 text-center">
          <p className="text-xs text-bpGray mb-1">Lowest</p>
          <p className="text-lg font-bold text-red-400">${minPrediction.toLocaleString()}</p>
        </div>
        <div className="bg-bpNavy rounded-lg p-3 text-center">
          <p className="text-xs text-bpGray mb-1">Average</p>
          <p className="text-lg font-bold text-bpCream">${Math.round(avgPrediction).toLocaleString()}</p>
        </div>
        <div className="bg-bpNavy rounded-lg p-3 text-center">
          <p className="text-xs text-bpGray mb-1">Highest</p>
          <p className="text-lg font-bold text-green-400">${maxPrediction.toLocaleString()}</p>
        </div>
      </div>

      {/* All Predictions List */}
      <div className="space-y-2">
        <p className="text-sm text-bpGray mb-2">All {predictions.length} Predictions (sorted low to high)</p>
        {predictions.map((prediction, index) => (
          <div
            key={prediction.userId}
            className={`flex items-center justify-between p-3 rounded-lg ${
              prediction.isCurrentUser
                ? 'bg-bpGold/20 border border-bpGold'
                : 'bg-bpNavy border border-bpCream/10'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm text-bpGray w-6">{index + 1}.</span>
              <span className={`font-medium ${prediction.isCurrentUser ? 'text-bpGold' : 'text-bpCream'}`}>
                {prediction.username}
                {prediction.isCurrentUser && (
                  <span className="ml-2 text-xs text-bpGold">(You)</span>
                )}
              </span>
            </div>
            <span className={`font-bold ${prediction.isCurrentUser ? 'text-bpGold' : 'text-bpCream'}`}>
              ${prediction.predictedPrice.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Footer Note */}
      <p className="text-xs text-bpGray mt-4 text-center">
        Closest prediction to final sale price wins 2x bonus points!
      </p>
    </div>
  );
}
