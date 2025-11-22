-- =====================================================
-- Enhanced Dashboard & League Tables Migration
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Performance history table for tracking user gains over time
CREATE TABLE IF NOT EXISTS performance_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  timestamp TIMESTAMP DEFAULT NOW(),
  cumulative_gain DECIMAL NOT NULL,
  rank INTEGER NOT NULL,
  total_spent DECIMAL,
  car_count INTEGER,
  snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_performance_history_lookup ON performance_history(league_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_performance_history_league ON performance_history(league_id, timestamp DESC);

-- Activity feed table
CREATE TABLE IF NOT EXISTS league_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_activities_league ON league_activities(league_id, created_at DESC);

-- User achievements/badges
CREATE TABLE IF NOT EXISTS user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  achievement_type TEXT NOT NULL,
  league_id UUID REFERENCES leagues(id),
  earned_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id, earned_at DESC);

-- Add fields to leagues table for featured content
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS weekly_summary TEXT;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS top_performer_id UUID REFERENCES users(id);

-- Add fields to league_members for additional stats
ALTER TABLE league_members ADD COLUMN IF NOT EXISTS rank INTEGER;
ALTER TABLE league_members ADD COLUMN IF NOT EXISTS rank_change INTEGER DEFAULT 0;
ALTER TABLE league_members ADD COLUMN IF NOT EXISTS peak_rank INTEGER;
ALTER TABLE league_members ADD COLUMN IF NOT EXISTS win_streak INTEGER DEFAULT 0;

-- =====================================================
-- Helper Functions
-- =====================================================

-- Function to calculate user's current rank in a league
CREATE OR REPLACE FUNCTION calculate_league_ranks(p_league_id UUID)
RETURNS void AS $$
BEGIN
  WITH ranked_members AS (
    SELECT
      user_id,
      RANK() OVER (ORDER BY total_score DESC) as new_rank
    FROM league_members
    WHERE league_id = p_league_id
  )
  UPDATE league_members lm
  SET
    rank_change = COALESCE(lm.rank, rm.new_rank) - rm.new_rank,
    peak_rank = LEAST(COALESCE(lm.peak_rank, rm.new_rank), rm.new_rank),
    rank = rm.new_rank
  FROM ranked_members rm
  WHERE lm.user_id = rm.user_id
    AND lm.league_id = p_league_id;
END;
$$ LANGUAGE plpgsql;

-- Function to log activity
CREATE OR REPLACE FUNCTION log_league_activity(
  p_league_id UUID,
  p_user_id UUID,
  p_username TEXT,
  p_activity_type TEXT,
  p_message TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS void AS $$
BEGIN
  INSERT INTO league_activities (league_id, user_id, username, activity_type, message, metadata)
  VALUES (p_league_id, p_user_id, p_username, p_activity_type, p_message, p_metadata);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Row Level Security Policies
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE performance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- Performance history: users can view their own and league members' history
CREATE POLICY "Users can view performance history in their leagues"
  ON performance_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = performance_history.league_id
      AND league_members.user_id = auth.uid()
    )
  );

-- League activities: users can view activities in their leagues
CREATE POLICY "Users can view league activities"
  ON league_activities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = league_activities.league_id
      AND league_members.user_id = auth.uid()
    )
  );

-- User achievements: users can view their own achievements
CREATE POLICY "Users can view their own achievements"
  ON user_achievements FOR SELECT
  USING (user_id = auth.uid());

-- Allow service role to insert/update (for cron jobs)
CREATE POLICY "Service role can manage performance history"
  ON performance_history FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage league activities"
  ON league_activities FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage achievements"
  ON user_achievements FOR ALL
  USING (auth.role() = 'service_role');
