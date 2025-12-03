import os, re, json, time, requests
from bs4 import BeautifulSoup

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
REST = f"{SUPABASE_URL}/rest/v1/auctions"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

def scrape_live_auctions():
    """
    Scrapes live auction data from Bring a Trailer's embedded JSON.
    This is faster and more reliable than parsing HTML directly.
    """
    now = int(time.time())
    html = requests.get("https://bringatrailer.com/auctions/",
                       headers={"User-Agent":"Mozilla/5.0"}).text
    soup = BeautifulSoup(html, "html.parser")

    # Find the script tag that contains the auction data
    script = soup.find("script", id="bat-theme-auctions-current-initial-data")
    if not script or not script.string:
        print("⚠️ Could not find JSON script")
        return []

    # Clean up the JavaScript to extract just the JSON data
    text = script.string
    clean = re.sub(r"^/\*.*?\*/", "", text, flags=re.S)
    clean = re.sub(r"/\*.*?\*/$", "", clean, flags=re.S)
    m = re.search(r"var auctionsCurrentInitialData\s*=\s*(\{[\s\S]*?\});", clean)

    if not m:
        print("⚠️ Could not parse auctionsCurrentInitialData")
        return []

    data = json.loads(m.group(1))
    items = data.get("items", [])
    print(f"Found {len(items)} auctions via JSON")

    # DEBUGGING: Print out the first item to see what fields are available
    # You can comment these out once everything is working
    if items and len(items) > 0:
        print("=== SAMPLE AUCTION ITEM ===")
        print(json.dumps(items[0], indent=2))
        print("=== END SAMPLE ===")

    results = []
    for item in items:
        url = item.get("url", "")
        auction_id_match = re.search(r'/listing/([^/]+)/?$', url)
        auction_id = auction_id_match.group(1) if auction_id_match else None

        if not auction_id:
            continue

        title = item.get("title", "")

        # Extract year from title (looks for 4-digit years from 1940-2029)
        year_match = re.search(r'\b(19[4-9]\d|20[0-2]\d)\b', title)
        year = int(year_match.group()) if year_match else None

        # Parse current bid - remove currency symbols and commas
        bid_str = item.get("current_bid_formatted", "")
        current_bid = float(re.sub(r'[^\d.]', '', bid_str)) if bid_str else 0

        end_ts = item.get("timestamp_end") or 0

        # Extract image URL from the JSON data
        # BaT uses "thumbnail_url" field
        image_url = item.get("thumbnail_url")

        # Try other fields as fallback
        if not image_url:
            image_url = (item.get("image_url") or
                        item.get("image") or
                        item.get("featured_image"))

        # Clean up and normalize the image URL if we found one
        if image_url:
            # Remove resize parameters to get full-size images
            if "?resize=" in image_url:
                image_url = image_url.split("?resize=")[0]

            # Ensure it's a full URL (add protocol if missing)
            if image_url.startswith("//"):
                image_url = "https:" + image_url
            elif image_url.startswith("/"):
                image_url = "https://bringatrailer.com" + image_url

        results.append({
            "auction_id": auction_id,
            "title": title,
            "url": url,
            "current_bid": current_bid,
            "timestamp_end": end_ts,
            "year": year,
            "time_remaining": str(max(end_ts - now, 0)),
            "image_url": image_url
        })

    return results


def capture_48h_prices(existing_auctions):
    """
    🆕 NEW FUNCTION: Captures price_at_48h for auctions that are 48 hours old.

    BaT auctions typically run for 7 days. We capture the price at the 48-hour mark
    as the baseline "buy price" that players will use to draft cars.

    Returns a list of auctions that need their price_at_48h updated.
    """
    now = int(time.time())
    FORTY_EIGHT_HOURS = 48 * 60 * 60
    SEVEN_DAYS = 7 * 24 * 60 * 60

    auctions_to_update = []

    for auction_id, auction_data in existing_auctions.items():
        # Skip if price_at_48h is already set
        if auction_data.get('price_at_48h'):
            continue

        # Skip if we don't have the necessary data
        if not auction_data.get('timestamp_end') or not auction_data.get('current_bid'):
            continue

        end_ts = auction_data['timestamp_end']

        # Calculate when the auction started (assuming 7-day auctions)
        # If you know the actual start time from BaT data, use that instead
        estimated_start_ts = end_ts - SEVEN_DAYS
        auction_age = now - estimated_start_ts

        # If auction is at least 48 hours old and we don't have price_at_48h yet
        if auction_age >= FORTY_EIGHT_HOURS:
            auctions_to_update.append({
                "auction_id": auction_id,
                "price_at_48h": auction_data['current_bid'],
                "auction_age_hours": round(auction_age / 3600, 1)
            })

    if auctions_to_update:
        print(f"🎯 Found {len(auctions_to_update)} auctions that need price_at_48h captured")

    return auctions_to_update


def lambda_handler(event, context):
    """
    Main Lambda handler that runs every few minutes to update auction data.
    It efficiently updates only changed records and inserts new ones.

    🆕 ENHANCED: Now also captures price_at_48h for auctions at the 48-hour mark.
    """
    auctions = scrape_live_auctions()
    if not auctions:
        return {"statusCode": 200, "body": "0"}

    # Get all auction_ids from the scraped data
    auction_ids = [a['auction_id'] for a in auctions if a.get('auction_id')]

    # Fetch existing auctions in batches to avoid URL length limits
    existing_auctions = {}
    batch_size = 100

    for i in range(0, len(auction_ids), batch_size):
        batch = auction_ids[i:i + batch_size]
        existing_resp = requests.get(
            f"{REST}?auction_id=in.({','.join(batch)})",
            headers=HEADERS
        )

        if existing_resp.status_code == 200:
            for auction in existing_resp.json():
                existing_auctions[auction['auction_id']] = auction
        else:
            print(f"Error fetching batch {i//batch_size + 1}: {existing_resp.status_code}")

    print(f"Found {len(existing_auctions)} existing auctions in database")

    # 🆕 STEP 1: Capture price_at_48h for auctions that are 48 hours old
    price_48h_updates = capture_48h_prices(existing_auctions)

    # Separate what needs to be updated vs what's brand new
    updates = []
    inserts = []

    for auction in auctions:
        auction_id = auction.get('auction_id')
        if not auction_id:
            continue

        if auction_id in existing_auctions:
            # This auction already exists - check if anything changed
            existing = existing_auctions[auction_id]

            # Update if price changed OR if we now have an image and didn't before
            needs_update = (
                existing.get('current_bid') != auction['current_bid'] or
                (auction.get('image_url') and not existing.get('image_url'))
            )

            if needs_update:
                update_data = {
                    "auction_id": auction_id,
                    "current_bid": auction['current_bid'],
                    "time_remaining": auction['time_remaining']
                }

                # Only update image_url if we have a new one
                if auction.get('image_url'):
                    update_data["image_url"] = auction['image_url']

                updates.append(update_data)
        else:
            # This is a brand new auction - add it to inserts
            inserts.append(auction)

    print(f"Plan: {len(inserts)} new auctions to insert, {len(updates)} existing to update, {len(price_48h_updates)} price_at_48h to capture")

    # Batch insert new auctions (in smaller batches to avoid issues)
    inserted_count = 0
    if inserts:
        insert_batch_size = 100
        for i in range(0, len(inserts), insert_batch_size):
            batch = inserts[i:i + insert_batch_size]
            insert_resp = requests.post(REST, json=batch, headers=HEADERS)

            if insert_resp.status_code in (200, 201):
                inserted_count += len(batch)
                print(f"Inserted batch {i//insert_batch_size + 1}: {len(batch)} auctions")
            else:
                print(f"Insert error on batch {i//insert_batch_size + 1}: {insert_resp.status_code} - {insert_resp.text}")

    # Update existing auctions one by one
    updated_count = 0
    for update in updates:
        auction_id = update.pop('auction_id')
        upd_resp = requests.patch(
            f"{REST}?auction_id=eq.{auction_id}",
            json=update,
            headers=HEADERS
        )
        if upd_resp.status_code in (200, 204):
            updated_count += 1
        else:
            print(f"Update error for {auction_id}: {upd_resp.status_code}")

    # 🆕 STEP 2: Update price_at_48h for auctions that reached the 48-hour mark
    price_48h_count = 0
    for update in price_48h_updates:
        auction_id = update['auction_id']
        price_at_48h = update['price_at_48h']
        auction_age = update['auction_age_hours']

        upd_resp = requests.patch(
            f"{REST}?auction_id=eq.{auction_id}",
            json={"price_at_48h": price_at_48h},
            headers=HEADERS
        )

        if upd_resp.status_code in (200, 204):
            price_48h_count += 1
            print(f"✅ Captured price_at_48h for {auction_id}: ${price_at_48h:,.0f} (auction age: {auction_age}h)")
        else:
            print(f"❌ Error setting price_at_48h for {auction_id}: {upd_resp.status_code}")

    print(f"Completed: {updated_count} auctions updated, {inserted_count} new auctions inserted, {price_48h_count} price_at_48h captured")
    return {
        "statusCode": 200,
        "body": f"Updated: {updated_count}, New: {inserted_count}, Price@48h: {price_48h_count}"
    }
