import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * RESERVE NOT MET NOTIFICATIONS API ENDPOINT
 *
 * This endpoint calls the notify_reserve_not_met_auctions() PostgreSQL function
 * which posts system messages to league chats when auctions end without meeting reserve.
 *
 * HOW TO USE:
 *
 * Option 1: Manual Trigger
 * - Call this endpoint manually whenever you want to check for reserve not met auctions
 * - URL: https://your-domain.vercel.app/api/cron/notify-reserve-not-met
 * - Add ?secret=YOUR_CRON_SECRET if you set CRON_SECRET env variable
 *
 * Option 2: External Cron Service (Recommended)
 * - Use a free service like cron-job.org, EasyCron, or GitHub Actions
 * - Schedule: Every hour (or more frequently)
 * - URL: https://your-domain.vercel.app/api/cron/notify-reserve-not-met?secret=YOUR_SECRET
 * - Set CRON_SECRET in Vercel environment variables for security
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
    // Call the PostgreSQL function that checks for reserve not met auctions
    const { data, error } = await supabase.rpc('notify_reserve_not_met_auctions');

    if (error) {
      console.error('Error calling notify_reserve_not_met_auctions:', error);
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      notificationsSent: data || 0,
      message: `Sent ${data || 0} reserve not met notifications`
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
