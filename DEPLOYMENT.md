# BixPrix Deployment Guide

This project consists of two separate applications that should be deployed independently:

## 1. Main Player App (React/Create React App)

**Location:** Root directory (`/`)
**Framework:** Create React App
**Purpose:** Player-facing fantasy auction game with Dashboard, Auctions, Garage, and Leaderboard

### Deployment Steps:

1. **Create a new Vercel project** for the main app
2. **Import your GitHub repository** at Vercel
3. **Configure the project:**
   - Framework Preset: `Create React App` (or `Other` if not auto-detected)
   - Build Command: `npm run build`
   - Output Directory: `build`
   - Install Command: `npm install`
   - Root Directory: `./` (root)

4. **Set Environment Variables** (if needed):
   - Supabase credentials are currently hardcoded in `src/App.js`
   - Consider moving them to environment variables for production

5. **Deploy!** Vercel will build and deploy your app

### ✅ Configuration Files:
- `vercel.json` - Vercel configuration (already created)
- `.vercelignore` - Files to exclude from deployment (already created)

---

## 2. Admin Portal (Next.js)

**Location:** `/auction-admin`
**Framework:** Next.js 15
**Purpose:** Admin interface for managing leagues, auctions, users, and garages

### Deployment Steps:

1. **Create a SEPARATE Vercel project** for the admin portal
2. **Import your GitHub repository** at Vercel
3. **Configure the project:**
   - Framework Preset: `Next.js`
   - Build Command: `npm run build`
   - Output Directory: `.next`
   - Install Command: `npm install`
   - Root Directory: `auction-admin` ⚠️ **IMPORTANT**

4. **Set Environment Variables:**
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   CRON_SECRET=your-secret-for-cron-protection (optional but recommended)
   ```

5. **Deploy!** Vercel will build and deploy your admin portal

### ✅ Configuration Files:
- `auction-admin/vercel.json` - Vercel configuration (already created)

### 📊 Performance Tracking (Optional)

The admin portal includes a performance tracking endpoint at `/api/cron/update-performance`. Since Vercel cron jobs require a paid plan, you have three options:

**Option 1: External Cron Service (Recommended)**
- Use [cron-job.org](https://cron-job.org) (free)
- Schedule: Every hour `0 * * * *`
- URL: `https://your-admin-domain.vercel.app/api/cron/update-performance?secret=YOUR_SECRET`

**Option 2: Manual Trigger**
- Visit the endpoint whenever you want to capture a performance snapshot
- URL: `https://your-admin-domain.vercel.app/api/cron/update-performance?secret=YOUR_SECRET`

**Option 3: Skip It**
- The dashboard works perfectly without it
- You just won't have historical performance trends and rank change indicators

---

## Troubleshooting

### DEPLOYMENT_NOT_FOUND Error

This error occurs when:
1. The deployment doesn't exist at the accessed URL
2. The Vercel project hasn't been created yet
3. The deployment was deleted

**Solution:** Create a new Vercel project following the steps above.

### 404 Errors on Routes

**For Main App:** The `vercel.json` includes rewrites to handle client-side routing. All routes will be redirected to `index.html`.

**For Admin Portal:** Next.js handles routing automatically.

### Build Failures

**Check:**
1. All dependencies are properly listed in `package.json`
2. Build command is correct (`npm run build`)
3. Environment variables are set (for admin portal)
4. Node version compatibility (both apps use modern React 19)

---

## Project URLs

After deployment, you'll have two separate URLs:

- **Main App:** `https://your-app-name.vercel.app` (player-facing game)
- **Admin Portal:** `https://your-admin-name.vercel.app` (admin interface)

You can also configure custom domains in Vercel's project settings.

---

## Database Setup

Both apps connect to the same Supabase database. Ensure you have:

1. Created tables using the migration files:
   - `supabase_migration_dashboard.sql`
   - `supabase_migration_league_auctions.sql`
   - `supabase_migration_spending_limits.sql`

2. Set up proper RLS (Row Level Security) policies in Supabase

3. Obtained your Supabase credentials:
   - Project URL
   - Anon (public) key
   - Service role key (for admin portal only)

---

## Security Notes

⚠️ **Important:**

1. The main app currently has Supabase credentials hardcoded in `src/App.js` (lines 5-6)
   - Consider moving these to environment variables for production
   - Use `REACT_APP_` prefix for Create React App environment variables

2. The admin portal should always use environment variables (never commit secrets)

3. Set a strong `CRON_SECRET` to protect the cron endpoint from unauthorized access

4. Review and strengthen the admin authentication mechanism (currently basic cookie-based)

---

## Quick Start Checklist

- [ ] Run database migrations in Supabase SQL Editor
- [ ] Create Vercel project for main app (root directory)
- [ ] Create Vercel project for admin portal (`auction-admin` directory)
- [ ] Set environment variables for admin portal
- [ ] Deploy both applications
- [ ] (Optional) Set up external cron service for performance tracking
- [ ] Test both deployments
- [ ] Configure custom domains (optional)

---

**Need help?** Check the [Vercel Documentation](https://vercel.com/docs) or [Next.js Deployment Guide](https://nextjs.org/docs/deployment).
