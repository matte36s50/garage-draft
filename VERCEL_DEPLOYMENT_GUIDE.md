# Vercel Deployment Guide

## Project Structure

This is a monorepo containing two separate applications:

1. **garage-draft** - React (Create React App) - Located at root directory
2. **auction-admin** - Next.js admin portal - Located in `auction-admin/` subdirectory

## Vercel Project Configuration

### For garage-draft (React App)

The `vercel.json` at the root configures the garage-draft deployment:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "build",
  "devCommand": "npm start",
  "installCommand": "npm install",
  "framework": null,
  "regions": ["iad1"]
}
```

**Required Vercel Dashboard Settings:**

1. **Project Name:** garage-draft
2. **Root Directory:** `.` (root of repository)
3. **Framework Preset:** Other (or Create React App)
4. **Build Command:** `npm run build`
5. **Output Directory:** `build`
6. **Install Command:** `npm install`
7. **Production Branch:** `main`
8. **Auto-Deploy:** Enabled (should deploy on every push to main)

### For auction-admin (Next.js App)

Create a separate Vercel project:

1. **Project Name:** bid-prix-admin (or auction-admin)
2. **Root Directory:** `auction-admin`
3. **Framework Preset:** Next.js
4. **Build Command:** `npm run build`
5. **Output Directory:** (leave default for Next.js)
6. **Install Command:** `npm install`
7. **Production Branch:** `main`
8. **Auto-Deploy:** Enabled

## Troubleshooting Deployment Issues

### Issue: Deployment not updating with latest changes

**Symptoms:** Vercel shows old deployments, new commits to main aren't triggering builds

**Solutions to check:**

1. **Verify Git Integration:**
   - Go to Vercel Dashboard → Project Settings → Git
   - Ensure the repository is connected: `matte36s50/garage-draft`
   - Ensure Production Branch is set to `main`

2. **Check Auto-Deploy Settings:**
   - Go to Project Settings → Git
   - Ensure "Automatically deploy commits to Production Branch" is enabled

3. **Check Build Settings:**
   - Go to Project Settings → Build & Development Settings
   - Root Directory should be `.` for garage-draft
   - Build Command should be `npm run build`

4. **Manual Redeploy:**
   - Go to Deployments tab
   - Find the latest commit from `main` branch
   - Click the three dots → Redeploy

5. **Check Deployment Logs:**
   - Go to Deployments tab
   - Click on the most recent deployment
   - Check logs for any errors

6. **Verify Branch Protection:**
   - The project should deploy from `main` branch
   - If you push to feature branches, they create preview deployments, not production

### Issue: Build Failures

If builds are failing, check:

1. **Dependencies:** Ensure `package.json` is up to date
2. **Node Version:** Check if Vercel is using the correct Node version (Settings → General → Node.js Version)
3. **Environment Variables:** If the app uses Supabase or other services, ensure env vars are set in Project Settings → Environment Variables

## Recent Configuration History

- **PR #79 (c671ee9):** Added initial vercel.json for deployment
- **PR #83 (1c1875a):** Separated Vercel configs for multi-project setup
- **PR #83 (0857af2):** Reverted to remove all vercel.json files, relying on dashboard config
- **Current:** Re-added vercel.json to ensure consistent builds

## Current Status

As of the last check:
- Build tested locally: ✅ **Success** (with minor linting warnings)
- Latest main branch commit: `13a8154` (PR #85)
- vercel.json: ✅ Present and configured

## Next Steps

1. Push this commit with the vercel.json
2. Check Vercel dashboard settings (see above)
3. Trigger a manual redeploy if auto-deploy doesn't trigger
4. Monitor deployment logs for any issues
