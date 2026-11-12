#!/usr/bin/env bash
# Copies prod's data into a PR's Supabase preview branch database, then masks it.
# Usage: scripts/preview-refresh.sh <git-branch> [--reset]
# Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROD_PROJECT_REF, PROD_DB_URL. Needs supabase CLI, jq,
# and pg_dump/psql 17+. Run by .github/workflows/preview-refresh.yml; see docs/adr/0001.
# Never prints connection strings.
set -euo pipefail

BRANCH="${1:?usage: preview-refresh.sh <git-branch> [--reset]}"
RESET="${2:-}"
: "${SUPABASE_PROD_PROJECT_REF:?}"
: "${PROD_DB_URL:?}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Wait for Supabase to finish creating the branch and running its migrations.
if [[ -n "${PREVIEW_REFRESH_TEST_REF:-}" ]]; then
  BRANCH_REF="$PREVIEW_REFRESH_TEST_REF" # test hook: exercises the guard without the API
else
  BRANCH_REF=""
  for _ in $(seq 1 45); do
    INFO="$(supabase branches list --project-ref "$SUPABASE_PROD_PROJECT_REF" -o json \
      | jq -c --arg b "$BRANCH" '[.[] | select(.git_branch == $b)][0] // empty')"
    STATUS=""
    [[ -n "$INFO" ]] && STATUS="$(jq -r '.status // empty' <<<"$INFO")"
    case "$STATUS" in
      MIGRATIONS_PASSED|FUNCTIONS_DEPLOYED)
        BRANCH_REF="$(jq -r '.project_ref' <<<"$INFO")"
        break ;;
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

BRANCH_DB_URL="$(supabase branches get "$BRANCH_REF" --project-ref "$SUPABASE_PROD_PROJECT_REF" -o env \
  | sed -n 's/^POSTGRES_URL_NON_POOLING="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
if [[ -z "$BRANCH_DB_URL" ]]; then
  echo "Could not read POSTGRES_URL_NON_POOLING for branch $BRANCH_REF" >&2
  exit 1
fi
if [[ "$BRANCH_DB_URL" == "$PROD_DB_URL" || "$BRANCH_DB_URL" == *"$SUPABASE_PROD_PROJECT_REF"* ]]; then
  echo "Refusing to refresh: target is prod" >&2
  exit 1
fi
echo "::add-mask::$BRANCH_DB_URL" 2>/dev/null || true

# 3. Optional reset: rebuild the branch schema from the current migration files.
if [[ "$RESET" == "--reset" ]]; then
  echo "Resetting branch $BRANCH_REF to the current migrations"
  supabase db reset --db-url "$BRANCH_DB_URL" --no-seed
fi

# 4. Dump prod data: public schema plus staff logins.
echo "Dumping prod data"
pg_dump "$PROD_DB_URL" --data-only --no-owner --no-privileges --schema=public -f "$WORK/public.sql"
pg_dump "$PROD_DB_URL" --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities -f "$WORK/auth.sql"

# 5. Load: clear the branch (rows inserted by migrations would clash), then load with
# triggers off so FK order, audit and upper-case triggers don't interfere.
echo "Loading into branch $BRANCH_REF"
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -q -1 \
  -c "delete from auth.identities; delete from auth.users;" \
  -c "do \$\$ declare t text; begin
        select string_agg(format('public.%I', tablename), ', ') into t from pg_tables where schemaname = 'public';
        if t is not null then execute 'truncate ' || t || ' cascade'; end if;
      end \$\$;" \
  -c "set session_replication_role = replica" \
  -f "$WORK/auth.sql" \
  -f "$WORK/public.sql" \
  -c "set session_replication_role = origin"

# 6. Mask, then prove it.
echo "Masking"
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/preview/mask.sql
psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/preview/verify-mask.sql
echo "Preview branch $BRANCH refreshed and masked"
