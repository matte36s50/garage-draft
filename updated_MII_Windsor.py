# mii_pipeline_robust.py
# ---------------------------------------------------------------
# Market Interest Index (MII) pipeline with:
# - Variant splitting (model_family + generation -> variant_id)
# - Era cohorts
# - Winsorizing per quarter + cohort (2.5/97.5)
# - Robust z-scores (median/MAD) with ±4 cap
# - Weights aligned to report (IG slightly reduced)
# - Min-support/base-floor for % change charts
# - Optional EMA smoothing and S3 upload
# ---------------------------------------------------------------

import os
import re
import datetime
import pandas as pd
import numpy as np

# Optional S3 support
try:
    import boto3
    from botocore.exceptions import NoCredentialsError
    HAS_BOTO = True
except Exception:
    HAS_BOTO = False

# --------------------------- CONFIG ----------------------------
WINSOR_LO = 0.025
WINSOR_HI = 0.975
Z_CAP = 4.0
EMA_ALPHA = 0.7

# % change stability rules
MIN_SUPPORT_PER_QUARTER = 3        # if you track per-variant auction counts
BASE_FLOOR_FOR_PCT = 8.0           # avoid huge % from tiny base
SMALL_BASE_CAP = 200.0             # cap % change when base < 12 (tune as needed)

# Output
OUTPUT_PREFIX = "mii_results"
S3_BUCKET = "my-mii-reports"       # change or disable S3 upload below

# ------------------------- UTILITIES ---------------------------
def upload_to_s3(file_name, bucket, object_name=None):
    if not HAS_BOTO:
        print("⚠️  boto3 not installed; skipping S3 upload.")
        return False
    s3 = boto3.client('s3')
    if object_name is None:
        object_name = os.path.basename(file_name)
    try:
        s3.upload_file(file_name, bucket, object_name)
        print(f"✅ Uploaded: s3://{bucket}/{object_name}")
        return True
    except NoCredentialsError:
        print("❌ AWS credentials not available")
        return False
    except Exception as e:
        print(f"❌ Upload failed: {e}")
        return False

def extract_proper_model(model_text, make_text=None):
    if not model_text or pd.isna(model_text):
        return None
    model_str = str(model_text).strip()
    original_model = model_str

    # Strip leading year
    model_str = re.sub(r'^\d{4}\s+', '', model_str)

    common_makes = ['Mercedes-Benz', 'Mercedes', 'BMW', 'Porsche', 'Audi', 'Ferrari',
                    'Lamborghini', 'McLaren', 'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Tesla',
                    'Toyota', 'Honda', 'Nissan', 'Lexus', 'Acura', 'Infiniti', 'Jaguar',
                    'Land Rover', 'Range Rover', 'Alfa Romeo', 'Maserati', 'Bentley',
                    'Rolls-Royce', 'Aston Martin', 'Lotus', 'Bugatti']
    common_makes.sort(key=len, reverse=True)
    for mk in common_makes:
        pattern = rf'^{re.escape(mk)}[\s-]+'
        model_str = re.sub(pattern, '', model_str, flags=re.IGNORECASE)

    model_str = re.sub(r'\s*\(\d{4}-\d{4}\)\s*$', '', model_str)
    model_str = re.sub(r'\s+', ' ', model_str).strip()

    if model_str.upper() == 'AMG':
        amg_match = re.search(r'([A-Z]+\d+[A-Z]*)\s*AMG', original_model, re.IGNORECASE)
        if amg_match:
            return f"{amg_match.group(1)} AMG"
        amg_model_match = re.search(r'AMG\s+([A-Z0-9]+(?:\s+[A-Z0-9]+)?)', original_model, re.IGNORECASE)
        if amg_model_match:
            return f"AMG {amg_model_match.group(1)}"
        return None

    return model_str if model_str else None

def clean_sale_amount(sale_text):
    if not sale_text or pd.isna(sale_text):
        return None
    sale_str = str(sale_text).replace('$', '').replace(',', '').strip()
    if '.' in sale_str:
        parts = sale_str.split('.')
        if len(parts) == 2:
            sale_str = parts[0]
    match = re.search(r'\d+', sale_str)
    if not match:
        return None
    amount = int(match.group(0))

    # Heuristic for "000" issues in scraped data
    if amount > 500000:
        last_three = amount % 1000
        if last_three in [9, 10, 11, 12]:
            amount = amount // 100

    if amount < 100 or amount > 10_000_000:
        return None
    return amount

def validate_quarter(quarter_str):
    if not quarter_str or quarter_str == 'NaT':
        return False
    try:
        year = int(quarter_str[:4])
        qnum = int(quarter_str[-1])
        now = datetime.datetime.now()
        cyear = now.year
        cquart = (now.month - 1) // 3 + 1
        if year > cyear: return False
        if year == cyear and qnum > cquart: return False
        if year < 1990: return False
        return True
    except:
        return False

def extract_year_from_row(row):
    if 'year' in row and pd.notna(row['year']):
        try:
            y = int(row['year'])
            if 1900 <= y <= datetime.datetime.now().year + 2:
                return y
        except: pass
    if 'model_original' in row and pd.notna(row['model_original']):
        matches = re.findall(r'\b(19|20)\d{2}\b', str(row['model_original']))
        if matches:
            y = int(matches[0])
            if 1900 <= y <= datetime.datetime.now().year + 2:
                return y
    return None

def era_cohort(year):
    if pd.isna(year): return 'Unknown'
    y = int(year)
    if y < 1970:         return 'Pre-1970'
    if 1970 <= y < 2000: return '1970–1999'
    if 2000 <= y < 2015: return '2000–2014'
    return '2015+'

def get_instagram_estimates(all_keys):
    # Lightweight, calibrated baseline approach
    # Map by key (variant_id if available; otherwise model)
    known = {
        "bmw": 650000, "m3": 280000, "e30": 18000, "e36": 15000, "e46": 42000,
        "2002": 12000, "z8": 4500, "m5": 140000, "m4": 35000, "z4": 22000,
        "mercedes": 480000, "190e": 18000, "c63": 85000, "c63 amg": 85000,
        "e63": 65000, "e63 amg": 65000, "s63": 55000, "s63 amg": 55000,
        "amg gt": 75000, "g63": 95000, "g63 amg": 95000, "sl63": 42000,
        "g-class": 55000, "sl": 18000, "cls63": 35000, "e55": 28000,
        "c55": 22000, "sl65": 18000, "sl55": 15000, "clk63": 22000,
        "porsche": 450000, "911": 150000, "turbo": 45000, "gt3": 65000,
        "boxster": 28000, "cayman": 32000, "gt2": 42000, "carrera": 85000,
        "ferrari": 320000, "lamborghini": 280000, "mclaren": 85000,
        "aventador": 75000, "huracan": 85000,
        "toyota": 180000, "supra": 55000, "nissan": 120000, "gtr": 38000,
        "gt-r": 38000, "honda": 160000, "s2000": 35000, "nsx": 22000,
        "ford": 180000, "mustang": 85000, "chevrolet": 150000, "corvette": 95000,
    }
    out = {}
    for key in all_keys:
        s = str(key).lower()
        val = 8000
        for k in sorted(known.keys(), key=len, reverse=True):
            if k in s:
                val = max(val, int(known[k] * 0.3))
                break
        if val == 8000:
            if any(b in s for b in ['bmw','mercedes','porsche','ferrari','lamborghini','mclaren']):
                val = 20000
            elif any(b in s for b in ['toyota','honda','nissan']):
                val = 12000
        out[key] = val
    return out

# --------------------- LOADING / CLEANING ----------------------
def load_scraped_data():
    """Try to load combined auction data from S3 (bat.csv, cnb.csv) with local fallbacks."""
    all_data = []
    if HAS_BOTO:
        s3 = boto3.client('s3')
    # Bring a Trailer
    try:
        if HAS_BOTO:
            s3.download_file(S3_BUCKET, 'bat.csv', 'temp_bat.csv')
            df_bat = pd.read_csv('temp_bat.csv')
            os.remove('temp_bat.csv')
        else:
            df_bat = pd.read_csv('bat.csv')
        df_bat['data_source'] = 'BAT'
        if 'model' not in df_bat.columns and 'title' in df_bat.columns:
            df_bat['model'] = df_bat['title']
        all_data.append(df_bat)
        print(f"✅ Loaded {len(df_bat)} BAT records")
    except Exception as e:
        print(f"⚠️ Could not load BAT: {e}")

    # Cars & Bids
    try:
        if HAS_BOTO:
            s3.download_file(S3_BUCKET, 'cnb.csv', 'temp_cnb.csv')
            df_cnb = pd.read_csv('temp_cnb.csv')
            os.remove('temp_cnb.csv')
        else:
            df_cnb = pd.read_csv('cnb.csv')
        df_cnb['data_source'] = 'CNB'
        all_data.append(df_cnb)
        print(f"✅ Loaded {len(df_cnb)} CNB records")
    except Exception as e:
        print(f"⚠️ Could not load CNB: {e}")

    if not all_data:
        print("❌ No scraped data found!")
        return pd.DataFrame()

    return pd.concat(all_data, ignore_index=True, sort=False)

def clean_and_process_data(df):
    df = df.copy()
    # Ensure required columns
    for col in ['model','views','bids','data_source']:
        if col not in df.columns:
            df[col] = 0 if col in ['views','bids'] else 'Unknown'

    # Normalize model text
    df['model_original'] = df['model']
    df['model'] = df.apply(lambda r: extract_proper_model(r['model'], r.get('make')), axis=1)
    df = df[df['model'].notna() & (df['model'] != '')]

    # Numeric transforms
    def extract_num(val):
        if pd.isna(val): return 0
        if isinstance(val, (int, float)): return int(val)
        m = re.findall(r'\d+', str(val).replace(',', ''))
        return int(m[0]) if m else 0

    df['views_numeric'] = df['views'].apply(extract_num)
    df['bids_numeric'] = df['bids'].apply(extract_num)
    if 'comments' in df.columns:
        df['comments_numeric'] = df['comments'].apply(extract_num)
    else:
        df['comments_numeric'] = 0

    if 'sale_amount' in df.columns:
        df['sale_amount_numeric'] = df['sale_amount'].apply(clean_sale_amount)
    else:
        df['sale_amount_numeric'] = 0

    # Assign quarter from available dates
    def assign_quarter(row):
        for field in ['scraped_date','sale_date','end_date']:
            if field in row and pd.notna(row[field]):
                dt = pd.to_datetime(row[field], errors='coerce')
                if pd.notna(dt) and dt <= pd.Timestamp.now():
                    q = f"{dt.year}Q{dt.quarter}"
                    if validate_quarter(q): return q
        # fallback: current
        now = pd.Timestamp.now()
        return f"{now.year}Q{((now.month-1)//3)+1}"

    df['quarter'] = df.apply(assign_quarter, axis=1)
    df = df[df['quarter'].apply(validate_quarter)]

    # Year / age / cohort
    df['year'] = df.apply(extract_year_from_row, axis=1)
    df['car_age'] = pd.Timestamp.now().year - pd.Series(df['year']).fillna(pd.Timestamp.now().year)
    df['cohort'] = df['year'].apply(era_cohort)

    # Variant splitting
    def get_model_family(model: str) -> str:
        m = str(model).upper()
        if 'SL63' in m: return 'SL63'
        if 'C63'  in m: return 'C63'
        if 'E63'  in m: return 'E63'
        if 'AMG GT' in m: return 'AMG GT'
        return m

    def get_generation(row) -> str:
        make = str(row.get('make',''))
        fam  = get_model_family(row.get('model',''))
        yr   = row.get('year', None)
        if pd.isna(yr): return 'GEN_UNKNOWN'
        yr = int(yr)
        if make.startswith('Mercedes') and fam == 'SL63':
            if 2012 <= yr <= 2019: return 'R231'
            if yr >= 2022:         return 'R232'
            return 'GEN_OTHER'
        return 'GEN_OTHER'

    df['model_family'] = df['model'].apply(get_model_family)
    df['generation']   = df.apply(get_generation, axis=1)
    df['variant_id']   = (df.get('make','').astype(str) + ' ' 
                          + df['model_family'].astype(str) + ' '
                          + df['generation'].astype(str)).str.strip()

    # Basic CNB <50 views filter (optional)
    if 'data_source' in df.columns:
        mask_cnb_low = (df['data_source'] == 'CNB') & (df['views_numeric'] < 50)
        df = df[~mask_cnb_low]

    print(f"✅ Cleaned: {len(df)} rows, {df['model'].nunique()} unique models")
    return df

# ----------------- WINSORIZING / ROBUST Z ---------------------
def winsorize_series(s: pd.Series, lower=WINSOR_LO, upper=WINSOR_HI) -> pd.Series:
    if s.empty:
        return s
    lo = s.quantile(lower)
    hi = s.quantile(upper)
    return s.clip(lower=lo, upper=hi)

def winsorize_by_groups(df: pd.DataFrame, group_cols, metric_cols, lower=WINSOR_LO, upper=WINSOR_HI):
    df = df.copy()
    for m in metric_cols:
        df[m] = df.groupby(group_cols, group_keys=False)[m].apply(
            lambda x: winsorize_series(x, lower, upper)
        )
    return df

def robust_z(series: pd.Series) -> pd.Series:
    if series.empty: 
        return series
    med = series.median()
    mad = (series - med).abs().median()
    if mad == 0:
        std = series.std()
        return (series - series.mean()) / (std if std else 1)
    z = (series - med) / mad
    return z

# --------------------- CORE CALCULATION -----------------------
def calculate_mii_scores(df):
    print("\n🧮 Calculating MII scores (winsorized + robust z)…")
    df = df.copy()

    # Key to use for Instagram and grouping
    entity_col = 'variant_id' if 'variant_id' in df.columns else 'model'

    # Instagram estimates keyed by entity (variant if available)
    all_keys = df[entity_col].unique()
    ig_map = get_instagram_estimates(all_keys)
    df['instagram_mentions'] = df[entity_col].map(ig_map).fillna(8000)

    # Aggregate
    group_cols = [entity_col, 'quarter']
    if 'make' in df.columns:   group_cols.insert(0, 'make')
    if 'cohort' in df.columns: group_cols.append('cohort')

    agg_dict = {
        'views_numeric': 'mean',
        'bids_numeric': 'mean',
        'comments_numeric': 'mean',
        'sale_amount_numeric': lambda x: x[x > 0].mean() if (x > 0).any() else 0,
        'data_source': 'count',
        'year': 'first',
        'car_age': 'first',
        'instagram_mentions': 'first'
    }
    grouped = df.groupby(group_cols).agg(agg_dict).reset_index()
    grouped = grouped.rename(columns={'data_source': 'total_auctions'})

    # Winsorize per quarter (+ cohort if present)
    metrics_to_clip = [
        'views_numeric', 'bids_numeric', 'comments_numeric',
        'sale_amount_numeric', 'instagram_mentions'
    ]
    group_for_clip = ['quarter'] + (['cohort'] if 'cohort' in grouped.columns else [])
    grouped = winsorize_by_groups(grouped, group_for_clip, metrics_to_clip, WINSOR_LO, WINSOR_HI)

    # Robust z by quarter (+ cohort)
    def apply_robust_z(g):
        for m in metrics_to_clip + ['total_auctions', 'car_age']:
            zcol = f'z_{m}'
            g[zcol] = robust_z(g[m]) if m in g.columns else 0
            g[zcol] = g[zcol].clip(-Z_CAP, Z_CAP)
        return g
    grouped = grouped.groupby(group_for_clip, group_keys=False).apply(apply_robust_z)

    # Weights (aligned to report; IG slightly reduced)
    weights = {
        'z_bids_numeric':          0.235,
        'z_sale_amount_numeric':   0.206,
        'z_views_numeric':         0.176,
        'z_total_auctions':        0.118,
        'z_instagram_mentions':    0.100,  # slight reduction from 0.118
        'z_comments_numeric':      0.088,
        'z_car_age':               0.059,
    }
    total_w = sum(weights.values())
    grouped['MII_Score'] = 0.0
    for col, w in weights.items():
        grouped['MII_Score'] += grouped.get(col, 0) * w
    grouped['MII_Score'] /= total_w

    # Scale to index (0-100) within quarter
    def to_index(g):
        mx, mn = g['MII_Score'].max(), g['MII_Score'].min()
        g['MII_Index'] = 100 * (g['MII_Score'] - mn) / (mx - mn) if mx > mn else 50
        return g
    grouped = grouped.groupby('quarter', group_keys=False).apply(to_index)

    # Ranks, momentum, smoothing
    grouped['Quarter_Rank'] = grouped.groupby('quarter')['MII_Index'].rank(ascending=False, method='min')
    grouped = grouped.sort_values([entity_col, 'quarter'])
    grouped['MII_Momentum'] = grouped.groupby(entity_col)['MII_Index'].diff()
    grouped['MII_Smoothed'] = grouped.groupby(entity_col)['MII_Index'].transform(lambda s: s.ewm(alpha=EMA_ALPHA, adjust=False).mean())

    grouped['calculation_date'] = pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')
    grouped = grouped.sort_values(['quarter', 'MII_Index'], ascending=[False, False])

    print(f"✅ Calculated MII for {len(grouped)} rows (entity={entity_col})")
    return grouped

# --------------- % CHANGE (Q2 → Q3) with RULES ----------------
def percent_change_table(mii_results, raw_df, q2_key=('2025Q2','Q2_2025'), q3_key=('2025Q3','Q3_2025')):
    entity_col = 'variant_id' if 'variant_id' in mii_results.columns else 'model'
    q2 = mii_results[mii_results['quarter'].isin(q2_key)].copy()
    q3 = mii_results[mii_results['quarter'].isin(q3_key)].copy()

    merged = pd.merge(
        q2[[entity_col, 'MII_Index']].rename(columns={'MII_Index':'MII_Q2'}),
        q3[[entity_col, 'MII_Index']].rename(columns={'MII_Index':'MII_Q3'}),
        on=entity_col, how='inner'
    )

    # Base floor
    merged = merged[merged['MII_Q2'] >= BASE_FLOOR_FOR_PCT].copy()
    merged['Pct_Change'] = 100 * (merged['MII_Q3'] - merged['MII_Q2']) / merged['MII_Q2']

    # Optional cap for small bases
    merged.loc[merged['MII_Q2'] < 12, 'Pct_Change'] = merged.loc[merged['MII_Q2'] < 12, 'Pct_Change'].clip(upper=SMALL_BASE_CAP)

    # If you track per-entity auction counts by quarter, filter here on MIN_SUPPORT_PER_QUARTER

    # Add make for filtering (merge back from raw df keys)
    key_map = raw_df[[entity_col, 'make']].drop_duplicates()
    merged = merged.merge(key_map, on=entity_col, how='left')
    return merged

# ----------------------------- MAIN ---------------------------
def main():
    print("🚀 MII Calculator (Robust)")
    print(f"⏰ Started at: {datetime.datetime.now():%Y-%m-%d %H:%M:%S}")

    # 1) Load raw auctions
    raw = load_scraped_data()
    if raw.empty:
        print("❌ No data to process.")
        return False

    # 2) Clean/process
    clean = clean_and_process_data(raw)
    if clean.empty:
        print("❌ No clean data.")
        return False

    # 3) Scores
    mii = calculate_mii_scores(clean)

    # 4) Insights: % change table example (Mercedes only)
    pct = percent_change_table(mii, clean)
    pct_mercedes = pct[pct['make'].str.contains('Mercedes', case=False, na=False)].sort_values('Pct_Change', ascending=False)
    print("\n🔺 Top Mercedes % Change (Q2→Q3) — after rules")
    print(pct_mercedes.head(15)[['make', mii.columns[0] if mii.columns[0] in ['variant_id','model'] else 'variant_id', 'MII_Q2', 'MII_Q3', 'Pct_Change']])

    # 5) Save
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M')
    out_csv = f"{OUTPUT_PREFIX}_{ts}.csv"
    latest_csv = f"{OUTPUT_PREFIX}_latest.csv"
    mii.to_csv(out_csv, index=False)
    mii.to_csv(latest_csv, index=False)
    print(f"💾 Saved: {out_csv} and {latest_csv}")

    # 6) Optional S3 upload
    if S3_BUCKET:
        upload_to_s3(out_csv, S3_BUCKET, os.path.basename(out_csv))
        upload_to_s3(latest_csv, S3_BUCKET, os.path.basename(latest_csv))

    print("\n🎉 Done.")
    return True

if __name__ == "__main__":
    main()
