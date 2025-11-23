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
        // Calculate current rankings using the stored function
        await supabase.rpc('calculate_league_ranks', { p_league_id: league.id });

        // Get all members with current scores
        const { data: members, error: membersError } = await supabase
          .from('league_members')
          .select('user_id, total_score, rank')
          .eq('league_id', league.id);

        if (membersError) throw membersError;

        // Get garage info for each member and create snapshots
        const snapshots = await Promise.all(
          (members || []).map(async (member) => {
            const { data: garageCars } = await supabase
              .from('garage_cars')
              .select('purchase_price, auctions(current_bid, final_price)')
              .eq('league_id', league.id)
              .eq('user_id', member.user_id);

            const totalSpent = garageCars?.reduce((sum, car) =>
              sum + (car.purchase_price || 0), 0
            ) || 0;

            return {
              league_id: league.id,
              user_id: member.user_id,
              timestamp: new Date().toISOString(),
              cumulative_gain: member.total_score || 0,
              rank: member.rank || 0,
              total_spent: totalSpent,
              car_count: garageCars?.length || 0,
              snapshot: {
                cars: garageCars?.map(car => ({
                  purchase_price: car.purchase_price,
                  current_price: car.auctions?.current_bid || car.auctions?.final_price
                }))
              }
            };
          })
        );

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
