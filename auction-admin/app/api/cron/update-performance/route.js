import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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
      .select('id, name, use_manual_auctions, draft_starts_at');

    if (leaguesError) throw leaguesError;

    let totalUpdated = 0;
    const results = [];

    for (const league of leagues || []) {
      try {
        // Calculate market average for this league (average % increase across all auctions)
        let marketAverage = 0;
        let auctions = [];

        // Try to get auctions from league_auctions table first
        const { data: leagueAuctions } = await supabase
          .from('league_auctions')
          .select('auction_id, auctions(auction_id, current_bid, final_price, price_at_48h, timestamp_end)')
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
            .select('auction_id, current_bid, final_price, price_at_48h, timestamp_end')
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

            const currentPrice = auction.final_price
              ? parseFloat(auction.final_price)
              : parseFloat(auction.current_bid || baselinePrice);

            const auctionEnded = auction.timestamp_end < now;
            const reserveNotMet = auctionEnded && !auction.final_price;
            let effectivePrice = currentPrice;
            if (reserveNotMet) {
              effectivePrice = currentPrice * 0.25;
            }

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

        // Calculate scores for each member and update league_members
        const scoreUpdates = await Promise.all(
          (members || []).map(async (member) => {
            // First, get the user's garage for this league
            const { data: garage } = await supabase
              .from('garages')
              .select('id')
              .eq('user_id', member.user_id)
              .eq('league_id', league.id)
              .maybeSingle();

            let garageCars = [];
            if (garage) {
              // Get garage cars with auction data
              const { data: cars } = await supabase
                .from('garage_cars')
                .select(`
                  purchase_price,
                  auctions!garage_cars_auction_id_fkey (
                    auction_id,
                    current_bid,
                    final_price,
                    timestamp_end
                  )
                `)
                .eq('garage_id', garage.id);

              garageCars = cars || [];
            }

            let totalPercentGain = 0;
            let totalSpent = 0;

            if (garageCars && garageCars.length > 0) {
              garageCars.forEach(car => {
                const auction = car.auctions;
                if (!auction) return;

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
                }

                const percentGain = ((effectivePrice - purchasePrice) / purchasePrice) * 100;
                totalPercentGain += percentGain;
                totalSpent += purchasePrice;
              });
            }

            // Get bonus car score if exists
            const { data: bonusPrediction } = await supabase
              .from('bonus_car_predictions')
              .select('predicted_price, bonus_cars(actual_sale_price)')
              .eq('user_id', member.user_id)
              .eq('league_id', league.id)
              .maybeSingle();

            if (bonusPrediction?.bonus_cars?.actual_sale_price && bonusPrediction.predicted_price) {
              const actualPrice = parseFloat(bonusPrediction.bonus_cars.actual_sale_price);
              const predictedPrice = parseFloat(bonusPrediction.predicted_price);
              const diff = Math.abs(actualPrice - predictedPrice);
              const percentOff = (diff / actualPrice) * 100;

              if (percentOff <= 5) {
                totalPercentGain += 25;
              } else if (percentOff <= 10) {
                totalPercentGain += 15;
              } else if (percentOff <= 15) {
                totalPercentGain += 10;
              } else if (percentOff <= 20) {
                totalPercentGain += 5;
              }
            }

            const finalScore = parseFloat(totalPercentGain.toFixed(2));

            return {
              user_id: member.user_id,
              total_score: finalScore,
              total_spent: totalSpent,
              car_count: garageCars?.length || 0,
              garage_cars: garageCars
            };
          })
        );

        // Update total_score for all members
        await Promise.all(
          scoreUpdates.map(async (update) => {
            await supabase
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
      results
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
