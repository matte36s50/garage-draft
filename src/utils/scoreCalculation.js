/**
 * Shared score calculation utilities
 * Used by both the Dashboard (real-time) and cron job (historical snapshots)
 *
 * SCORING SYSTEM (Updated):
 * - Winner is determined by highest total dollar value at auction close
 * - final_score = sum of all 7 cars' final values
 * - Car sells: final_value = sale_price (final_price)
 * - Reserve not met: final_value = high_bid * 0.25 (75% penalty)
 * - Withdrawn (final_price = 0): final_value = 0
 * - Users must draft exactly 7 cars for a complete roster
 */

const MAX_GARAGE_CARS = 7;

/**
 * Determine the status and final value of a car based on auction state
 * @param {Object} auction - Auction data
 * @param {number} purchasePrice - Price paid when drafted
 * @returns {Object} { status, finalValue, currentBid }
 */
function getCarFinalValue(auction, purchasePrice) {
  const now = Math.floor(Date.now() / 1000);
  const auctionEnded = auction.timestamp_end < now;
  const currentBid = parseFloat(auction.current_bid || purchasePrice);
  const finalPrice = auction.final_price !== null ? parseFloat(auction.final_price) : null;

  // Withdrawn: final_price is explicitly set to 0
  if (finalPrice === 0) {
    return {
      status: 'withdrawn',
      finalValue: 0,
      currentBid
    };
  }

  // Sold: final_price is set and > 0
  if (finalPrice !== null && finalPrice > 0) {
    return {
      status: 'sold',
      finalValue: finalPrice,
      currentBid
    };
  }

  // Reserve not met: auction ended but no final_price
  if (auctionEnded && finalPrice === null) {
    return {
      status: 'reserve_not_met',
      finalValue: currentBid * 0.25,
      currentBid
    };
  }

  // Pending: auction still active
  return {
    status: 'pending',
    finalValue: currentBid, // Use current bid for display purposes
    currentBid
  };
}

/**
 * Calculate total score for a user in a league
 * Score is now based on total dollar value of cars at auction close
 * @param {Object} supabase - Supabase client
 * @param {string} userId - User ID
 * @param {string} leagueId - League ID
 * @returns {Object} Score data including totalScore (total dollar value), carsCount, etc.
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
        totalScore: 0,           // NEW: Primary score - total dollar value
        totalFinalValue: 0,      // NEW: Sum of all cars' final values
        totalPercentGain: 0,     // KEPT: For backward compatibility
        totalDollarGain: 0,      // KEPT: Dollar gain (profit/loss)
        bonusScore: null,
        carsCount: 0,
        totalSpent: 0,
        avgPercentPerCar: 0,
        carsData: [],
        bestCar: null,
        worstCar: null,
        isRosterComplete: false, // NEW: True when 7 cars drafted
        pendingCount: 0          // NEW: Cars still at auction
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

    let totalFinalValue = 0;
    let totalPercentGain = 0;
    let totalDollarGain = 0;
    let carsCount = 0;
    let totalSpent = 0;
    let pendingCount = 0;
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
        const { status, finalValue, currentBid } = getCarFinalValue(auction, purchasePrice);

        if (status === 'pending') {
          pendingCount++;
        }

        // Calculate percentage gain for display/backward compatibility
        const percentGain = purchasePrice > 0 ? ((finalValue - purchasePrice) / purchasePrice) * 100 : 0;
        const dollarGain = finalValue - purchasePrice;

        console.log(`[Score Calc] Car ${index} (${auction.title}):`, {
          purchasePrice,
          currentBid,
          finalValue,
          status,
          percentGain: percentGain.toFixed(2) + '%',
          dollarGain
        });

        totalFinalValue += finalValue;
        totalPercentGain += percentGain;
        totalDollarGain += dollarGain;
        totalSpent += purchasePrice;
        carsCount++;

        // Store individual car data
        carsData.push({
          auctionId: auction.auction_id,
          title: auction.title,
          imageUrl: auction.image_url,
          purchasePrice,
          finalValue,
          currentBid,
          status,
          percentGain: parseFloat(percentGain.toFixed(2)),
          dollarGain: parseFloat(dollarGain.toFixed(2)),
          // Legacy field for compatibility
          reserveNotMet: status === 'reserve_not_met',
          currentPrice: finalValue // Legacy field
        });
      });
    }

    // Get bonus car score (still adds to percentage for bonus prediction accuracy)
    const bonusScore = await calculateBonusCarScore(supabase, userId, leagueId);
    if (bonusScore) {
      console.log(`[Score Calc] Bonus car score: +${bonusScore.bonusPoints} points`);
      totalPercentGain += bonusScore.bonusPoints;
    }

    // Calculate average per car (including bonus car if exists)
    const totalCars = carsCount + (bonusScore ? 1 : 0);
    const avgPercentPerCar = totalCars > 0 ? totalPercentGain / totalCars : 0;

    // Roster is complete when user has exactly 7 cars
    const isRosterComplete = carsCount >= MAX_GARAGE_CARS;

    // Sort cars by final value to find best performer
    carsData.sort((a, b) => b.finalValue - a.finalValue);

    console.log(`[Score Calc] Final results:`, {
      totalScore: totalFinalValue.toFixed(2),
      totalFinalValue: totalFinalValue.toFixed(2),
      totalPercentGain: totalPercentGain.toFixed(2) + '%',
      carsCount,
      isRosterComplete,
      pendingCount
    });

    return {
      totalScore: parseFloat(totalFinalValue.toFixed(2)),         // NEW: Primary score
      totalFinalValue: parseFloat(totalFinalValue.toFixed(2)),    // NEW: Same as totalScore
      totalPercentGain: parseFloat(totalPercentGain.toFixed(2)),  // KEPT: Backward compat
      totalDollarGain: parseFloat(totalDollarGain.toFixed(2)),    // KEPT: Profit/loss
      bonusScore,
      carsCount,
      totalSpent: parseFloat(totalSpent.toFixed(2)),
      avgPercentPerCar: parseFloat(avgPercentPerCar.toFixed(2)),
      carsData,
      bestCar: carsData.length > 0 ? carsData[0] : null,
      worstCar: carsData.length > 0 ? carsData[carsData.length - 1] : null,
      isRosterComplete,                                            // NEW: 7 cars = complete
      pendingCount                                                 // NEW: Cars still active
    };

  } catch (error) {
    console.error(`Error calculating score for user ${userId}:`, error);
    return {
      totalScore: 0,
      totalFinalValue: 0,
      totalPercentGain: 0,
      totalDollarGain: 0,
      bonusScore: null,
      carsCount: 0,
      totalSpent: 0,
      avgPercentPerCar: 0,
      carsData: [],
      bestCar: null,
      worstCar: null,
      isRosterComplete: false,
      pendingCount: 0
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
    // First, get the league info to determine auction selection method
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('use_manual_auctions, draft_starts_at')
      .eq('id', leagueId)
      .single();

    if (leagueError) throw leagueError;

    let auctions = [];

    // Try to get auctions from league_auctions table first
    const { data: leagueAuctions, error: leagueAuctionsError } = await supabase
      .from('league_auctions')
      .select('auction_id, auctions(auction_id, current_bid, final_price, price_at_48h, timestamp_end, title)')
      .eq('league_id', leagueId);

    if (leagueAuctionsError) throw leagueAuctionsError;

    if (leagueAuctions && leagueAuctions.length > 0) {
      // Use auctions from league_auctions table
      auctions = leagueAuctions.map(la => la.auctions).filter(Boolean);
      console.log(`[Market Avg] Found ${auctions.length} auctions in league_auctions table`);
    } else if (!league?.use_manual_auctions) {
      // Fallback for auto leagues: use 4-5 day window from league start
      console.log(`[Market Avg] No league_auctions found, using 4-5 day window fallback`);

      const leagueStartTime = league?.draft_starts_at
        ? Math.floor(new Date(league.draft_starts_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      const fourDaysInSeconds = 4 * 24 * 60 * 60;
      const fiveDaysInSeconds = 5 * 24 * 60 * 60;
      const minEndTime = leagueStartTime + fourDaysInSeconds;
      const maxEndTime = leagueStartTime + fiveDaysInSeconds;

      const { data: windowAuctions, error: windowError } = await supabase
        .from('auctions')
        .select('auction_id, current_bid, final_price, price_at_48h, timestamp_end, title')
        .gte('timestamp_end', minEndTime)
        .lte('timestamp_end', maxEndTime)
        .not('price_at_48h', 'is', null);

      if (windowError) throw windowError;

      auctions = windowAuctions || [];
      console.log(`[Market Avg] Found ${auctions.length} auctions in 4-5 day window`);
    }

    if (!auctions || auctions.length === 0) {
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

    auctions.forEach((auction) => {
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
 * Now uses total dollar value as the primary score
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
        totalScore: score.totalScore,              // NEW: Total dollar value (primary)
        totalFinalValue: score.totalFinalValue,    // NEW: Same as totalScore
        totalPercentGain: score.totalPercentGain,  // KEPT: For backward compat
        totalDollarGain: score.totalDollarGain,    // KEPT: Profit/loss
        carsCount: score.carsCount,
        totalSpent: score.totalSpent,
        avgPercentPerCar: score.avgPercentPerCar,
        isRosterComplete: score.isRosterComplete,  // NEW: 7 cars drafted
        pendingCount: score.pendingCount           // NEW: Cars still active
      };
    });

    const scores = await Promise.all(scoresPromises);

    // Sort by total score (total dollar value)
    // Complete rosters rank above incomplete rosters
    scores.sort((a, b) => {
      // First, sort by roster completion
      if (a.isRosterComplete && !b.isRosterComplete) return -1;
      if (!a.isRosterComplete && b.isRosterComplete) return 1;
      // Then by total score (total dollar value)
      return b.totalScore - a.totalScore;
    });

    // Calculate league average (total dollar value)
    const totalScoreSum = scores.reduce((sum, s) => sum + s.totalScore, 0);
    const leagueAvg = scores.length > 0 ? totalScoreSum / scores.length : 0;

    // Get leader (must have complete roster to be leader)
    const completeRosters = scores.filter(s => s.isRosterComplete);
    const leader = completeRosters.length > 0 ? completeRosters[0] : (scores.length > 0 ? scores[0] : null);

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
