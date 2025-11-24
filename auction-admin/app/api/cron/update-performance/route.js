import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Create supabase client with service role key for cron job
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(request) {
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
    // Get all active leagues
    const { data: leagues, error: leaguesError } = await supabase
      .from('leagues')
      .select('id, name')
      .eq('status', 'active');

    if (leaguesError) throw leaguesError;

    let totalUpdated = 0;
    const results = [];

    for (const league of leagues || []) {
      try {
        // Get all members
        const { data: members, error: membersError } = await supabase
          .from('league_members')
          .select('user_id')
          .eq('league_id', league.id);

        if (membersError) throw membersError;

        // Calculate scores for each member and update league_members
        const scoreUpdates = await Promise.all(
          (members || []).map(async (member) => {
            // Get garage cars with auction data
            const { data: garageCars } = await supabase
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
              .eq('league_id', league.id)
              .eq('user_id', member.user_id);

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
