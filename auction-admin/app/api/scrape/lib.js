import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Shared utilities for the auction scraping API.
 *
 * These endpoints let Claude Code (or any HTTP client) ingest auction data
 * scraped from ANY auction site into the app as manual auctions.
 *
 * Authentication: requests must include either:
 *   - Header: Authorization: Bearer <CRON_SECRET>
 *   - Query param: ?secret=<CRON_SECRET>
 *
 * Uses the same CRON_SECRET env var as the existing cron jobs.
 */

export function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function verifyAuth(request) {
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is configured, allow all requests (dev mode)
  if (!cronSecret) return null;

  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const secretParam = searchParams.get('secret');

  const isValidHeader = authHeader === `Bearer ${cronSecret}`;
  const isValidParam = secretParam === cronSecret;

  if (!isValidHeader && !isValidParam) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null; // null = authorized
}

/**
 * Generate a manual auction ID.
 * Uses the manual_ prefix so the rest of the app recognizes it as a manual auction.
 *
 * If a source URL is provided, derives a stable slug-based ID.
 * Otherwise, generates a timestamp-based ID.
 */
export function generateManualAuctionId(url = null, title = null) {
  if (url) {
    // Derive a stable ID from the URL slug
    try {
      const urlObj = new URL(url);
      const slug = urlObj.pathname
        .replace(/^\/+|\/+$/g, '')  // strip leading/trailing slashes
        .replace(/\//g, '-')        // replace path separators
        .replace(/[^a-zA-Z0-9-]/g, '') // strip special chars
        .slice(0, 80);              // limit length
      if (slug) return `manual_${slug}`;
    } catch {
      // Fall through to other methods
    }
  }

  if (title) {
    // Derive from title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    if (slug) return `manual_${slug}`;
  }

  // Fallback: timestamp-based
  return `manual_${Date.now()}`;
}
