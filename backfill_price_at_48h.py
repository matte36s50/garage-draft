"""
ONE-TIME BACKFILL SCRIPT
========================
Run this once to populate price_at_48h for existing auctions that are missing it.

This will fix all auctions currently in the 4-5 day window that don't have price_at_48h set.
"""

import os
import time
import re
import json
import requests
from bs4 import BeautifulSoup

# Supabase REST config
SUPABASE_URL = os.environ.get("SUPABASE_URL", "YOUR_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "YOUR_SUPABASE_KEY")
REST = f"{SUPABASE_URL}/rest/v1/auctions"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

def fetch_live_data():
    """Fetch embedded JSON of all live auctions."""
    html = requests.get(
        "https://bringatrailer.com/auctions/",
        headers={"User-Agent":"Mozilla/5.0"}
    ).text
    soup = BeautifulSoup(html, "html.parser")

    script = soup.find("script", id="bat-theme-auctions-current-initial-data")
    if not script or not script.string:
        return {}

    text = re.sub(r"/\*[\s\S]*?\*/", "", script.string)
    m = re.search(r"var auctionsCurrentInitialData\s*=\s*({[\s\S]*?})\s*;", text)
    data = json.loads(m.group(1)) if m else {}

    # Create a map keyed by auction_id
    auction_map = {}
    for item in data.get("items", []):
        url = item.get("url", "")
        auction_id_match = re.search(r'/listing/([^/]+)/?$', url)
        if auction_id_match:
            auction_id = auction_id_match.group(1)
            auction_map[auction_id] = item

    return auction_map

def backfill_missing_prices():
    """
    Backfill price_at_48h for ALL auctions that:
    1. Are still active (final_price is null)
    2. Don't have price_at_48h set yet
    3. Have at least 3 days remaining (to be safe)
    """
    now = int(time.time())

    # Get auctions with at least 3 days remaining and no price_at_48h
    min_end_time = now + (3 * 86400)  # At least 3 days remaining

    print("=" * 60)
    print("🔧 BACKFILL: Finding auctions missing price_at_48h")
    print("=" * 60)

    params = [
        ("select", "id,auction_id,title,timestamp_end"),
        ("price_at_48h", "is.null"),
        ("timestamp_end", f"gte.{min_end_time}"),  # At least 3 days remaining
        ("final_price", "is.null")
    ]

    resp = requests.get(REST, params=params, headers=HEADERS)
    if resp.status_code != 200:
        print(f"❌ Error querying Supabase: {resp.status_code} {resp.text}")
        return

    rows = resp.json()
    print(f"📊 Found {len(rows)} auctions missing price_at_48h")

    if len(rows) == 0:
        print("✨ No backfill needed - all auctions have baseline prices!")
        return

    print("\nFetching current prices from BringATrailer...")
    live_map = fetch_live_data()
    print(f"✅ Got live data for {len(live_map)} active auctions\n")

    updated = 0
    skipped = 0

    for i, row in enumerate(rows, 1):
        auction_id = row.get("auction_id")
        if not auction_id:
            skipped += 1
            continue

        item = live_map.get(auction_id)
        if not item:
            print(f"⚠️  [{i}/{len(rows)}] {auction_id}: Not found in live data")
            skipped += 1
            continue

        # Parse current bid
        bid_str = item.get("current_bid_formatted", "")
        bid_str = re.sub(r'[^\d.]', '', bid_str)

        try:
            bid = float(bid_str) if bid_str else 0
        except:
            print(f"❌ [{i}/{len(rows)}] {auction_id}: Could not parse bid '{bid_str}'")
            skipped += 1
            continue

        if bid <= 0:
            print(f"⚠️  [{i}/{len(rows)}] {auction_id}: Invalid bid ${bid}")
            skipped += 1
            continue

        # Calculate days remaining
        days_remaining = (row['timestamp_end'] - now) / 86400

        # Update the auction
        upd = requests.patch(
            f"{REST}?id=eq.{row['id']}",
            json={"price_at_48h": bid},
            headers=HEADERS
        )

        if upd.status_code in (200, 204):
            updated += 1
            print(f"✅ [{i}/{len(rows)}] {auction_id}: Set baseline ${bid:,.0f} ({days_remaining:.1f}d remaining)")
        else:
            print(f"❌ [{i}/{len(rows)}] {auction_id}: Update failed - {upd.status_code}")
            skipped += 1

    print("\n" + "=" * 60)
    print("📈 BACKFILL COMPLETE")
    print("=" * 60)
    print(f"✅ Updated: {updated} auctions")
    print(f"⚠️  Skipped: {skipped} auctions")
    print(f"📊 Total: {len(rows)} auctions processed")
    print("=" * 60)

if __name__ == "__main__":
    backfill_missing_prices()
