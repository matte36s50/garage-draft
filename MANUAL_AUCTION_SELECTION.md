# Manual Auction Selection Feature

## Overview

This feature allows you to manually select specific auctions for leagues instead of using the default 4-5 day window. For example, you can create a "Porsche-only" league or a "Red Cars" league by manually selecting specific auctions.

## What's New

### 1. Database Changes
- **New table**: `league_auctions` - stores manually selected auctions for each league
- **New column**: `leagues.use_manual_auctions` - boolean flag to enable manual selection

### 2. Admin Portal Features
- Toggle between "Auto (4-5 day window)" and "Manual selection" when creating leagues
- "Manage Auctions" button for leagues with manual selection enabled
- Search and filter auctions by title, make, or model
- Set custom end dates for manually added auctions
- Visual indicators showing manual vs auto leagues

### 3. Player Experience
- Players see manually selected auctions when joining leagues with manual selection
- Otherwise, they see the default 4-5 day window auctions
- Everything else works the same (garage, scoring, leaderboard)

## Setup Instructions

### Step 1: Run Database Migration

1. Open your Supabase project dashboard
2. Go to the SQL Editor
3. Copy and paste the contents of `supabase_migration_league_auctions.sql`
4. Click "Run" to execute the migration

This will:
- Add the `use_manual_auctions` column to the `leagues` table
- Create the `league_auctions` table
- Set up proper indexes and RLS policies

### Step 2: Deploy the Updated Code

The following files have been updated:
- `/auction-admin/components/AdminPortal.jsx` - Admin panel with auction management UI
- `/src/App.js` - Updated to fetch manual auctions when applicable
- `/supabase_migration_league_auctions.sql` - Database migration script

Simply deploy these changes to your hosting platform.

## How to Use

### Creating a Manual League

1. Go to the Admin Portal
2. Click "Create New League"
3. Fill in the league details (name, dates, etc.)
4. Under "Auction Selection", choose **"Manual selection"**
5. Click "Create League"

### Managing Auctions

1. Find your manual league in the Leagues tab
2. Click the **"Manage Auctions"** button (purple button with car icon)
3. This opens the Auction Manager modal with two panels:
   - **Left**: Available auctions (all auctions in database)
   - **Right**: Selected auctions (auctions added to this league)

### Searching and Filtering

Use the filters at the top of the Auction Manager:
- **Search by title**: Type any part of the car title
- **Filter by make**: Type "Porsche" to see only Porsches
- **Filter by model**: Type "911" to see only 911s

**Example Use Cases:**
- All Porsches: Filter by make = "Porsche"
- All red cars: Search by title = "red"
- 1990s BMWs: Filter by make = "BMW", then manually select cars from the 90s
- Specific cars: Search for exact titles

### Adding Auctions

1. Find the auction you want in the left panel
2. Click the **+ (plus)** button
3. You'll be prompted to enter a custom end date:
   - Leave blank to use the auction's original end date
   - Or enter a Unix timestamp (seconds since 1970) for a custom end date
4. The auction appears in the right panel (Selected Auctions)

**Tip**: To generate a Unix timestamp:
```javascript
// In browser console:
new Date('2025-12-31 23:59:59').getTime() / 1000
```

### Removing Auctions

1. Find the auction in the right panel (Selected Auctions)
2. Click the **trash icon**
3. Confirm removal

### Finishing Up

1. Click **"Done"** when finished
2. The league card will show the number of selected auctions
3. Players joining this league will only see these auctions

## Example Scenarios

### Scenario 1: Porsche-Only League

1. Create league with manual selection enabled
2. Open Auction Manager
3. Filter by make: "Porsche"
4. Click + on all Porsches you want (or select specific models)
5. Click Done

### Scenario 2: Mixed Exotic Cars

1. Create league with manual selection enabled
2. Open Auction Manager
3. Search for "Ferrari" and add those
4. Clear search, search for "Lamborghini" and add those
5. Clear search, search for "McLaren" and add those
6. Click Done

### Scenario 3: Vintage Cars with Custom End Date

1. Create league with manual selection enabled
2. Open Auction Manager
3. Filter or search for vintage cars
4. For each car, when clicking +, enter a custom end date (e.g., league end date)
5. This ensures all cars end at the same time regardless of their original auction end date
6. Click Done

## Player Experience

When a player:
1. Views leagues and selects one with manual auctions
2. Joins the league
3. Goes to the Cars tab

They will see:
- Only the manually selected auctions (not the 4-5 day window)
- Custom end dates if specified
- Everything else works normally (budget, garage, scoring)

## Technical Details

### Database Schema

**league_auctions table:**
```sql
CREATE TABLE league_auctions (
  id BIGSERIAL PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  auction_id TEXT NOT NULL REFERENCES auctions(auction_id) ON DELETE CASCADE,
  custom_end_date BIGINT,  -- Unix timestamp (optional)
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(league_id, auction_id)
);
```

**leagues table (new column):**
```sql
ALTER TABLE leagues ADD COLUMN use_manual_auctions BOOLEAN DEFAULT FALSE;
```

### API Behavior

**When `use_manual_auctions = false` (default):**
- Fetches auctions with `timestamp_end` between 4-5 days from now
- Only shows active auctions with `price_at_48h` set
- Default behavior (unchanged)

**When `use_manual_auctions = true`:**
- Fetches auctions from `league_auctions` table for that league
- Uses custom end dates if specified
- No time window filtering

## Troubleshooting

### Migration fails with "column already exists"
The migration is idempotent - if columns/tables already exist, they won't be recreated. This is safe.

### No auctions showing in Auction Manager
Make sure you have auctions in your `auctions` table. The manager loads up to 500 recent auctions.

### Custom end date not working
Make sure you're entering a Unix timestamp (seconds, not milliseconds). Use:
```javascript
Math.floor(new Date('2025-12-31').getTime() / 1000)
```

### Players can't see manual auctions
1. Verify the league has `use_manual_auctions = true`
2. Check that auctions are added in the Auction Manager
3. Check browser console for errors

## Questions?

For issues or questions:
1. Check the browser console for error messages
2. Check the Supabase logs for database errors
3. Verify the migration ran successfully

## Summary

This feature gives you complete control over which auctions appear in your leagues. You can create themed leagues (Porsches, vintage cars, etc.) and even set custom end dates to ensure all auctions end at the same time for fair competition.
