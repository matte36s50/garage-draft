# AWS cost audit — the RDS line on the Bid Prix account

Account `BidPrix (056562103770)`. Written against the Cost Explorer breakdown for
**Mar–Aug 2026**, total spend **$68.77**.

## Bottom line

The account is paying roughly **$19.40/month (~$230/year)** for two resources, and
**no code in this repository refers to either of them.** Bid Prix runs entirely on
Supabase and Vercel. The one AWS Lambda in the repo talks to Supabase over HTTPS
REST and never opens a database socket.

| Line | Cost/mo | What it is | Referenced in this repo? |
|---|---|---|---|
| Relational Database Service | ~$15.69 | one small DB instance, running 24/7 | **no** |
| VPC | ~$3.72 | exactly one public IPv4 address | **no** |
| S3 | ~$0.02 | `updated_MII_Windsor.py` report uploads | yes — leave it alone |

## Evidence from the bill

The monthly VPC charge is not approximately a public IPv4 address, it is *exactly*
one, every month, to the cent:

```
Mar  31d x 24h x $0.005/hr = $3.72   billed $3.72
Apr  30d x 24h x $0.005/hr = $3.60   billed $3.60
May  31d x 24h x $0.005/hr = $3.72   billed $3.72
Jun  30d x 24h x $0.005/hr = $3.60   billed $3.60
```

Since Feb 2024 AWS bills every public IPv4 address at $0.005/hr, attached or not.
There are **no EC2 charges at all** on this account, so this address is not serving a
running instance. That points at an unassociated Elastic IP, or one parked on a
stopped instance or an orphaned network interface. It has been billing since before
March — it is the oldest thing on the account.

The RDS line reconstructs June exactly (`$15.26 + $3.60 + $0.01 = $18.87`), and the
daily burn rate is flat:

```
June     $0.5087/day  ($0.02119/hr)
Jul/Aug  $0.5061/day  ($0.02109/hr)
```

Two things follow from that flat rate:

- **The instance is running, not stopped.** A stopped RDS instance bills storage and
  backups only — about $2–3/month, not $15.69.
- **It is small and single-AZ.** ~$0.021/hr is consistent with a `db.t3.micro` or
  `db.t4g.micro` plus ~20 GB of gp2/gp3 storage. Multi-AZ would be roughly double.
  Aurora Serverless v2 at its 0.5-ACU floor would be ~$44/month, so it is not that.

**June is a full month at the same daily rate**, so billing began on or about June 1
rather than mid-month. That has two possible causes and they matter very differently:

1. The instance was **created around June 1** — three months of waste.
2. The account's **12-month Free Tier expired** around June 1 and a `micro` instance
   that had been running free since ~mid-2025 started billing. Free Tier usage shows
   as `$0.00` in Cost Explorer, so a database running the whole time would look
   exactly like this. That would mean **over a year of an unused database**.

`InstanceCreateTime` in the audit output settles which one it is.

## Evidence from the codebase

```
grep -rniE "rds\.amazonaws|amazonaws\.com|aurora|DATABASE_URL|POSTGRES_URL|psycopg|pg\.Pool|5432"
  --include=*.js --include=*.jsx --include=*.py --include=*.sql --include=*.md
  --exclude-dir=ops .
  -> no matches
```

- No `aws-sdk`, `pg`, `mysql`, or `boto3` dependency in either `package.json`.
- No Terraform / CloudFormation / CDK / SAM / Serverless config anywhere in the repo.
- `lambda/bat_scraper_finalize.py` reads `SUPABASE_URL` / `SUPABASE_KEY` and calls
  `{SUPABASE_URL}/rest/v1/auctions` over HTTPS. It needs no VPC and no RDS.
- The only AWS reference in the tree is `upload_to_s3()` in `updated_MII_Windsor.py`,
  which uses S3 and matches the $0.04 S3 line.
- Git history has never contained an RDS endpoint, a `DATABASE_URL`, or `boto3`
  beyond that S3 helper (`git log --all -S` finds nothing).

## What this audit does not prove

The repository is not the whole account. Before deleting anything, rule out:

- a second project, prototype, or notebook outside this repo pointing at the DB;
- a Vercel or cron-job.org environment variable holding an RDS endpoint —
  check the Vercel dashboard env vars for the `auction-admin` project;
- someone connecting by hand with a SQL client.

The `DatabaseConnections` metric in step 1 answers all three at once.

---

## Step 1 — audit (read-only, safe)

```bash
./ops/aws-cost-audit.sh          # every enabled region
./ops/aws-cost-audit.sh us-east-1
```

Needs credentials with `ReadOnlyAccess`. It only makes `describe`/`list`/`get` calls.
It reports RDS instances and clusters, their creation dates, manual snapshots, Elastic
IPs, EC2 instances, and — the decisive number — the daily maximum `DatabaseConnections`
for each database over the last 30 days.

## Step 2 — decide

| `DatabaseConnections` daily max, 30 days | Meaning | Do |
|---|---|---|
| `0.0` every single day | Nothing has connected in a month | Delete it (step 3) |
| Small non-zero, flat | Usually a monitoring agent or health check | Find the caller before deleting |
| Genuinely varying | Something real is using it | **Stop.** Identify it first |

Also note `InstanceCreateTime` — it tells you whether this is three months old or
predates the Free Tier expiry.

## Step 3 — tear down

Do these by hand after reading step 2. They are deliberately **not** in the script.

Note that **stopping an RDS instance is not a fix — AWS restarts it automatically
after 7 days**, and you keep paying storage in the meantime. Delete it or leave it.

```bash
# 3a. Take a final snapshot first. On a near-empty DB this costs cents,
#     and it is your undo button.
aws rds create-db-snapshot --region <REGION> \
  --db-instance-identifier <DB_ID> \
  --db-snapshot-identifier bidprix-final-$(date +%Y%m%d)

aws rds wait db-snapshot-available --region <REGION> \
  --db-snapshot-identifier bidprix-final-$(date +%Y%m%d)

# 3b. Turn off deletion protection if the delete is refused.
aws rds modify-db-instance --region <REGION> \
  --db-instance-identifier <DB_ID> --no-deletion-protection --apply-immediately

# 3c. Delete the instance (we already have the snapshot from 3a).
aws rds delete-db-instance --region <REGION> \
  --db-instance-identifier <DB_ID> --skip-final-snapshot

# 3d. Release the idle Elastic IP — the one whose AssociationId printed as 'None'.
aws ec2 release-address --region <REGION> --allocation-id <ALLOC_ID>
```

Then, separately:

- **Delete the subnet group and any custom parameter group** left behind. They are
  free but they keep the mess visible.
- **Diary the snapshot.** Manual snapshots bill at roughly $0.10/GB-month once the
  instance is gone. On a 20 GB near-empty DB that is pennies, but delete it in 30–60
  days once you are confident nothing broke:
  `aws rds delete-db-snapshot --db-snapshot-identifier bidprix-final-<date>`

## Step 4 — stop it happening again

Set a budget alert so the next orphan surfaces in week one rather than month three:

```bash
# $5/month with an email alert at 80% of forecast.
aws budgets create-budget --account-id 056562103770 \
  --budget '{"BudgetName":"bidprix-monthly","BudgetLimit":{"Amount":"5","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"FORECASTED","ComparisonOperator":"GREATER_THAN","Threshold":80,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"YOUR_EMAIL"}]}]'
```

Expected steady-state spend after cleanup: **a few cents a month** for the S3 reports.
