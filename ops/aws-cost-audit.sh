#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Read-only AWS audit for the Bid Prix account.
#
# Answers one question: what is actually running, and is anything using it?
# Makes ONLY describe/list/get calls. It creates nothing and deletes nothing.
#
#   ./ops/aws-cost-audit.sh                # sweep every enabled region
#   ./ops/aws-cost-audit.sh us-east-1      # sweep just one region (faster)
#
# Requires: awscli v2, credentials with ReadOnlyAccess.
# ---------------------------------------------------------------------------
set -uo pipefail

# AWS CLI v2 (CloudShell's default) pipes long output through `less`, which
# stalls an unattended sweep on the first metric listing tall enough to page.
export AWS_PAGER=""

command -v aws >/dev/null || { echo "aws CLI not found. brew install awscli"; exit 1; }

LOOKBACK_DAYS=30
START=$(date -u -d "${LOOKBACK_DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
     || date -u -v-${LOOKBACK_DAYS}d +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)

hr() { printf '\n%s\n' "------------------------------------------------------------"; }
sec() { hr; echo "$1"; hr; }

sec "WHO AM I"
aws sts get-caller-identity --output table || { echo "Credentials are not working."; exit 1; }

if [ $# -ge 1 ]; then
  REGIONS="$*"
else
  echo "Discovering enabled regions..."
  REGIONS=$(aws ec2 describe-regions --query 'Regions[].RegionName' --output text 2>/dev/null)
  [ -z "$REGIONS" ] && REGIONS="us-east-1 us-east-2 us-west-1 us-west-2 eu-west-1 eu-central-1"
fi
echo "Sweeping: $REGIONS"

for R in $REGIONS; do
  FOUND=""

  DBS=$(aws rds describe-db-instances --region "$R" \
        --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceClass,Engine,DBInstanceStatus,MultiAZ,AllocatedStorage,PubliclyAccessible,InstanceCreateTime]' \
        --output text 2>/dev/null)

  CLUSTERS=$(aws rds describe-db-clusters --region "$R" \
        --query 'DBClusters[].[DBClusterIdentifier,Engine,Status,EngineMode]' \
        --output text 2>/dev/null)

  # Elastic IPs. An EIP with no AssociationId is idle and billed at $0.005/hr.
  EIPS=$(aws ec2 describe-addresses --region "$R" \
        --query 'Addresses[].[PublicIp,AssociationId,InstanceId,NetworkInterfaceId]' \
        --output text 2>/dev/null)

  EC2=$(aws ec2 describe-instances --region "$R" \
        --filters Name=instance-state-name,Values=running,stopped \
        --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,PublicIpAddress]' \
        --output text 2>/dev/null)

  SNAPS=$(aws rds describe-db-snapshots --region "$R" --snapshot-type manual \
        --query 'DBSnapshots[].[DBSnapshotIdentifier,AllocatedStorage,SnapshotCreateTime]' \
        --output text 2>/dev/null)

  [ -n "$DBS$CLUSTERS$EIPS$EC2$SNAPS" ] && FOUND=yes
  [ -z "$FOUND" ] && continue

  sec "REGION: $R"

  if [ -n "$DBS" ]; then
    echo ">> RDS INSTANCES  (id / class / engine / status / multiAZ / GB / public / created)"
    echo "$DBS"
    echo
    # The decisive metric: has anything connected to this database recently?
    while read -r ID _REST; do
      [ -z "$ID" ] && continue
      echo "   -- DatabaseConnections for '$ID', last ${LOOKBACK_DAYS}d (daily max) --"
      aws cloudwatch get-metric-statistics --region "$R" \
        --namespace AWS/RDS --metric-name DatabaseConnections \
        --dimensions Name=DBInstanceIdentifier,Value="$ID" \
        --start-time "$START" --end-time "$END" \
        --period 86400 --statistics Maximum \
        --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Maximum]' \
        --output text 2>/dev/null || echo "   (no datapoints)"
      echo
    done <<< "$DBS"
  fi

  [ -n "$CLUSTERS" ] && { echo ">> RDS/AURORA CLUSTERS"; echo "$CLUSTERS"; echo; }
  [ -n "$SNAPS" ]    && { echo ">> MANUAL SNAPSHOTS (id / GB / created) - these bill after the DB is gone"; echo "$SNAPS"; echo; }
  [ -n "$EC2" ]      && { echo ">> EC2 INSTANCES (id / type / state / publicIP)"; echo "$EC2"; echo; }

  if [ -n "$EIPS" ]; then
    echo ">> ELASTIC IPs (ip / associationId / instanceId / eniId)"
    echo "$EIPS"
    echo "   NOTE: rows showing 'None' for associationId are IDLE and billed \$3.60-\$3.72/mo."
    echo
  fi
done

sec "DONE"
cat <<'NOTE'
Read the DatabaseConnections output first. If every daily Maximum is 0.0 across
the whole window, nothing has opened a connection to that database in 30 days.

Nothing was modified by this script. Teardown steps are in ops/AWS_COST_AUDIT.md.
NOTE
