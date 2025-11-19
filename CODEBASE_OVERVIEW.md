# BixPrix Codebase Overview

## Project Architecture

The BixPrix application is a **Fantasy Auto Auctions** game built with a two-part architecture:

1. **Main Client App** (`/home/user/garage-draft/src/`) - React SPA for players
2. **Admin Portal** (`/home/user/garage-draft/auction-admin/`) - Next.js app for administrators

Both applications use **Supabase** as their backend (PostgreSQL database + authentication).

---

## 1. LEAGUE MANAGEMENT

### League Structure
Leagues represent competition periods where players draft cars and compete.

**Key Properties:**
- `id` - Unique identifier
- `name` - League name
- `created_by` - User ID of league creator
- `draft_starts_at` - ISO timestamp when draft opens
- `draft_ends_at` - ISO timestamp when draft closes (typically 24 hours)
- `is_public` - Boolean for visibility
- `status` - Status enum: 'draft', 'active'
- `bonus_auction_id` - Optional reference to bonus car auction
- `snapshot_created` - Boolean flag

**Storage:** Supabase table `leagues`

### League Management Features

**In Main App (App.js):**
- Fetch all public leagues: `fetchLeagues()` - queries `leagues` table with `is_public = true`
- Join a league: `joinLeague(league)` - Creates garage + league_member records
- Get draft status: `getDraftStatus(league)` - Determines if draft is open/upcoming/closed
- Select league: League persists in localStorage as `bixprix_selected_league`

**In Admin Portal (AdminPortal.jsx):**
- Create new league with draft start/end dates
- Optionally assign a bonus auction from active auctions
- View all leagues with member counts
- Delete leagues (cascades to garages, league_members)
- View league standings and member scores

---

## 2. AUCTION HANDLING & FETCHING

### Auction Data Model
Auctions represent real Bring a Trailer (BaT) car auctions.

**Key Fields:**
- `auction_id` - Unique identifier (can be BaT ID or manual_timestamp)
- `title` - Car name/description
- `make`, `model`, `year` - Vehicle info
- `price_at_48h` - Baseline price (locked on day 2, used for draft price)
- `current_bid` - Real-time current bid
- `final_price` - Final sale price (null until auction ends)
- `url` - Link to BaT auction page
- `image_url` - Car image
- `timestamp_end` - Unix timestamp when auction ends
- `inserted_at` - When record was created

**Storage:** Supabase table `auctions`

### Auction Filtering Strategy

Both the main app and admin portal use a **4-5 day draft window**:

```javascript
const now = Math.floor(Date.now() / 1000);
const fourDaysInSeconds = 4 * 24 * 60 * 60;
const fiveDaysInSeconds = 5 * 24 * 60 * 60;

const minEndTime = now + fourDaysInSeconds;
const maxEndTime = now + fiveDaysInSeconds;
```

**Query filters:**
- `timestamp_end >= minEndTime` - Auctions ending at least 4 days away
- `timestamp_end <= maxEndTime` - Auctions ending within 5 days
- `price_at_48h IS NOT NULL` - Must have baseline price
- `final_price IS NULL` - Not yet sold
- Ordered by `timestamp_end ASC` (earliest first)

**In Main App:**
- `fetchAuctions()` - Loads cars available for draft in current league
- Real-time subscription via Supabase PostgreSQL changes:
  - Listens for `UPDATE` events on `auctions` table
  - Updates `currentBid` when bids change
  - Triggers "Recent Updates" notifications for bid increases

**In Admin Portal:**
- Display auctions in draft window
- Search by title, make, model, year
- Add manual auctions (for testing/special cases)
- Delete auctions
- CSV import/export functionality
- Batch CSV import (50 auctions at a time)

### Bonus Car (Special Auction)
One auction per league is designated as the "bonus car" - a shared auction where all players predict the final price for 2x scoring.

---

## 3. ADMIN PANEL STRUCTURE

### Admin Portal Overview
Located at `/home/user/garage-draft/auction-admin/`

**Tech Stack:**
- Next.js 15.5.5
- React 19.1.0
- Tailwind CSS
- Supabase client
- Lucide React icons

**Key Files:**
- `app/page.js` - Main admin page
- `app/login/page.js` - Login page
- `components/AdminPortal.jsx` - Main admin component (958 lines)
- `lib/supabase.js` - Supabase client initialization
- `middleware.js` - Authentication middleware

### Authentication
- Basic cookie-based middleware protection on root route
- Redirects to `/login` if no `admin_auth` cookie
- Login page allows setting admin credentials (minimal security - should be enhanced)

### Admin Tabs & Features

**1. AUCTIONS TAB**
- Display count of auctions in draft window
- Search/filter functionality
- Add new auction form
- Delete individual auctions
- CSV Export: All auctions as CSV file
- CSV Import: Batch import up to 200 auctions
  - Parses CSV with proper quote handling
  - Upserts by `auction_id` (50 records per batch)

**2. USERS TAB**
- View all users with creation dates
- Add new users (username + email)
- Delete users (cascades to garages, league_members)

**3. LEAGUES TAB**
- Create new leagues with configurable dates
- Select bonus auction from active auctions in draft window
- Set public/private visibility
- View league details:
  - Creator username
  - Status (draft/active)
  - Draft date range
  - Assigned bonus car
- Display league standings (members sorted by score)
- Member count badges
- Delete leagues (cascades to all garages/members)

**4. GARAGES TAB**
- View all user garages with details
- Shows which league they belong to
- Lists cars in each garage
- Car purchase prices and auction info

### Admin Dashboard Stats
- Total Auctions (in draft window)
- Total Users
- Active Leagues
- Total Garages

---

## 4. DATA MODELS & RELATIONSHIPS

### Core Tables

#### users
- `id` - UUID primary key
- `username` - String
- `email` - String
- `created_at` - Timestamp

#### leagues
- `id` - UUID
- `name` - String
- `created_by` - Foreign key to users
- `draft_starts_at` - ISO timestamp
- `draft_ends_at` - ISO timestamp
- `is_public` - Boolean
- `bonus_auction_id` - Foreign key to auctions
- `status` - Enum
- `snapshot_created` - Boolean

#### garages
- `id` - UUID
- `user_id` - Foreign key to users
- `league_id` - Foreign key to leagues
- `remaining_budget` - Numeric (starts at $175,000)

#### garage_cars
- `id` - UUID
- `garage_id` - Foreign key to garages
- `auction_id` - Foreign key to auctions
- `purchase_price` - Numeric (price at day 2)

#### league_members
- `id` - UUID
- `league_id` - Foreign key to leagues
- `user_id` - Foreign key to users
- `total_score` - Numeric (percentage gain)

#### auctions
- `auction_id` - String (primary key)
- `title`, `make`, `model`, `year` - Strings/Int
- `price_at_48h` - Numeric (baseline)
- `current_bid` - Numeric
- `final_price` - Numeric (null until sold)
- `url` - String
- `image_url` - String
- `timestamp_end` - Integer (Unix timestamp)
- `inserted_at` - Timestamp

#### bonus_predictions
- `id` - UUID
- `league_id` - Foreign key to leagues
- `user_id` - Foreign key to users
- `predicted_price` - Numeric
- Composite unique key: (league_id, user_id)

---

## 5. GAME MECHANICS & SCORING

### Draft Phase
1. Player joins league during draft window
2. Gets $175,000 budget and empty 7-car garage
3. Can select up to 7 cars from available auctions
4. Price locked at **day 2 (48-hour mark)** - `price_at_48h`
5. Cannot modify garage once draft closes

### Scoring System

**Per-Car Score:**
```
If final_price exists:
  percentGain = (final_price - purchase_price) / purchase_price * 100
Else if reserve_not_met:
  effectivePrice = current_bid * 0.25  (penalty)
  percentGain = (effectivePrice - purchase_price) / purchase_price * 100
Else:
  percentGain = (current_bid - purchase_price) / purchase_price * 100
```

**Bonus Car Score (2x multiplier):**
- All players get the same bonus auction
- Players predict final price
- Closest prediction gets DOUBLE percentage gain
- Calculation in `calculateBonusCarScore()`:
  - Gets player's prediction from `bonus_predictions`
  - Gets actual final price from auction
  - Calculates percentage gain
  - Stores error margin for ranking

**Total Score:**
- Sum of all car percentage gains
- Plus bonus car percentage gain (2x if closest)

### Leaderboard

**Fetch Logic (`calculateUserScore`):**
1. Load player's garage and all cars
2. For each car:
   - Get purchase_price and final_price (or current_bid)
   - Check if auction ended and reserve met
   - Calculate percentage gain
   - Sum totals
3. Calculate bonus car score separately
4. Compute average per-car percentage

**Sort Options:**
- `total_percent` - Total % gain across all cars (primary ranking)
- `total_dollar` - Total $ gain
- `avg_percent` - Average % per car

**Display Fields:**
- Rank
- Username
- % Gain (color: green if positive, red if negative)
- $ Gain (same color coding)
- Avg %
- Cars drafted (out of 7)
- Total spent
- Bonus prediction status (checkmark if made prediction)

---

## 6. REAL-TIME FEATURES

### Supabase Real-Time Subscriptions

**In Main App (`App.js`, lines 750-826):**

```javascript
const auctionChannel = supabase
  .channel(`league-${selectedLeague.id}-auctions`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'auctions',
    },
    (payload) => {
      // Update auction bids in real-time
      // Trigger notifications for bid increases
      // Update garage cars if user owns them
      // Update bonus car if selected
    }
  )
  .on('subscribe', (status) => {
    if (status === 'SUBSCRIBED') {
      setConnectionStatus('connected')
    }
  })
  .subscribe()
```

**Connection Status Display:**
- Green pulse: Connected
- Yellow pulse: Connecting
- Red static: Disconnected
- Shows "last updated" timestamp

**Recent Updates:**
- Toast notifications for bid increases in garage cars
- Auto-removes after 10 seconds
- Shows car title and bid increase amount

---

## 7. MAIN APP SCREENS & NAVIGATION

### Landing Screen
- Hero section with game description
- "How It Works" section (3 steps)
- "Rules & Scoring" section (2 cards)
- Example scoring calculation
- Call-to-action buttons

### Login/Sign-Up Screen
- Email/password authentication via Supabase Auth
- Username field for sign-ups
- Toggles between sign-in and sign-up modes

### Leagues Screen
- Lists all public leagues
- Shows draft status (open/upcoming/closed)
- Displays player count and status badges
- Join button (disabled if draft not open)

### Auctions Screen (Available Cars)
- Header with budget and garage capacity
- Draft status indicator (red warning if closed, green if open)
- **Bonus Car Section** (if league has one):
  - Large card with image, title, current bid, time left
  - Prediction status badge
  - Button to open prediction modal
- Grid of available cars (2 columns on desktop):
  - Car image
  - Title with trending badge
  - Draft price, current bid, time remaining
  - "Add to Garage" button (disabled if: already owned, budget insufficient, draft closed)

### Garage Screen (My Cars)
- Header with budget and car count (X/7)
- Lock indicator if draft closed
- **Bonus Car Card** (if applicable):
  - Shows prediction status
  - Links to car image
  - Can open prediction modal
- 7 car slots (grid layout):
  - Filled: Shows image, title, draft/current prices, % gain, time left
  - Empty: Placeholder with car icon
  - Remove button (only if draft open)

### Leaderboard Screen
- League selector (if not selected)
- Sort buttons: % Gain, $ Gain, Avg %
- Refresh button
- Stats cards showing leaders in each category
- Full standings table with rank, player, scores, cars, bonus status

---

## 8. COLOR SCHEME & BRANDING

**CSS Variables** (`src/index.css`):
```css
--bp-navy: #0F1A2B    (Deep navy background)
--bp-cream: #FAF6EE   (Warm off-white text)
--bp-red: #D64541     (Racing red accent)
--bp-gold: #C2A14D    (Metallic gold accents)
--bp-gray: #B0B3B8    (UI gray for secondary text)
--bp-ink: #111111     (Dark text on light backgrounds)
```

**Typography:**
- Font: Inter (sans-serif)
- Font smoothing optimized for macOS and Windows
- Tailwind CSS for responsive design

**Theme Classes:**
- `.text-bpCream`, `.text-bpGray`, `.text-bpInk` - Text colors
- `.bg-bpNavy`, `.bg-bpCream`, `.bg-bpRed`, `.bg-bpGold` - Background colors

---

## 9. KEY DEPENDENCIES

### Main App
- `@supabase/supabase-js@^2.75.0` - Database & auth
- `react@^19.1.1` - UI framework
- `react-dom@^19.1.1` - DOM rendering
- `lucide-react@^0.536.0` - Icons
- `tailwindcss` & `postcss` - Styling
- `react-scripts@5.0.1` - Build tools

### Admin Portal
- `next@15.5.5` - React framework
- `@supabase/supabase-js@^2.75.0` - Database
- `tailwindcss@^4` - CSS framework
- `lucide-react@^0.545.0` - Icons
- React 19.1.0

---

## 10. FILE STRUCTURE

```
/home/user/garage-draft/
├── src/
│   ├── App.js                    (2,128 lines - Main app logic)
│   ├── App.css                   (Styling)
│   ├── index.js                  (Entry point)
│   ├── index.css                 (Brand tokens)
│   └── ...
├── auction-admin/
│   ├── app/
│   │   ├── page.js              (Main admin page)
│   │   ├── login/page.js        (Login page)
│   │   ├── layout.js            (Root layout)
│   │   └── globals.css          (Global styles)
│   ├── components/
│   │   └── AdminPortal.jsx      (958 lines - Admin UI)
│   ├── lib/
│   │   └── supabase.js          (Supabase client)
│   ├── middleware.js            (Auth middleware)
│   └── package.json
├── package.json                  (Main app dependencies)
├── tailwind.config.js            (Tailwind config)
├── postcss.config.js             (PostCSS config)
└── README.md
```

---

## 11. API/QUERY PATTERNS

### Authentication
```javascript
// Sign up
supabase.auth.signUp({ email, password, options: { data: { username } } })

// Sign in
supabase.auth.signInWithPassword({ email, password })

// Get session
supabase.auth.getSession()

// Auth state changes
supabase.auth.onAuthStateChange(callback)
```

### Data Queries
```javascript
// Fetch leagues
supabase.from('leagues')
  .select('*')
  .eq('is_public', true)
  .order('created_at', { ascending: false })

// Fetch auctions (draft window)
supabase.from('auctions')
  .select('*')
  .gte('timestamp_end', minEndTime)
  .lte('timestamp_end', maxEndTime)
  .not('price_at_48h', 'is', null)
  .is('final_price', null)
  .order('timestamp_end', { ascending: true })

// Fetch user garage
supabase.from('garages')
  .select('*')
  .eq('user_id', userId)
  .eq('league_id', leagueId)

// Fetch garage cars with auction details
supabase.from('garage_cars')
  .select('*, auctions!garage_cars_auction_id_fkey(*)')
  .eq('garage_id', garageId)

// Fetch leaderboard
supabase.from('league_members')
  .select('user_id, total_score, users(username, email)')
  .eq('league_id', leagueId)
```

### Data Mutations
```javascript
// Join league
supabase.from('garages').insert([{ user_id, league_id, remaining_budget }])
supabase.from('league_members').insert([{ league_id, user_id, total_score: 0 }])

// Add car to garage
supabase.from('garage_cars').insert([{ garage_id, auction_id, purchase_price }])

// Update budget
supabase.from('garages').update({ remaining_budget }).eq('id', garageId)

// Remove car from garage
supabase.from('garage_cars').delete().eq('id', carId)

// Submit prediction
supabase.from('bonus_predictions').upsert(
  { league_id, user_id, predicted_price },
  { onConflict: 'league_id,user_id' }
)
```

---

## 12. POTENTIAL EXTENSIONS & NOTES

### Current Limitations
- No database schema migration files
- Minimal admin authentication (cookie-based only)
- Manual auction creation is for testing (live BaT integration not implemented)
- Leaderboard scores calculated on-demand (not cached)

### Growth Opportunities
1. Live Bring a Trailer API integration to auto-fetch auctions
2. User profiles with statistics and history
3. Trading/selling cars between players
4. Multiple league scoring formats
5. Player rankings across all leagues
6. Social features (comments, predictions, chat)
7. Mobile app version
8. Export/print leaderboards

