import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST - Log a new activity
export async function POST(request) {
  try {
    const body = await request.json();
    const { leagueId, userId, username, activityType, message, metadata } = body;

    if (!leagueId || !userId || !username || !activityType || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: leagueId, userId, username, activityType, message' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('league_activities')
      .insert({
        league_id: leagueId,
        user_id: userId,
        username,
        activity_type: activityType,
        message,
        metadata: metadata || {}
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, activity: data });

  } catch (error) {
    console.error('Error logging activity:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET - Fetch activities for a league
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!leagueId) {
      return NextResponse.json({ error: 'leagueId required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('league_activities')
      .select('*')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ activities: data || [] });

  } catch (error) {
    console.error('Error fetching activities:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
