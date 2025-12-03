import os
import time
import re
import json
import requests
from bs4 import BeautifulSoup

# Supabase REST config
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
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

    # Create a map keyed by auction_id instead of URL
    auction_map = {}
    for item in data.get("items", []):
        url = item.get("url", "")
        auction_id_match = re.search(r'/listing/([^/]+)/?$', url)
        if auction_id_match:
            auction_id = auction_id_match.group(1)
            auction_map[auction_id] = item

    return auction_map

def lambda_handler(event, context):
    now = int(time.time())

    print(f"Current timestamp: {now}")

    # 🆕 WIDENED WINDOW: Capture baseline price when auctions have 4-6 days remaining
    # This gives us a 2-day window instead of 1-day, reducing risk of missing auctions
    #
    # Original: 5-6 days (24 hour window)
    # New: 4-6 days (48 hour window) - much more forgiving!
    min_end_time = now + 345600   # 4 days remaining (3 days into auction)
    max_end_time = now + 518400   # 6 days remaining (1 day into auction)

    print(f"🔍 Looking for auctions with 4-6 days remaining (1-3 days into auction)")
    print(f"   This captures baseline price early in the auction lifecycle")
    print(f"   timestamp_end between {min_end_time} and {max_end_time}")

    params = [
        ("select", "id,auction_id,title,timestamp_end"),
        ("price_at_48h", "is.null"),                   # Only auctions without baseline set
        ("timestamp_end", f"gte.{min_end_time}"),      # At least 4 days remaining
        ("timestamp_end", f"lte.{max_end_time}"),      # At most 6 days remaining
        ("final_price", "is.null")                      # Still active
    ]

    resp = requests.get(REST, params=params, headers=HEADERS)
    if resp.status_code != 200:
        print("❌ Error querying Supabase:", resp.status_code, resp.text)
        return {"statusCode": 500, "body": "Query failed"}

    rows = resp.json()
    print(f"✅ Found {len(rows)} auctions needing baseline price")

    if len(rows) == 0:
        print("✨ No auctions to update - all caught up!")
        return {"statusCode": 200, "body": "No updates needed"}

    live_map = fetch_live_data()
    print(f"📊 Fetched live data for {len(live_map)} active auctions")

    updated = 0
    skipped = 0
    errors = 0

    for row in rows:
        auction_id = row.get("auction_id")
        if not auction_id:
            skipped += 1
            continue

        item = live_map.get(auction_id)
        if not item:
            print(f"⚠️  Auction {auction_id} not found in live data (may have ended)")
            skipped += 1
            continue

        # Parse current bid
        bid_str = item.get("current_bid_formatted", "")
        bid_str = re.sub(r'[^\d.]', '', bid_str)

        try:
            bid = float(bid_str) if bid_str else 0
        except:
            print(f"❌ Could not parse bid for {auction_id}: {bid_str}")
            errors += 1
            continue

        if bid <= 0:
            print(f"⚠️  Invalid bid for {auction_id}: ${bid} - skipping")
            skipped += 1
            continue

        # Calculate how many days remaining
        days_remaining = (row['timestamp_end'] - now) / 86400

        # Update with baseline price
        upd = requests.patch(
            f"{REST}?id=eq.{row['id']}",
            json={"price_at_48h": bid},
            headers=HEADERS
        )

        if upd.status_code in (200, 204):
            updated += 1
            print(f"✅ Set baseline price for {auction_id}: ${bid:,.0f} ({days_remaining:.1f} days remaining)")

            # Log to price history
            price_history_url = f"{SUPABASE_URL}/rest/v1/auction_price_history"
            try:
                requests.post(
                    price_history_url,
                    json={
                        "auction_id": auction_id,
                        "price": bid,
                        "price_type": "baseline"
                    },
                    headers=HEADERS
                )
            except Exception as e:
                print(f"⚠️  Could not log price history: {e}")
        else:
            errors += 1
            print(f"❌ Update failed for {auction_id}:", upd.status_code, upd.text)

    print("=" * 60)
    print(f"📈 SUMMARY:")
    print(f"   ✅ Updated: {updated} auctions")
    print(f"   ⚠️  Skipped: {skipped} auctions")
    print(f"   ❌ Errors: {errors} auctions")
    print("=" * 60)

    return {
        "statusCode": 200,
        "body": json.dumps({
            "updated": updated,
            "skipped": skipped,
            "errors": errors,
            "total_found": len(rows)
        })
    }
