import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * DIAGNOSTIC ENDPOINT
 *
 * Use this to test your cron setup before running the full update.
 * Visit: https://your-domain.vercel.app/api/cron/test-connection
 */

export async function GET(request) {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    checks: {}
  };

  // 1. Check environment variables
  diagnostics.checks.env = {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasCronSecret: !!process.env.CRON_SECRET,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT SET'
  };

  // 2. Test service role client
  try {
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // Test basic read
    const { data: leagues, error: leaguesError } = await serviceClient
      .from('leagues')
      .select('id, name')
      .limit(1);

    diagnostics.checks.databaseRead = {
      success: !leaguesError,
      error: leaguesError?.message,
      foundLeagues: leagues?.length || 0
    };

    // Test if performance_history table exists
    const { data: perfHistory, error: perfError } = await serviceClient
      .from('performance_history')
      .select('id')
      .limit(1);

    diagnostics.checks.performanceHistoryTable = {
      exists: !perfError || perfError.code !== 'PGRST116', // PGRST116 = table doesn't exist
      error: perfError?.message,
      hasData: (perfHistory?.length || 0) > 0
    };

    // Test if calculate_league_ranks function exists
    if (leagues && leagues.length > 0) {
      const { error: rpcError } = await serviceClient.rpc('calculate_league_ranks', {
        p_league_id: leagues[0].id
      });

      diagnostics.checks.calculateRanksFunction = {
        exists: !rpcError || rpcError.code !== '42883', // 42883 = function doesn't exist
        error: rpcError?.message
      };
    }

    // Test write permissions
    const testSnapshot = {
      league_id: leagues?.[0]?.id || '00000000-0000-0000-0000-000000000000',
      user_id: '00000000-0000-0000-0000-000000000000',
      timestamp: new Date().toISOString(),
      cumulative_gain: 0,
      rank: 999,
      total_spent: 0,
      car_count: 0,
      snapshot: { test: true }
    };

    const { error: insertError } = await serviceClient
      .from('performance_history')
      .insert(testSnapshot);

    // If insert succeeded, delete it
    if (!insertError) {
      await serviceClient
        .from('performance_history')
        .delete()
        .eq('rank', 999)
        .eq('car_count', 0);
    }

    diagnostics.checks.writePermissions = {
      canWrite: !insertError,
      error: insertError?.message,
      errorCode: insertError?.code,
      errorDetails: insertError?.details
    };

  } catch (error) {
    diagnostics.checks.unexpectedError = {
      message: error.message,
      stack: error.stack
    };
  }

  // 3. Overall status
  const hasServiceKey = diagnostics.checks.env.hasServiceRoleKey;
  const canRead = diagnostics.checks.databaseRead?.success;
  const tableExists = diagnostics.checks.performanceHistoryTable?.exists;
  const canWrite = diagnostics.checks.writePermissions?.canWrite;

  diagnostics.status = hasServiceKey && canRead && tableExists && canWrite
    ? '✅ All checks passed! Cron should work.'
    : '❌ Issues detected (see checks below)';

  diagnostics.recommendations = [];

  if (!hasServiceKey) {
    diagnostics.recommendations.push(
      '⚠️ CRITICAL: SUPABASE_SERVICE_ROLE_KEY not set in Vercel environment variables. ' +
      'Get it from Supabase Dashboard → Settings → API → service_role key (secret)'
    );
  }

  if (!tableExists) {
    diagnostics.recommendations.push(
      '⚠️ Run the database migration: supabase_migration_dashboard.sql in Supabase SQL Editor'
    );
  }

  if (!canWrite && tableExists) {
    diagnostics.recommendations.push(
      '⚠️ Service role cannot write to performance_history. Check RLS policies in Supabase.'
    );
  }

  return NextResponse.json(diagnostics, {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
