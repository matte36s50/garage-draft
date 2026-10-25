/**
 * The User-Agent every fetch of a Bring a Trailer page sends (the finalize
 * cron and the make backfill; lambda/bat_scraper_finalize.py sends the same).
 * It says what is asking and where to find out more, rather than passing as a
 * browser. If BaT blocks it, those pages read as inconclusive and the auctions
 * can be finalized by hand from the admin panel.
 */
export const BOT_USER_AGENT = 'BidPrixBot/1.0 (+https://github.com/matte36s50/garage-draft)';
