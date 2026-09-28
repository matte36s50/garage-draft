import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { decideBonus } from '@/lib/bonusCar';
import { carValue } from '@/lib/carValue';
import { eventCompletion } from '@/lib/eventCompletion';

/**
 * PERFORMANCE TRACKING API ENDPOINT
 *
 * ⚠️ IMPORTANT: This endpoint is OPTIONAL for dashboard functionality!
 *
 * The dashboard works perfectly fine WITHOUT this endpoint running periodically:
 * ✅ Leaderboard shows real-time scores
 * ✅ All metrics display current data
 * ✅ Performance chart shows current snapshot
 *
 * This endpoint provides ENHANCED features when run periodically:
 * 📊 Performance chart with time-series data (trends over time)
 * 📈 Rank change indicators (up/down arrows on leaderboard)
 * 💾 Historical score backups in database
 *
 * HOW TO USE (since Vercel Cron isn't available):
 *
 * Option 1: Manual Trigger
 * - Call this endpoint manually whenever you want to capture a snapshot
 * - URL: https://your-domain.vercel.app/api/cron/update-performance
 * - Add ?secret=YOUR_CRON_SECRET if you set CRON_SECRET env variable
 *
 * Option 2: External Cron Service (Recommended for automation)
 * - Use a free service like cron-job.org, EasyCron, or GitHub Actions
 * - Schedule: Every hour (0 * * * *) or as desired
 * - URL: https://your-domain.vercel.app/api/cron/update-performance?secret=YOUR_SECRET
 * - Set CRON_SECRET in Vercel environment variables for security
 *
 * Option 3: Accept Limitations
 * - Simply don't run this endpoint
 * - Dashboard will work fine, just without historical trends
 *
 * History does depend on it, though: it stores the scores History records and
 * closes finished events once their results are in (see lib/eventCompletion.js).
 */

// Helper to create supabase client with service role key for cron job
function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET(request) {
  const supabase = getSupabaseClient();

  // Verify cron secret for security (optional but recommended)
  // Support both Authorization header and query parameter for external cron services
  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const secretParam = searchParams.get('secret');

  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const isValidHeader = authHeader === `Bearer ${cronSecret}`;
    const isValidParam = secretParam === cronSecret;

    if (!isValidHeader && !isValidParam) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // Get all leagues (regardless of status - we want to track performance for all)
    const { data: leagues, error: leaguesError } = await supabase
      .from('leagues')
      .select('id, name, use_manual_auctions, draft_starts_at, draft_ends_at, completed_at, bonus_auction_id, spending_limit');

    if (leaguesError) throw leaguesError;

    let totalUpdated = 0;
    const results = [];
    const completions = [];

    for (const league of leagues || []) {
      try {
        // Calculate market average for this league (average % increase across all auctions)
        let marketAverage = 0;
        let auctions = [];

        // Try to get auctions from league_auctions table first
        const { data: leagueAuctions } = await supabase
          .from('league_auctions')
          .select('auction_id, auctions(auction_id, current_bid, final_price, reserve_not_met, price_at_48h, timestamp_end)')
          .eq('league_id', league.id);

        if (leagueAuctions && leagueAuctions.length > 0) {
          auctions = leagueAuctions.map(la => la.auctions).filter(Boolean);
        } else if (!league.use_manual_auctions) {
          // Fallback for auto leagues: use 4-5 day window from league start
          const leagueStartTime = league.draft_starts_at
            ? Math.floor(new Date(league.draft_starts_at).getTime() / 1000)
            : Math.floor(Date.now() / 1000);

          const fourDaysInSeconds = 4 * 24 * 60 * 60;
          const fiveDaysInSeconds = 5 * 24 * 60 * 60;
          const minEndTime = leagueStartTime + fourDaysInSeconds;
          const maxEndTime = leagueStartTime + fiveDaysInSeconds;

          const { data: windowAuctions } = await supabase
            .from('auctions')
            .select('auction_id, current_bid, final_price, reserve_not_met, price_at_48h, timestamp_end')
            .gte('timestamp_end', minEndTime)
            .lte('timestamp_end', maxEndTime)
            .not('price_at_48h', 'is', null);

          auctions = windowAuctions || [];
        }

        if (auctions.length > 0) {
          const now = Math.floor(Date.now() / 1000);
          let totalPercentGain = 0;
          let validCount = 0;

          auctions.forEach(auction => {
            if (!auction) return;

            const baselinePrice = parseFloat(auction.price_at_48h);
            if (!baselinePrice || baselinePrice <= 0) return;

            const { value: effectivePrice } = carValue({
              finalPrice: auction.final_price,
              reserveNotMet: auction.reserve_not_met,
              ended: auction.timestamp_end <= now,
              currentBid: auction.current_bid,
              purchasePrice: baselinePrice,
            });

            const percentGain = ((effectivePrice - baselinePrice) / baselinePrice) * 100;
            totalPercentGain += percentGain;
            validCount++;
          });

          marketAverage = validCount > 0 ? parseFloat((totalPercentGain / validCount).toFixed(2)) : 0;
        }

        console.log(`[Cron] League ${league.name}: Market average = ${marketAverage}%`);

        // Get all members
        const { data: members, error: membersError } = await supabase
          .from('league_members')
          .select('user_id')
          .eq('league_id', league.id);

        if (membersError) throw membersError;

        // Bonus car: decided once per league (see lib/bonusCar.js)
        let bonus = null;
        let bonusAuction = null;
        let bonusLoadFailed = false;
        if (league.bonus_auction_id) {
          const [{ data: bonusLot, error: bonusLotError }, { data: predictions, error: predictionsError }] = await Promise.all([
            supabase
              .from('auctions')
              .select('current_bid, final_price, reserve_not_met, timestamp_end')
              .eq('auction_id', league.bonus_auction_id)
              .maybeSingle(),
            supabase
              .from('bonus_predictions')
              .select('user_id, predicted_price')
              .eq('league_id', league.id),
          ]);
          bonusAuction = bonusLot;
          bonusLoadFailed = !!(bonusLotError || predictionsError);
          // Only members' calls count
          const memberIds = new Set((members || []).map(m => m.user_id));
          const memberCalls = (predictions || []).filter(p => memberIds.has(p.user_id));
          bonus = decideBonus({ auction: bonusAuction, predictions: memberCalls, budget: league.spending_limit });
        }

        // Calculate scores for each member and update league_members
        // NEW SCORING: Total dollar value instead of percentage gain
        const scoreUpdates = await Promise.all(
          (members || []).map(async (member) => {
            // First, get the user's garage for this league
            const { data: garage, error: garageError } = await supabase
              .from('garages')
              .select('id')
              .eq('user_id', member.user_id)
              .eq('league_id', league.id)
              .maybeSingle();

            let garageCars = [];
            let carsError = null;
            if (garage) {
              // Get garage cars with auction data
              const { data: cars, error } = await supabase
                .from('garage_cars')
                .select(`
                  purchase_price,
                  auctions!garage_cars_auction_id_fkey (
                    auction_id,
                    current_bid,
                    final_price,
                    reserve_not_met,
                    timestamp_end
                  )
                `)
                .eq('garage_id', garage.id);

              garageCars = cars || [];
              carsError = error;
            }

            let totalFinalValue = 0;
            let totalSpent = 0;

            if (garageCars && garageCars.length > 0) {
              garageCars.forEach(car => {
                const auction = car.auctions;
                if (!auction) return;

                const purchasePrice = parseFloat(car.purchase_price);
                const now = Math.floor(Date.now() / 1000);

                // Same rule as the player app (lib/carValue.js)
                const { value: finalValue } = carValue({
                  finalPrice: auction.final_price,
                  reserveNotMet: auction.reserve_not_met,
                  ended: auction.timestamp_end <= now,
                  currentBid: auction.current_bid,
                  purchasePrice,
                });

                totalFinalValue += finalValue;
                totalSpent += purchasePrice;
              });
            }

            // Bonus car prize, once the bonus auction has a confirmed result
            const isWinner = !!bonus && bonus.winners.includes(member.user_id);
            const bonusValue = isWinner ? bonus.share : 0;
            if (isWinner) {
              totalFinalValue += bonusValue;
              console.log(`[Cron] BONUS CAR WINNER: ${member.user_id} gets $${bonusValue} (call closest to $${bonus.price})`);
            }

            // Score is total dollar value (including the bonus prize for the winner)
            const finalScore = parseFloat(totalFinalValue.toFixed(2));

            return {
              user_id: member.user_id,
              total_score: finalScore,
              total_spent: totalSpent,
              car_count: garageCars?.length || 0,
              garage_cars: garageCars,
              bonus_value: bonusValue,
              is_bonus_winner: isWinner,
              load_failed: !!(garageError || carsError)
            };
          })
        );

        // Update total_score for all members
        const scoreWrites = await Promise.all(
          scoreUpdates.map(async (update) => {
            return supabase
              .from('league_members')
              .update({ total_score: update.total_score })
              .eq('league_id', league.id)
              .eq('user_id', update.user_id);
          })
        );

        // Now calculate current rankings using the stored function
        await supabase.rpc('calculate_league_ranks', { p_league_id: league.id });

        // Get updated member data with new ranks
        const { data: updatedMembers } = await supabase
          .from('league_members')
          .select('user_id, total_score, rank')
          .eq('league_id', league.id);

        // Create performance snapshots with correct data
        const snapshots = scoreUpdates.map((update) => {
          const memberData = updatedMembers?.find(m => m.user_id === update.user_id);

          return {
            league_id: league.id,
            user_id: update.user_id,
            timestamp: new Date().toISOString(),
            cumulative_gain: update.total_score,
            rank: memberData?.rank || 0,
            total_spent: update.total_spent,
            car_count: update.car_count,
            snapshot: {
              marketAverage, // Store market average for historical tracking
              cars: update.garage_cars?.map(car => ({
                purchase_price: car.purchase_price,
                current_price: car.auctions?.current_bid || car.auctions?.final_price
              }))
            }
          };
        });

        // Insert performance snapshots
        if (snapshots.length > 0) {
          const { error: insertError } = await supabase
            .from('performance_history')
            .insert(snapshots);

          if (insertError) {
            console.error(`Error inserting snapshots for league ${league.name}:`, insertError);
            results.push({ league: league.name, status: 'error', error: insertError.message });
          } else {
            totalUpdated += snapshots.length;
            results.push({ league: league.name, status: 'success', snapshots: snapshots.length });
          }
        }

        // Close the event and write it to History once its results are in. This
        // is judged on the same rows just scored, so the score History records
        // includes every result that let the event close. If a read or score
        // write failed this run, it waits for the next run instead.
        if (!league.completed_at) {
          const cars = scoreUpdates.flatMap(u => (u.garage_cars || []).map(c => c.auctions).filter(Boolean));
          const verdict = eventCompletion({ draftEndsAt: league.draft_ends_at, cars, bonusAuction });
          const loadFailed = bonusLoadFailed || scoreUpdates.some(u => u.load_failed) || scoreWrites.some(w => w.error);
          if (verdict.ready && loadFailed) {
            completions.push({ league: league.name, status: 'deferred', reason: 'load_error' });
          } else if (verdict.ready) {
            const { data: completed, error: completeError } = await supabase
              .rpc('complete_league', { p_league_id: league.id });
            const ok = !completeError && completed?.success;
            completions.push({
              league: league.name,
              status: ok ? 'completed' : 'failed',
              reason: verdict.reason,
              missing_results: verdict.missing,
              error: ok ? undefined : completeError?.message || completed?.error,
            });
            if (ok) console.log(`[Cron] Completed league ${league.name} (${verdict.reason})`);
          } else if (verdict.reason === 'awaiting_results') {
            completions.push({ league: league.name, status: 'awaiting_results', missing_results: verdict.missing });
          }
        }
      } catch (leagueError) {
        console.error(`Error processing league ${league.name}:`, leagueError);
        results.push({ league: league.name, status: 'error', error: leagueError.message });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      leagues: leagues?.length || 0,
      totalSnapshots: totalUpdated,
      results,
      leagueCompletion: {
        leagues_completed: completions.filter(c => c.status === 'completed').length,
        results: completions,
      }
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Also support POST for manual triggers
export async function POST(request) {
  return GET(request);
}
