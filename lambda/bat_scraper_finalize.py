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
        status: "sold", "no_sale", or None

    NOTE: We deliberately do NOT auto-detect "withdrawn" anymore. The previous
    regex was matching loose words like "removed" / "cancelled" / "ended early"
    in unrelated copy (comments, related-listing blurbs) and converting valid
    reserve-not-met auctions into final_price=0 withdrawns. Withdrawals are
    rare; an admin can mark them manually from the Finalize tab.
    """

    # Smallest believable car price/high bid. Anything below this is almost
    # certainly a stray match against unrelated page text (e.g. a "$10/month"
    # membership promo), so we reject it.
    MIN_PLAUSIBLE_PRICE = 100

    def clean_price(price_str, currency):
        if currency == "EUR" and "." in price_str and "," in price_str:
            price_str = price_str.replace(".", "").replace(",", ".")  # 120.000,00 -> 120000
        elif currency == "CHF" and "'" in price_str:
            price_str = price_str.replace("'", "")                    # 120'000 -> 120000
        else:
            price_str = price_str.replace(",", "")                    # 120,000 -> 120000
        if "." in price_str:
            price_str = price_str.split(".")[0]
        try:
            price = int(price_str)
        except ValueError:
            return None
        return price if price >= MIN_PLAUSIBLE_PRICE else None

    # SOLD signals only. NOTE: "Bid to X" is NOT a sale — it's BaT's label for
    # reserve-not-met, so it lives in high_bid_patterns below.
    sale_patterns = [
        (r"Sold\s+for\s+(?:USD\s+)?\$\s*([\d,]+)", "USD"),
        (r"Winning\s+bid\s+(?:of\s+)?(?:USD\s+)?\$\s*([\d,]+)", "USD"),
        (r"Sold\s+for\s+EUR\s*€?\s*([\d,\.]+)", "EUR"),
        (r"Winning\s+bid\s+(?:of\s+)?EUR\s*€?\s*([\d,\.]+)", "EUR"),
        (r"Sold\s+for\s+GBP\s*£?\s*([\d,]+)", "GBP"),
        (r"Winning\s+bid\s+(?:of\s+)?GBP\s*£?\s*([\d,]+)", "GBP"),
        (r"Sold\s+for\s+CAD\s*\$?\s*([\d,]+)", "CAD"),
        (r"Sold\s+for\s+AUD\s*\$?\s*([\d,]+)", "AUD"),
        (r"Sold\s+for\s+CHF\s*([\d,\']+)", "CHF"),
        (r"Sold\s+for\s+€\s*([\d,\.]+)", "EUR"),
        (r"Sold\s+for\s+£\s*([\d,]+)", "GBP"),
    ]

    # RESERVE-NOT-MET (no sale). "Bid to X" = high bid, reserve not met.
    high_bid_patterns = [
        (r"Bid\s+to\s+(?:USD\s+)?\$\s*([\d,]+)", "USD"),
        (r"Bid\s+to\s+EUR\s*€?\s*([\d,\.]+)", "EUR"),
        (r"Bid\s+to\s+GBP\s*£?\s*([\d,]+)", "GBP"),
        (r"Bid\s+to\s+CAD\s*\$?\s*([\d,]+)", "CAD"),
        (r"Bid\s+to\s+AUD\s*\$?\s*([\d,]+)", "AUD"),
        (r"Bid\s+to\s+CHF\s*([\d,\']+)", "CHF"),
        (r"Bid\s+to\s+€\s*([\d,\.]+)", "EUR"),
        (r"Bid\s+to\s+£\s*([\d,]+)", "GBP"),
        (r"High\s+Bid\s+(?:USD\s+)?\$\s*([\d,]+)", "USD"),
        (r"High\s+Bid\s+EUR\s*€?\s*([\d,\.]+)", "EUR"),
        (r"High\s+Bid\s+GBP\s*£?\s*([\d,]+)", "GBP"),
        # Bounded gap keeps this anchored to the bid next to the label rather
        # than leaping across the page to an unrelated amount (e.g. a "$10").
        (r"Reserve\s+Not\s+Met[^$]{0,40}\$\s*([\d,]+)", "USD"),
    ]

    def match_text(text):
        for pattern, currency in sale_patterns:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                price = clean_price(m.group(1), currency)
                if price:
                    print(f"   💰 Found: {currency} {price:,} (sold)")
                    return price, "sold", currency
        for pattern, currency in high_bid_patterns:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                price = clean_price(m.group(1), currency)
                if price:
                    print(f"   ⚠️ Found: {currency} {price:,} (reserve not met)")
                    return price, "no_sale", currency
        return None

    # Pass 1: raw HTML text.
    result = match_text(html_content)
    if result:
        return result

    # Pass 2: strip tags and retry. This must run BEFORE the bare <strong>
    # fallback: BaT wraps the result amount in a tag ("Bid to <strong>EUR
    # €7,000</strong>"), so only the stripped text reveals whether the amount
    # is a sale price or a reserve-not-met high bid.
    stripped = re.sub(r"\s{2,}", " ", re.sub(r"<[^>]+>", " ", html_content))
    result = match_text(stripped)
    if result:
        return result

    # Pass 3: bare <strong>-wrapped amount. Ambiguous on its own — the same
    # markup carries both sale prices and high bids — so check the text right
    # before the tag and only report "sold" when nothing marks it as a bid.
    strong_patterns = [
        (r"<strong>\s*(?:USD\s+)?\$\s*([\d,]+)\s*</strong>", "USD"),
        (r"<strong>\s*EUR\s*€?\s*([\d,\.]+)\s*</strong>", "EUR"),
        (r"<strong>\s*GBP\s*£?\s*([\d,]+)\s*</strong>", "GBP"),
    ]
    for pattern, currency in strong_patterns:
        m = re.search(pattern, html_content, re.IGNORECASE)
        if m:
            price = clean_price(m.group(1), currency)
            if not price:
                continue
            context = re.sub(r"<[^>]+>", " ", html_content[max(0, m.start() - 300):m.start()])
            context = re.sub(r"\s{2,}", " ", context)[-80:]
            if re.search(r"(?:bid\s+to|high\s+bid|current\s+bid|reserve\s+not\s+met)[\s:]*$", context, re.IGNORECASE):
                print(f"   ⚠️ Found: {currency} {price:,} (reserve not met, via <strong>)")
                return price, "no_sale", currency
            print(f"   💰 Found: {currency} {price:,} (sold, via <strong>)")
            return price, "sold", currency

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
            # Don't auto-mark as withdrawn — BaT returns 404 transiently for
            # valid listings (Cloudflare interstitials, geo blocks, slug edits).
            # Leave for retry; admin can manually mark withdrawn if needed.
            print("   ⚠️ 404 Not Found - will retry next run")
            return None, None, None, "404 Not Found"

        if resp.status_code != 200:
            print(f"   ⚠️ HTTP {resp.status_code}")
            return None, None, None, f"HTTP {resp.status_code}"

        price, status, currency = extract_price_from_html(resp.text)

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
        "reserve_not_met": "is.false",  # Skip confirmed reserve-not-met auctions
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


def mark_reserve_not_met(auction_id: str, high_bid: int | None) -> bool:
    """
    Flag a reserve-not-met auction: set reserve_not_met = true so the admin
    panel shows it (and the finalizer stops re-scraping it), record the high
    bid when we have one, and leave final_price NULL so the 25% penalty is
    applied in scoring.
    """
    url = f"{SUPABASE_URL}/rest/v1/auctions"
    params = {"auction_id": f"eq.{auction_id}"}
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    data = {"reserve_not_met": True}
    if high_bid:
        data["current_bid"] = high_bid

    try:
        resp = requests.patch(url, headers=headers, params=params, json=data, timeout=20)
        if resp.status_code in (200, 204):
            bid_note = f" — high bid ${high_bid:,}" if high_bid else ""
            print(f"   ⚠️ Marked reserve not met{bid_note}")
            return True
        return False
    except Exception as e:
        print(f"   ❌ Error marking reserve not met: {str(e)}")
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

        if status == "sold" and price and price > 0:
            if update_auction_price(auction_id, price, currency or "USD"):
                stats["success"] += 1
            else:
                stats["failed"] += 1
                errors.append(f"{title}: DB update failed")
        elif status == "no_sale":
            # Reserve not met - flag it (with the high bid when found).
            # Leave final_price NULL so 25% penalty applies in scoring
            mark_reserve_not_met(auction_id, price)
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
        # Regression: tag-wrapped amount next to "Bid to" must be no_sale, not
        # sold — this exact markup got a €7,000 RNM Beetle recorded as sold.
        '<span>Bid to <strong>EUR €7,000</strong> on 7/5/26</span>',
        '<span>Bid to <strong>USD $10,000</strong> on 7/5/26</span>',
    ]

    print("Testing parser patterns:")
    for html in test_cases:
        price, status, currency = extract_price_from_html(html)
        print(f"  {html[:50]}... -> {currency} {price} ({status})")

    # Uncomment to run full handler:
    # print(json.dumps(lambda_handler({}, None), indent=2))
