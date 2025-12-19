import os
import json
import re
import time
import random
from datetime import datetime, timedelta, timezone

import requests

# -------- ENV --------
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# User agent pool
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
]

# -------- HTML PARSING --------
def extract_price_from_html(html_content: str):
    """
    Extracts a closing price from a BaT listing HTML.
    Supports multiple currencies and formats.

    Returns:
        (price:int|None, status:str, currency:str|None)
        status: "sold", "no_sale", "withdrawn", or None
    """

    # Check for withdrawn/cancelled listings first
    withdrawn_patterns = [
        r'listing\s+(?:has\s+been\s+)?(?:withdrawn|cancelled|removed)',
        r'auction\s+(?:has\s+been\s+)?(?:withdrawn|cancelled|ended\s+early)',
        r'this\s+listing\s+is\s+no\s+longer\s+available',
    ]
    for pattern in withdrawn_patterns:
        if re.search(pattern, html_content, re.IGNORECASE):
            print("   🚫 Detected: Withdrawn/Cancelled listing")
            return None, "withdrawn", None

    # Currency patterns - order matters (most specific first)
    # Format: (pattern, currency_code)
    sale_patterns = [
        # USD patterns
        (r"Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)", "USD"),
        (r"Bid\s+to\s+(?:USD\s+)?\$\s*([\d,]+)", "USD"),
        (r"Winning\s+bid\s+(?:of\s+)?(?:USD\s+)?\$\s*([\d,]+)", "USD"),

        # EUR patterns (European format may use . for thousands)
        (r"Sold\s+for\s+EUR\s*€?\s*([\d,\.]+)", "EUR"),
        (r"Bid\s+to\s+EUR\s*€?\s*([\d,\.]+)", "EUR"),
        (r"Winning\s+bid\s+(?:of\s+)?EUR\s*€?\s*([\d,\.]+)", "EUR"),

        # GBP patterns
        (r"Sold\s+for\s+GBP\s*£?\s*([\d,]+)", "GBP"),
        (r"Bid\s+to\s+GBP\s*£?\s*([\d,]+)", "GBP"),
        (r"Winning\s+bid\s+(?:of\s+)?GBP\s*£?\s*([\d,]+)", "GBP"),

        # CAD patterns
        (r"Sold\s+for\s+CAD\s*\$?\s*([\d,]+)", "CAD"),
        (r"Bid\s+to\s+CAD\s*\$?\s*([\d,]+)", "CAD"),

        # AUD patterns
        (r"Sold\s+for\s+AUD\s*\$?\s*([\d,]+)", "AUD"),
        (r"Bid\s+to\s+AUD\s*\$?\s*([\d,]+)", "AUD"),

        # CHF patterns (Swiss Franc)
        (r"Sold\s+for\s+CHF\s*([\d,\']+)", "CHF"),
        (r"Bid\s+to\s+CHF\s*([\d,\']+)", "CHF"),

        # Generic patterns with currency symbols (fallback)
        (r"Sold\s+for\s+€\s*([\d,\.]+)", "EUR"),
        (r"Bid\s+to\s+€\s*([\d,\.]+)", "EUR"),
        (r"Sold\s+for\s+£\s*([\d,]+)", "GBP"),
        (r"Bid\s+to\s+£\s*([\d,]+)", "GBP"),

        # Strong tag patterns (BaT often wraps price in <strong>)
        (r"<strong>\s*(?:USD\s+)?\$\s*([\d,]+)\s*</strong>", "USD"),
        (r"<strong>\s*EUR\s*€?\s*([\d,\.]+)\s*</strong>", "EUR"),
        (r"<strong>\s*GBP\s*£?\s*([\d,]+)\s*</strong>", "GBP"),
    ]

    for pattern, currency in sale_patterns:
        m = re.search(pattern, html_content, re.IGNORECASE)
        if m:
            price_str = m.group(1)
            # Clean up the price string
            # Handle European format (. for thousands, , for decimals) vs US format
            if currency == "EUR" and "." in price_str and "," in price_str:
                # European format: 120.000,00 -> 120000
                price_str = price_str.replace(".", "").replace(",", ".")
            elif currency == "CHF" and "'" in price_str:
                # Swiss format: 120'000 -> 120000
                price_str = price_str.replace("'", "")
            else:
                # US/UK format: 120,000 -> 120000
                price_str = price_str.replace(",", "")

            # Remove any decimal portion
            if "." in price_str:
                price_str = price_str.split(".")[0]

            try:
                price = int(price_str)
                if price > 0:
                    print(f"   💰 Found: {currency} {price:,} (sold)")
                    return price, "sold", currency
            except ValueError:
                continue

    # Check for "High Bid" (reserve not met)
    high_bid_patterns = [
        (r"High\s+Bid\s+(?:USD\s+)?\$\s*([\d,]+)", "USD"),
        (r"High\s+Bid\s+EUR\s*€?\s*([\d,\.]+)", "EUR"),
        (r"High\s+Bid\s+GBP\s*£?\s*([\d,]+)", "GBP"),
        (r"Reserve\s+Not\s+Met.*?\$\s*([\d,]+)", "USD"),
    ]

    for pattern, currency in high_bid_patterns:
        m = re.search(pattern, html_content, re.IGNORECASE)
        if m:
            price_str = m.group(1).replace(",", "").replace(".", "")
            try:
                price = int(price_str)
                print(f"   ⚠️ Found: {currency} {price:,} (reserve not met)")
                return price, "no_sale", currency
            except ValueError:
                continue

    return None, None, None


def scrape_auction_price(auction_url: str):
    """
    Fetch a BaT page and extract final price.
    Returns (price, status, currency, error)
    """
    try:
        # Reduced delay - still polite but faster
        time.sleep(random.uniform(0.3, 0.8))

        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,de;q=0.8,fr;q=0.7",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        }

        print(f"   🌐 Fetching: {auction_url}")
        resp = requests.get(auction_url, headers=headers, timeout=15)

        if resp.status_code == 403:
            print("   ⚠️ 403 Forbidden - might be blocked")
            return None, None, None, "403 Forbidden"

        if resp.status_code == 404:
            print("   ⚠️ 404 Not Found - listing may be removed")
            return None, "withdrawn", None, None

        if resp.status_code != 200:
            print(f"   ⚠️ HTTP {resp.status_code}")
            return None, None, None, f"HTTP {resp.status_code}"

        price, status, currency = extract_price_from_html(resp.text)

        if status == "withdrawn":
            return None, "withdrawn", None, None

        if price and price > 0:
            return price, status, currency, None

        # Debug: show sample dollar amounts found
        dollar_matches = re.findall(r'[\$€£][\d,\.]+', resp.text)
        unique_amounts = list(set(dollar_matches))[:5]
        if unique_amounts:
            print(f"   ⚠️ Found amounts but couldn't parse: {unique_amounts}")
        else:
            print("   ❌ No price patterns found")

        return None, None, None, "No price found"

    except requests.exceptions.Timeout:
        return None, None, None, "Timeout"
    except Exception as e:
        return None, None, None, str(e)[:200]


# -------- SUPABASE I/O --------
def get_auctions_to_finalize():
    """
    Get auctions that have ended and still have final_price = NULL.
    Only fetches BaT listings (excludes manual auctions).
    """
    # 2 hours buffer after close
    cutoff_dt = datetime.now(timezone.utc) - timedelta(hours=2)
    cutoff_epoch = int(cutoff_dt.timestamp())

    # Don't process auctions older than 14 days (likely archived/changed)
    old_cutoff_dt = datetime.now(timezone.utc) - timedelta(days=14)
    old_cutoff_epoch = int(old_cutoff_dt.timestamp())

    url = f"{SUPABASE_URL}/rest/v1/auctions"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }

    params = {
        "select": "*",
        "final_price": "is.null",
        "timestamp_end": f"lt.{cutoff_epoch}",
        "limit": "100",
        "order": "timestamp_end.desc",  # Process most recent first
    }

    print("📡 Fetching auctions from Supabase...")
    print(f"   Cutoff: {cutoff_dt.isoformat()} ({cutoff_epoch})")

    r = requests.get(url, headers=headers, params=params, timeout=20)

    if r.status_code == 200:
        auctions = r.json()
        # Filter out manual auctions and non-BaT URLs
        bat_auctions = [
            a for a in auctions
            if a.get("url") and "bringatrailer.com" in a.get("url", "")
            and not a.get("auction_id", "").startswith("manual_")
        ]
        print(f"   Found {len(bat_auctions)} BaT auctions to process (filtered from {len(auctions)})")
        return bat_auctions

    print(f"   ❌ Error: {r.status_code} - {r.text[:200]}")
    return []


def update_auction_price(auction_id: str, final_price: int, currency: str = "USD") -> bool:
    """
    Update a single auction row with its final price.
    """
    url = f"{SUPABASE_URL}/rest/v1/auctions"
    params = {"auction_id": f"eq.{auction_id}"}
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    # Store price in USD equivalent (you could add currency conversion here)
    # For now, we store the raw price with a note about currency
    data = {"final_price": final_price}

    try:
        resp = requests.patch(url, headers=headers, params=params, json=data, timeout=20)
        if resp.status_code in (200, 204):
            print(f"   ✅ Updated {auction_id}: {currency} ${final_price:,}")
            return True
        print(f"   ❌ Update failed: {resp.status_code} - {resp.text}")
        return False
    except Exception as e:
        print(f"   ❌ Update error: {str(e)}")
        return False


def mark_auction_withdrawn(auction_id: str) -> bool:
    """
    Mark an auction as withdrawn by setting final_price to 0.
    This prevents it from being retried.
    """
    url = f"{SUPABASE_URL}/rest/v1/auctions"
    params = {"auction_id": f"eq.{auction_id}"}
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    # Using 0 as a marker for withdrawn
    data = {"final_price": 0}

    try:
        resp = requests.patch(url, headers=headers, params=params, json=data, timeout=20)
        if resp.status_code in (200, 204):
            print(f"   🚫 Marked as withdrawn: {auction_id}")
            return True
        return False
    except Exception as e:
        print(f"   ❌ Error marking withdrawn: {str(e)}")
        return False


def update_high_bid(auction_id: str, high_bid: int) -> bool:
    """
    Update the current_bid for a reserve-not-met auction.
    Leave final_price as NULL so the 25% penalty is applied in scoring.
    """
    url = f"{SUPABASE_URL}/rest/v1/auctions"
    params = {"auction_id": f"eq.{auction_id}"}
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    data = {"current_bid": high_bid}

    try:
        resp = requests.patch(url, headers=headers, params=params, json=data, timeout=20)
        if resp.status_code in (200, 204):
            print(f"   ⚠️ Updated high bid: ${high_bid:,} (reserve not met)")
            return True
        return False
    except Exception as e:
        print(f"   ❌ Error updating high bid: {str(e)}")
        return False


# -------- LAMBDA HANDLER --------
def lambda_handler(event, context):
    print("=" * 60)
    print("🚀 BaT Auction Finalizer v2.0 - Multi-Currency Support")
    print(f"🕐 Time: {datetime.utcnow().isoformat()}")
    print("=" * 60)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Missing SUPABASE_URL or SUPABASE_KEY")
        return {"statusCode": 500, "body": json.dumps({"error": "Missing env vars"})}

    auctions = get_auctions_to_finalize()
    if not auctions:
        print("📭 No auctions to process")
        return {"statusCode": 200, "body": json.dumps({"message": "No auctions", "processed": 0})}

    stats = {
        "success": 0,
        "no_sale": 0,
        "withdrawn": 0,
        "failed": 0,
    }
    errors = []

    for i, auction in enumerate(auctions, 1):
        auction_id = auction.get("auction_id")
        auction_url = auction.get("url")
        title = (auction.get("title") or "Unknown")[:60]

        print(f"\n[{i}/{len(auctions)}] {title}")
        print(f"   ID: {auction_id}")

        if not auction_url:
            print("   ❌ No URL")
            stats["failed"] += 1
            errors.append(f"{title}: No URL")
            continue

        price, status, currency, err = scrape_auction_price(auction_url)

        if status == "withdrawn":
            mark_auction_withdrawn(auction_id)
            stats["withdrawn"] += 1
        elif status == "sold" and price and price > 0:
            if update_auction_price(auction_id, price, currency or "USD"):
                stats["success"] += 1
            else:
                stats["failed"] += 1
                errors.append(f"{title}: DB update failed")
        elif status == "no_sale" and price:
            # Reserve not met - update current_bid with high bid
            # Leave final_price NULL so 25% penalty applies in scoring
            update_high_bid(auction_id, price)
            stats["no_sale"] += 1
        else:
            stats["failed"] += 1
            errors.append(f"{title}: {err or 'Unknown'}")

    # Summary
    total = sum(stats.values())
    success_rate = round(stats["success"] / total * 100, 1) if total else 0

    print("\n" + "=" * 60)
    print("📊 SUMMARY")
    print(f"   ✅ Sold (updated):    {stats['success']}")
    print(f"   🚫 Withdrawn:         {stats['withdrawn']}")
    print(f"   ⚠️  Reserve not met:  {stats['no_sale']}")
    print(f"   ❌ Failed:            {stats['failed']}")
    print(f"   📈 Success rate:      {success_rate}%")

    if errors[:5]:
        print("\n🔍 Sample errors:")
        for e in errors[:5]:
            print(f"   - {e}")
    print("=" * 60)

    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": "Complete",
            "processed": total,
            "stats": stats,
            "success_rate": success_rate,
            "errors": errors[:10],
        }),
    }


# Local testing
if __name__ == "__main__":
    # Test the parser with various formats
    test_cases = [
        '<span>Sold for <strong>USD $28,055</strong></span>',
        '<span>Bid to EUR €120,000 on 6/30/25</span>',
        '<span>Sold for GBP £45,000</span>',
        '<span>High Bid $15,000 (Reserve Not Met)</span>',
        '<span>Sold for CAD $35,000</span>',
        '<span>Bid to CHF 89\'000</span>',
    ]

    print("Testing parser patterns:")
    for html in test_cases:
        price, status, currency = extract_price_from_html(html)
        print(f"  {html[:50]}... -> {currency} {price} ({status})")

    # Uncomment to run full handler:
    # print(json.dumps(lambda_handler({}, None), indent=2))
