/**
 * Shared score calculation utilities
 * Used by both the Dashboard (real-time) and cron job (historical snapshots)
 */

/**
 * Calculate total score for a user in a league
 * @param {Object} supabase - Supabase client
 * @param {string} userId - User ID
 * @param {string} leagueId - League ID
 * @returns {Object} Score data including totalPercentGain, totalDollarGain, carsCount, etc.
 */
export async function calculateUserScore(supabase, userId, leagueId) {
  try {
    // First, get the user's garage for this league
    const { data: garage, error: garageError } = await supabase
      .from('garages')
      .select('id')
      .eq('user_id', userId)
      .eq('league_id', leagueId)
      .maybeSingle();

    if (garageError) throw garageError;
    if (!garage) {
      console.log(`[Score Calc] No garage found for user ${userId} in league ${leagueId}`);
      return {
        totalPercentGain: 0,
        totalDollarGain: 0,
        bonusScore: null,
        carsCount: 0,
        totalSpent: 0,
        avgPercentPerCar: 0,
        carsData: [],
        bestCar: null,
        worstCar: null
      };
    }

    // Get garage cars with auction data
    const { data: garageCars, error: carsError } = await supabase
      .from('garage_cars')
      .select(`
        purchase_price,
        auction_id,
        auctions!garage_cars_auction_id_fkey (
          auction_id,
          current_bid,
          final_price,
          timestamp_end,
          title,
          image_url
        )
      `)
      .eq('garage_id', garage.id);

    if (carsError) throw carsError;

    let totalPercentGain = 0;
    let totalDollarGain = 0;
    let carsCount = 0;
    let totalSpent = 0;
    const carsData = [];

    console.log(`[Score Calc] Found ${garageCars?.length || 0} garage cars for user ${userId} in league ${leagueId}`);

    if (garageCars && garageCars.length > 0) {
      garageCars.forEach((car, index) => {
        const auction = car.auctions;
        if (!auction) {
          console.log(`[Score Calc] Car ${index}: No auction data found`);
          return;
        }

        const purchasePrice = parseFloat(car.purchase_price);
        const currentPrice = auction.final_price
          ? parseFloat(auction.final_price)
          : parseFloat(auction.current_bid || purchasePrice);

        const now = Math.floor(Date.now() / 1000);
        const auctionEnded = auction.timestamp_end < now;
        const reserveNotMet = auctionEnded && !auction.final_price;

        let effectivePrice = currentPrice;

        if (reserveNotMet) {
          effectivePrice = currentPrice * 0.25;
          console.log(`[Score Calc] Car ${index}: Reserve not met, applying 25% penalty`);
        }

        const percentGain = ((effectivePrice - purchasePrice) / purchasePrice) * 100;
        const dollarGain = effectivePrice - purchasePrice;

        console.log(`[Score Calc] Car ${index} (${auction.title}):`, {
          purchasePrice,
          currentPrice,
          effectivePrice,
          percentGain: percentGain.toFixed(2) + '%',
          dollarGain,
          reserveNotMet
        });

        totalPercentGain += percentGain;
        totalDollarGain += dollarGain;
        totalSpent += purchasePrice;
        carsCount++;

        // Store individual car data for "best performing car" feature
        carsData.push({
          auctionId: auction.auction_id,
          title: auction.title,
          imageUrl: auction.image_url,
          purchasePrice,
          currentPrice: effectivePrice,
          percentGain: parseFloat(percentGain.toFixed(2)),
          dollarGain: parseFloat(dollarGain.toFixed(2)),
          reserveNotMet
        });
      });
    }

    // Get bonus car score
    const bonusScore = await calculateBonusCarScore(supabase, userId, leagueId);
    if (bonusScore) {
      console.log(`[Score Calc] Bonus car score: +${bonusScore.bonusPoints} points`);
      totalPercentGain += bonusScore.bonusPoints;
    }

    // Calculate average per car (including bonus car if exists)
    const totalCars = carsCount + (bonusScore ? 1 : 0);
    const avgPercentPerCar = totalCars > 0 ? totalPercentGain / totalCars : 0;

    // Sort cars by percent gain to find best performer
    carsData.sort((a, b) => b.percentGain - a.percentGain);

    console.log(`[Score Calc] Final results:`, {
      totalPercentGain: totalPercentGain.toFixed(2) + '%',
      totalDollarGain: totalDollarGain.toFixed(2),
      carsCount,
      avgPercentPerCar: avgPercentPerCar.toFixed(2) + '%'
    });

    return {
      totalPercentGain: parseFloat(totalPercentGain.toFixed(2)),
      totalDollarGain: parseFloat(totalDollarGain.toFixed(2)),
      bonusScore,
      carsCount,
      totalSpent: parseFloat(totalSpent.toFixed(2)),
      avgPercentPerCar: parseFloat(avgPercentPerCar.toFixed(2)),
      carsData, // Array of individual car performance data
      bestCar: carsData.length > 0 ? carsData[0] : null,
      worstCar: carsData.length > 0 ? carsData[carsData.length - 1] : null
    };

  } catch (error) {
    console.error(`Error calculating score for user ${userId}:`, error);
    return {
      totalPercentGain: 0,
      totalDollarGain: 0,
      bonusScore: null,
      carsCount: 0,
      totalSpent: 0,
      avgPercentPerCar: 0,
      carsData: [],
      bestCar: null,
      worstCar: null
    };
  }
}

/**
 * Calculate bonus car prediction score
 * @param {Object} supabase - Supabase client
 * @param {string} userId - User ID
 * @param {string} leagueId - League ID
 * @returns {Object|null} Bonus score data or null
 */
export async function calculateBonusCarScore(supabase, userId, leagueId) {
  try {
    // Get league bonus auction ID
    const { data: league } = await supabase
      .from('leagues')
      .select('bonus_auction_id')
      .eq('id', leagueId)
      .single();

    if (!league?.bonus_auction_id) return null;

    // Get user's prediction
    const { data: prediction } = await supabase
      .from('bonus_predictions')
      .select('predicted_price')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!prediction) return null;

    // Get bonus auction data
    const { data: bonusAuction } = await supabase
      .from('auctions')
      .select('current_bid, final_price, price_at_48h, title, image_url')
      .eq('auction_id', league.bonus_auction_id)
      .single();

    if (!bonusAuction) return null;

    const predictedPrice = parseFloat(prediction.predicted_price);
    const finalPrice = bonusAuction.final_price
      ? parseFloat(bonusAuction.final_price)
      : parseFloat(bonusAuction.current_bid);

    // Calculate prediction accuracy
    const predictionError = Math.abs(predictedPrice - finalPrice);
    const percentError = (predictionError / finalPrice) * 100;

    // Award bonus points based on accuracy (matching cron job logic)
    let bonusPoints = 0;
    if (percentError <= 5) {
      bonusPoints = 25;
    } else if (percentError <= 10) {
      bonusPoints = 15;
    } else if (percentError <= 15) {
      bonusPoints = 10;
    } else if (percentError <= 20) {
      bonusPoints = 5;
    }

    // Calculate base percent gain for display
    const baseline = parseFloat(bonusAuction.price_at_48h || finalPrice);
    const basePercentGain = ((finalPrice - baseline) / baseline) * 100;

    return {
      predicted: predictedPrice,
      actual: finalPrice,
      error: predictionError,
      percentError: parseFloat(percentError.toFixed(2)),
      bonusPoints,
      basePercentGain: parseFloat(basePercentGain.toFixed(2)),
      title: bonusAuction.title,
      imageUrl: bonusAuction.image_url,
      hasPrediction: true
    };

  } catch (error) {
    console.error('Error calculating bonus car score:', error);
    return null;
  }
}

/**
 * Calculate the market average - the average % increase across ALL auctions in a league
 * This represents how the overall market is performing, independent of user picks
 * @param {Object} supabase - Supabase client
 * @param {string} leagueId - League ID
 * @returns {Object} Market average data
 */
export async function calculateMarketAverage(supabase, leagueId) {
  try {
    // Get all auctions assigned to this league
    const { data: leagueAuctions, error: leagueAuctionsError } = await supabase
      .from('league_auctions')
      .select('auction_id, auctions(auction_id, current_bid, final_price, price_at_48h, timestamp_end, title)')
      .eq('league_id', leagueId);

    if (leagueAuctionsError) throw leagueAuctionsError;

    if (!leagueAuctions || leagueAuctions.length === 0) {
      console.log(`[Market Avg] No auctions found for league ${leagueId}`);
      return {
        marketAverage: 0,
        auctionCount: 0,
        auctionsData: []
      };
    }

    const now = Math.floor(Date.now() / 1000);
    let totalPercentGain = 0;
    let validAuctionCount = 0;
    const auctionsData = [];

    leagueAuctions.forEach((la) => {
      const auction = la.auctions;
      if (!auction) return;

      // Use price_at_48h as the baseline (draft price)
      const baselinePrice = parseFloat(auction.price_at_48h);
      if (!baselinePrice || baselinePrice <= 0) {
        console.log(`[Market Avg] Skipping auction ${auction.auction_id}: no valid price_at_48h`);
        return;
      }

      // Get current/final price
      const currentPrice = auction.final_price
        ? parseFloat(auction.final_price)
        : parseFloat(auction.current_bid || baselinePrice);

      // Check if auction ended without meeting reserve
      const auctionEnded = auction.timestamp_end < now;
      const reserveNotMet = auctionEnded && !auction.final_price;

      let effectivePrice = currentPrice;
      if (reserveNotMet) {
        effectivePrice = currentPrice * 0.25; // 75% penalty for reserve not met
      }

      // Calculate percent gain from baseline
      const percentGain = ((effectivePrice - baselinePrice) / baselinePrice) * 100;

      totalPercentGain += percentGain;
      validAuctionCount++;

      auctionsData.push({
        auctionId: auction.auction_id,
        title: auction.title,
        baselinePrice,
        currentPrice: effectivePrice,
        percentGain: parseFloat(percentGain.toFixed(2)),
        reserveNotMet
      });
    });

    const marketAverage = validAuctionCount > 0
      ? parseFloat((totalPercentGain / validAuctionCount).toFixed(2))
      : 0;

    console.log(`[Market Avg] League ${leagueId}:`, {
      auctionCount: validAuctionCount,
      marketAverage: marketAverage + '%'
    });

    return {
      marketAverage,
      auctionCount: validAuctionCount,
      auctionsData
    };

  } catch (error) {
    console.error(`Error calculating market average for league ${leagueId}:`, error);
    return {
      marketAverage: 0,
      auctionCount: 0,
      auctionsData: []
    };
  }
}

/**
 * Calculate league-wide statistics
 * @param {Object} supabase - Supabase client
 * @param {string} leagueId - League ID
 * @returns {Object} League stats including average, leader, etc.
 */
export async function calculateLeagueStats(supabase, leagueId) {
  try {
    // Get all league members
    const { data: members, error: membersError } = await supabase
      .from('league_members')
      .select('user_id, users(username)')
      .eq('league_id', leagueId);

    if (membersError) throw membersError;

    // Calculate scores for all members
    const scoresPromises = members.map(async (member) => {
      const score = await calculateUserScore(supabase, member.user_id, leagueId);
      return {
        userId: member.user_id,
        username: member.users?.username || 'Player',
        totalScore: score.totalPercentGain,
        totalDollarGain: score.totalDollarGain,
        carsCount: score.carsCount,
        totalSpent: score.totalSpent,
        avgPercentPerCar: score.avgPercentPerCar
      };
    });

    const scores = await Promise.all(scoresPromises);

    // Sort by total score
    scores.sort((a, b) => b.totalScore - a.totalScore);

    // Calculate league average
    const totalScore = scores.reduce((sum, s) => sum + s.totalScore, 0);
    const leagueAvg = scores.length > 0 ? totalScore / scores.length : 0;

    // Get leader
    const leader = scores.length > 0 ? scores[0] : null;

    return {
      scores,
      leagueAvg: parseFloat(leagueAvg.toFixed(2)),
      leader,
      totalMembers: scores.length
    };

  } catch (error) {
    console.error('Error calculating league stats:', error);
    return {
      scores: [],
      leagueAvg: 0,
      leader: null,
      totalMembers: 0
    };
  }
}
