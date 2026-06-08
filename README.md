# Bid Prix 🏁

**Fantasy auto auctions** — fantasy football, but the players are classic cars and the
scoring is the live auction market.

Bid Prix is built on top of live **Bring a Trailer (BaT)** car auctions. Each player gets a
**$175,000 budget** and drafts **7 cars** from open auctions. As real bids roll in, each car's
value moves, and players are ranked by the total current value of their garage.

---

## How It Works

1. **Join a league** during its draft window. You get a $175,000 budget and an empty 7‑car garage.
2. **Draft up to 7 cars** from the auctions ending in the draft window. Each car's *draft price* is
   locked at the 48‑hour mark (`price_at_48h`).
3. **Predict the bonus car** — one shared auction per league. The closest prediction earns a **2×**
   scoring multiplier.
4. **Watch the market move.** Bids update in real time and the leaderboard re‑ranks players by the
   current value of their garage.

### Scoring

Each car is scored on its percentage gain from the locked draft price:

```
If the auction has sold:
  percentGain = (final_price - purchase_price) / purchase_price * 100
Else if the reserve was not met:
  percentGain = (current_bid * 0.25 - purchase_price) / purchase_price * 100   // penalty
Else:
  percentGain = (current_bid - purchase_price) / purchase_price * 100
```

A player's **total score** is the sum of all car gains plus the bonus‑car gain (doubled for the
closest prediction). Players can sort the leaderboard by total % gain, total $ gain, or average %.

---

## Architecture

Bid Prix is a two‑part application backed by **Supabase** (PostgreSQL + Auth):

| Part | Path | Stack |
|---|---|---|
| **Player app** | `src/` | React 19 (Create React App) + Tailwind CSS |
| **Admin portal** | `auction-admin/` | Next.js 15 + Tailwind CSS |

Key dependencies: `@supabase/supabase-js`, `react`, `tailwindcss`, `lucide-react`,
`framer-motion`, `recharts`, `date-fns`.

### Data model (Supabase)

`users` · `leagues` · `garages` · `garage_cars` · `league_members` · `auctions` ·
`bonus_predictions`. SQL migrations live in the repo root (`supabase_migration_*.sql`).
See [`CODEBASE_OVERVIEW.md`](CODEBASE_OVERVIEW.md) for full table shapes and query patterns.

### Real‑time

The player app subscribes to Supabase `postgres_changes` on the `auctions` table to update bids
live, push "bid increased" notifications for cars in your garage, and surface a connection‑status
indicator.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (URL + anon key)

### Player app

```bash
npm install
npm start          # dev server at http://localhost:3000
npm test           # interactive test runner
npm run build      # production build → build/
```

> **Note:** the player app currently initializes its Supabase client with credentials defined at
> the top of `src/App.js`. Update those values to point at your own Supabase project.

### Admin portal

```bash
cd auction-admin
npm install
npm run dev        # Next.js dev server
```

The admin portal reads Supabase credentials from environment variables
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). It manages auctions (incl. CSV import/export), users, leagues, bonus‑car assignment,
and garages.

---

## Scheduled Jobs

Hourly and half‑hourly tasks (score/performance updates and "auction ending soon" notifications)
run via **[cron-job.org](https://cron-job.org)** hitting protected API endpoints under
`/api/cron/*`. Each endpoint requires a `secret` query parameter matching the `CRON_SECRET`
environment variable. See [`CODEBASE_OVERVIEW.md`](CODEBASE_OVERVIEW.md) §12 for details.

---

## Design

The mobile UI follows a "car‑forward" redesign grounded in Apple's Human Interface Guidelines:
large car imagery, a monospace "pit‑board / telemetry" type voice, a near‑black palette with a
racing‑red accent, and a 5‑tab bottom navigation (`DASH · AUCTIONS · PICK · GARAGE · RANKS`).

Design tokens, the type scale, per‑screen specs, and reference prototypes are documented in the
design handoff package (`design_handoff_redesign/`).

---

## Documentation

- [`CODEBASE_OVERVIEW.md`](CODEBASE_OVERVIEW.md) — architecture, data models, scoring, and query patterns
- [`MANUAL_AUCTION_SELECTION.md`](MANUAL_AUCTION_SELECTION.md) — manual auction selection workflow
- [`VERCEL_DEPLOYMENT_GUIDE.md`](VERCEL_DEPLOYMENT_GUIDE.md) — deployment guide

---

*Bootstrapped with [Create React App](https://github.com/facebook/create-react-app).*
