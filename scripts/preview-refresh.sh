#!/usr/bin/env bash
# Copies prod's data into a PR's Supabase preview branch database, then masks it.
# Usage: scripts/preview-refresh.sh <git-branch> [--reset]
# Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROD_PROJECT_REF, PROD_DB_URL. Needs curl, jq, supabase CLI,
# and pg_dump/psql 17+. Run by .github/workflows/preview-refresh.yml; see docs/adr/0001.
# Never prints connection strings.
set -euo pipefail

BRANCH="${1:?usage: preview-refresh.sh <git-branch> [--reset]}"
RESET="${2:-}"
: "${SUPABASE_PROD_PROJECT_REF:?}"
: "${PROD_DB_URL:?}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Supabase Management API. The token only needs "Development Branches: Read".
API="https://api.supabase.com/v1"
api() {
  local out status
  out="$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "$API$1")"
  status="${out##*$'\n'}"
  if [[ "$status" != 2* ]]; then
    echo "Supabase API GET $1 failed: HTTP $status: ${out%$'\n'*}" >&2
    case "$status" in
      401) echo "SUPABASE_ACCESS_TOKEN is invalid or expired (CONTRIBUTING.md, GitHub secrets)." >&2 ;;
      403) echo "SUPABASE_ACCESS_TOKEN lacks Development Branches: Read." >&2 ;;
      404) echo "Supabase does not know this project or branch for this token: check that the token is scoped to the prod project." >&2 ;;
    esac
    return 1
  fi
  printf '%s' "${out%$'\n'*}"
}

# 1. Wait for Supabase to finish creating the branch and running its migrations.
if [[ -n "${PREVIEW_REFRESH_TEST_REF:-}" ]]; then
  BRANCH_REF="$PREVIEW_REFRESH_TEST_REF" # test hook: exercises the guard without the API
else
  : "${SUPABASE_ACCESS_TOKEN:?}"
  if [[ ! "$SUPABASE_PROD_PROJECT_REF" =~ ^[a-z]{20}$ ]]; then
    echo "The SUPABASE_PROD_PROJECT_REF secret must be only the 20 lowercase letters of prod's project ID (not the dashboard URL, no spaces or line breaks)." >&2
    exit 1
  fi
  BRANCH_REF=""
  for _ in $(seq 1 45); do
    INFO="$(api "/projects/$SUPABASE_PROD_PROJECT_REF/branches" \
      | jq -c --arg b "$BRANCH" '
          # Closing and reopening a PR can leave the old branch database (scheduled for
          # deletion) next to the new one: take the newest that is not being deleted.
          [.[] | select(.git_branch == $b and .deletion_scheduled_at == null)]
          | sort_by(.created_at) | last // empty')"
    STATUS=""; HEALTH=""
    if [[ -n "$INFO" ]]; then
      STATUS="$(jq -r '.status // empty' <<<"$INFO")"
      HEALTH="$(jq -r '.preview_project_status // empty' <<<"$INFO")"
    fi
    case "$STATUS" in
      MIGRATIONS_PASSED|FUNCTIONS_DEPLOYED)
        if [[ "$HEALTH" == "ACTIVE_HEALTHY" || -z "$HEALTH" ]]; then
          BRANCH_REF="$(jq -r '.project_ref' <<<"$INFO")"
          break
        fi ;;
      MIGRATIONS_FAILED|FUNCTIONS_FAILED)
        echo "Supabase preview branch for $BRANCH failed ($STATUS). Check the Supabase check on the PR." >&2
        exit 1 ;;
    esac
    sleep 20
  done
  if [[ -z "$BRANCH_REF" ]]; then
    echo "Supabase preview branch for $BRANCH not ready after 15 min. Check the Supabase check on the PR." >&2
    exit 1
  fi
fi

# 2. Guard: this script truncates every table in the target. It must never be prod.
if [[ "$BRANCH_REF" == "$SUPABASE_PROD_PROJECT_REF" ]]; then
  echo "Refusing to refresh: target is prod" >&2
  exit 1
fi

# Branch connection: through a session pooler (the direct db.<ref> host is IPv6-only, which GitHub
# runners can't reach), with the branch's own user and password from the API. Branches live in
# prod's region but not always on prod's pooler cluster (aws-0-… vs aws-1-…), and a new branch
# takes a moment to be registered with its pooler, so try both clusters until one accepts.
POOLER_HOST="$(sed -n 's|^postgres\(ql\)\{0,1\}://.*@\([^/@]*pooler\.supabase\.com:[0-9]*\)/.*$|\2|p' <<<"$PROD_DB_URL")"
if [[ -z "$POOLER_HOST" ]]; then
  echo "PROD_DB_URL must be prod's Session pooler connection string (…@…pooler.supabase.com:5432/postgres)" >&2
  exit 1
fi
case "$POOLER_HOST" in
  aws-0-*) OTHER_POOLER_HOST="aws-1-${POOLER_HOST#aws-0-}" ;;
  aws-1-*) OTHER_POOLER_HOST="aws-0-${POOLER_HOST#aws-1-}" ;;
  *) OTHER_POOLER_HOST="" ;;
esac
CONFIG="$(api "/branches/$BRANCH_REF")"
DB_PASS="$(jq -r '.db_pass // empty | @uri' <<<"$CONFIG")"
if [[ -z "$DB_PASS" ]]; then
  echo "Supabase API returned no database password for branch $BRANCH_REF" >&2
  exit 1
fi
echo "::add-mask::$DB_PASS"

BRANCH_DB_URL=""
for _ in $(seq 1 15); do
  for host in "$POOLER_HOST" $OTHER_POOLER_HOST; do
    candidate="postgresql://postgres.$BRANCH_REF:$DB_PASS@$host/postgres"
    if LAST_ERROR="$(psql "$candidate" -tA -c "select 1" 2>&1 >/dev/null)"; then
      BRANCH_DB_URL="$candidate"
      echo "Connected to branch $BRANCH_REF through $host"
      break 2
    fi
  done
  sleep 20
done
if [[ -z "$BRANCH_DB_URL" ]]; then
  echo "Could not connect to branch $BRANCH_REF through $POOLER_HOST ${OTHER_POOLER_HOST:+or $OTHER_POOLER_HOST }after 5 min. Last error:" >&2
  echo "$LAST_ERROR" >&2
  exit 1
fi

# 3. The schema must be in place before loading data. With --reset, rebuild it from this
# checkout's migration files. Otherwise wait until Supabase has applied every one of them: the
# API's branch status can say "passed" on a database whose migrations are still running.
EXPECTED_MIGRATIONS="$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l)"
if [[ "$RESET" == "--reset" ]]; then
  echo "Resetting branch $BRANCH_REF to the current migrations"
  supabase db reset --db-url "$BRANCH_DB_URL" --no-seed
else
  APPLIED=0
  for _ in $(seq 1 45); do
    APPLIED="$(psql "$BRANCH_DB_URL" -tA -c "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || echo 0)"
    [[ "$APPLIED" -ge "$EXPECTED_MIGRATIONS" ]] && break
    sleep 20
  done
  if [[ "$APPLIED" -lt "$EXPECTED_MIGRATIONS" ]]; then
    echo "Branch $BRANCH_REF has $APPLIED of $EXPECTED_MIGRATIONS migrations applied after 15 min." >&2
    echo "A migration probably failed on it: check the Supabase check on the PR, fix the migration, then run Preview Refresh by hand (it resets the branch)." >&2
    exit 1
  fi
  echo "Branch $BRANCH_REF has all $EXPECTED_MIGRATIONS migrations applied"
fi

# 4. Dump prod data: public schema plus staff logins.
echo "Dumping prod data"
pg_dump "$PROD_DB_URL" --data-only --no-owner --no-privileges --schema=public -f "$WORK/public.sql"
pg_dump "$PROD_DB_URL" --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities -f "$WORK/auth.sql"

# 5. Clear, load, mask and verify in ONE transaction (psql -1): it commits only if
# verify-mask.sql passes, so unmasked prod data is never visible in the preview, and any error
# or cancellation rolls the whole refresh back. The branch is cleared first because rows
# inserted by migrations would clash; the load runs with triggers off so FK order, audit and
# upper-case triggers don't interfere, and masking runs with them back on.
echo "Loading, masking and verifying in one transaction on branch $BRANCH_REF"
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -q -1 \
  -c "delete from auth.identities; delete from auth.users;" \
  -c "do \$\$ declare t text; begin
        select string_agg(format('public.%I', tablename), ', ') into t from pg_tables where schemaname = 'public';
        if t is not null then execute 'truncate ' || t || ' cascade'; end if;
      end \$\$;" \
  -c "set session_replication_role = replica" \
  -f "$WORK/auth.sql" \
  -f "$WORK/public.sql" \
  -c "set session_replication_role = origin" \
  -c "do \$\$ begin
        if not exists (select 1 from public.clients) or not exists (select 1 from public.vehicles) then
          raise exception 'refresh loaded no clients or no vehicles: the prod dump was empty or did not load';
        end if;
      end \$\$;" \
  -f supabase/preview/mask.sql \
  -f supabase/preview/verify-mask.sql

echo "Preview branch $BRANCH ($BRANCH_REF) refreshed and masked. Rows now in it:"
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -tA -F ' ' -c "
  select 'clients', count(*) from public.clients
  union all select 'vehicles', count(*) from public.vehicles
  union all select 'contracts', count(*) from public.contracts
  union all select 'payment_transactions', count(*) from public.payment_transactions
  union all select 'staff logins', count(*) from auth.users"
