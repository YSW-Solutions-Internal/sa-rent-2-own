# Per-PR Preview Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every PR gets its own Supabase branch database loaded with masked prod data and its own Vercel preview. Merging to `main` releases to prod, with migrations applied automatically.

**Architecture:** The Supabase GitHub integration creates a preview branch database per PR from `supabase/migrations/` and applies migrations to prod on merge to `main`. The Supabase ↔ Vercel integration wires each preview deployment to its branch database. A GitHub Action ("Preview Refresh") copies prod's data into the branch database, then masks it. It runs when a PR opens and on a manual button; the manual run also resets the branch database first.

**Tech Stack:** Supabase (Pro org, Postgres 17, Branching), Supabase CLI, GitHub Actions, Vercel, Next.js 16.

**Spec:** `docs/adr/0001-per-pr-preview-databases.md`, plus the decisions listed below (agreed in the design session of 2026-11-12).

## Decisions (from the design session)

- No `staging` branch or staging project. Flow: `feat/x` or `fix/x` off `main` → draft PR → preview → merge = release.
- Team of two, both prod owners. `main` requires a PR and a passing `build` check; **no approval is required**. Branches are deleted automatically on merge. Merge methods are not restricted.
- Nobody pastes SQL into prod any more. Migrations are created only with `supabase migration new`, and CI fails on duplicate migration timestamps.
- Everyone's `.env.local` points at their own PR's preview branch database, never at prod.
- Refresh copies prod `public` data plus `auth.users` and `auth.identities` (staff log in with phone + password, `login/actions.ts:39`). It does not copy Storage files.
- Masking:
  - `clients.cell_number`, `alt_cell_number`, `email`, `id_number` and `address` are replaced with fake values.
  - `client_banking_details` is emptied.
  - `whatsapp_flows` and `whatsapp_messages` are emptied.
  - `audit_log` rows for `clients` and `client_banking_details` are deleted, because their `diff` holds the pre-mask values.
- The Preview environment gets:
  - the Twilio **WhatsApp Sandbox** as its sender (same Account SID and Auth Token as prod, sandbox "from" number, `WHATSAPP_WEBHOOK_URL` unset);
  - the **same Anthropic key as prod** (the user may switch it to a separate key later);
  - its own `BANKING_ENCRYPTION_KEY`.
  Staff profiles aren't masked, so the user's phone keeps its WhatsApp access in previews. To test incoming messages, point the sandbox's "When a message comes in" at `https://<preview-url>/api/whatsapp` by hand. `test_otp` (Q22) is deferred.

## Global Constraints

- Postgres major version 17 (`supabase/config.toml:41`). Any `pg_dump` or `psql` used must be version 17 or newer.
- Masked phone numbers use the form `+2700` followed by 7 digits. That passes `normalizeSaPhone` (`^\+27\d{9}$`) but no SA mobile number starts with 0 after the country code, so it reaches nobody.
- Masked emails end in `@example.invalid`.
- The prod database URL lives only in the GitHub secret `PROD_DB_URL`; the Supabase token lives in `SUPABASE_ACCESS_TOKEN`. Neither is ever echoed in logs.
- The Refresh workflow only ever writes to a **branch** database, and must refuse to run if the target's project ref equals the prod project ref.
- App environment variable names stay as they are: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/supabase/env.ts`) and `BANKING_ENCRYPTION_KEY` (`src/lib/crypto.ts:20`).

## Review Focus

1. **`config.toml` reaching prod.** If the GitHub integration deploys `supabase/config.toml` to prod, today's file would set prod's `site_url` to `http://127.0.0.1:3000` and turn off the Twilio SMS provider (lines 158 and 289). That breaks prod's account setup by SMS code. Task 1 must settle this before anything is connected.
2. **Refresh pointed at prod.** A wrong variable could make the "truncate then load" step wipe prod. Task 3's guard compares project refs and aborts; there's a dry test for it in Task 3.
3. **Masking silently not applied** (e.g. a new client column with PII added later, or the mask step erroring after the load step). `verify-mask.sql` runs as the last step and fails the workflow; Task 2 tests it against fixtures.
4. **Rows inserted by migrations clashing with the prod data load**, e.g. `status_migration_map` (`20260916092143_costs_insurance_sales.sql:62`). Load must truncate `public` tables first; Task 3's end-to-end check covers it.
5. **Refresh run before the branch database exists.** The workflow polls for the branch to be ready, with a timeout and a clear error message, instead of failing with a confusing connection error. Covered in Task 3.

---

### Task 1: Make prod ready for the GitHub integration (done together with the user; touches prod)

**Files:**
- Modify: `supabase/config.toml` (only if Step 2 finds config is deployed to prod)

- [ ] **Step 1: Compare prod's schema against the repo.**
  Run: `npx supabase link --project-ref <prod-ref>`, then `npx supabase db diff --linked --schema public,storage`.
  Expected: no differences, other than the effects of migrations that ran but aren't recorded. Any other difference becomes a new migration file that records it (in the style of `20261106130000_uppercase_text_fields.sql`), committed before Step 3.
- [ ] **Step 2: Find out whether the Supabase GitHub integration deploys `config.toml` to prod**, from Supabase's current Branching docs.
  - If it does: set `[auth] site_url` and `additional_redirect_urls` to prod's values, and configure `[auth.sms.twilio]` with `enabled = true` and secrets via `env(...)`, matching prod's dashboard. Get the user's confirmation of each value.
  - If it doesn't: no change.
  Write the finding into the ADR's Consequences section.
- [ ] **Step 3: Repair the history.**
  Run: `npx supabase migration repair --status applied 20261029110000 20261106130000 --linked`, then `npx supabase migration list --linked`.
  Expected: all 36 local migrations show as applied remotely, plus any added in Step 1.
- [ ] **Step 4: Commit** any `config.toml` or migration changes, and the ADR update: `chore: align repo with prod before enabling Supabase branching`.

---

### Task 2: Masking SQL and its check

**Files:**
- Create: `supabase/preview/mask.sql`
- Create: `supabase/preview/verify-mask.sql`
- Create: `supabase/preview/test-fixtures.sql`
- Modify: `.github/workflows/ci.yml` (add a job `mask-test`)

**Interfaces:**
- Produces: `mask.sql` is idempotent and runs in one transaction against a database with the repo schema. `verify-mask.sql` raises an exception (non-zero `psql -v ON_ERROR_STOP=1` exit) if any unmasked data remains. Task 3 runs both, in that order.

- [ ] **Step 1: Write `test-fixtures.sql`.** It inserts 2 clients with realistic SA data (`+27821234567`, `jane@gmail.com`, a 13-digit ID number, an address), one `client_banking_details` row, one `whatsapp_flows` row, one `whatsapp_messages` row, and one `audit_log` row with `table_name = 'clients'`.
- [ ] **Step 2: Write `verify-mask.sql`.** It raises an exception when any of these are true:
  - a `clients` row has `cell_number` or a non-null `alt_cell_number` not matching `^\+2700\d{7}$`
  - a non-null `email` doesn't end in `@example.invalid`
  - a non-null `id_number` doesn't match `^0{7}\d{6}$`
  - a non-null `address` doesn't start with `MASKED ADDRESS`
  - `client_banking_details`, `whatsapp_flows` or `whatsapp_messages` has any rows
  - `audit_log` has rows with `table_name in ('clients','client_banking_details')`
- [ ] **Step 3: Add CI job `mask-test`.** It uses `supabase/setup-cli@v1`, then runs `supabase db start` (applies migrations), loads the fixtures, and runs `verify-mask.sql` **expecting failure**. Then it runs `mask.sql` and `verify-mask.sql`, expecting success. Then it runs `mask.sql` a second time and `verify-mask.sql` again, which proves the mask can safely run twice.
- [ ] **Step 4: Push and confirm `mask-test` fails** at "mask.sql not found".
- [ ] **Step 5: Write `mask.sql`.**
  - Replace values using the client's position when ordered by `id`, so the result is the same every time: `cell_number = '+2700' || lpad(n::text, 7, '0')`; `alt_cell_number` likewise with an offset of 5000000 when non-null; `email = 'client-' || n || '@example.invalid'` when non-null; `id_number = '0000000' || lpad(n::text, 6, '0')` when non-null; `address = 'MASKED ADDRESS ' || n` when non-null.
  - Then delete from `client_banking_details`, `whatsapp_flows` and `whatsapp_messages`.
  - Delete `audit_log` rows for `clients` and `client_banking_details` **last**, because the mask updates themselves create new audit rows through the audit trigger.
- [ ] **Step 6: Push and confirm `mask-test` passes.**
- [ ] **Step 7: Commit**: `feat: preview data masking with CI test`.

---

### Task 3: Preview Refresh workflow

**Files:**
- Create: `.github/workflows/preview-refresh.yml`
- Create: `scripts/preview-refresh.sh`

**Interfaces:**
- Consumes: `supabase/preview/mask.sql` and `verify-mask.sql` (Task 2).
- Secrets: `SUPABASE_ACCESS_TOKEN`, `PROD_DB_URL`, `SUPABASE_PROD_PROJECT_REF`.
- `scripts/preview-refresh.sh <git-branch> [--reset]`

- [ ] **Step 1: Write the workflow.**
  - Triggers: `pull_request` with `types: [opened, reopened]`, plus `workflow_dispatch` with a required input `branch` (the PR's git branch name). The manual run passes `--reset`.
  - `concurrency: preview-refresh-${{ branch }}` with `cancel-in-progress: true`.
  - Installs `postgresql-client-17` from the PGDG apt repo and `supabase/setup-cli@v1`.
- [ ] **Step 2: Write `scripts/preview-refresh.sh`.** Uses `set -euo pipefail`; never prints connection strings. In order:
  1. **Wait for the branch:** poll `supabase branches get "$BRANCH" --project-ref "$SUPABASE_PROD_PROJECT_REF" -o json` every 20 seconds, for up to 15 minutes, until the branch status shows migrations have finished. On timeout, exit with: "Supabase preview branch for $BRANCH not ready after 15 min. Check the Supabase check on the PR."
  2. Read the branch's database URL and project ref from that output (exact field names to be confirmed against the CLI output).
  3. **Guard:** exit 1 with "Refusing to refresh: target is prod" if the branch ref equals `SUPABASE_PROD_PROJECT_REF`, or if the branch URL equals `PROD_DB_URL`.
  4. **Reset (only with `--reset`):** `supabase db reset --db-url "$BRANCH_DB_URL" --no-seed` (confirm the flag is supported; otherwise call the Management API's branch reset and poll again).
  5. **Dump prod:** `supabase db dump --db-url "$PROD_DB_URL" --data-only --use-copy --schema public -f public.sql`, and dump `auth.users` and `auth.identities` to `auth.sql` with `pg_dump --data-only --table=auth.users --table=auth.identities`.
  6. **Load:** in one `psql -v ON_ERROR_STOP=1` session on the branch:
     - `set session_replication_role = replica`
     - truncate every `public` table, plus `auth.identities` and `auth.users`, with `cascade`
     - load `auth.sql`, then `public.sql`
     - `set session_replication_role = origin`
  7. **Mask:** run `mask.sql`, then `verify-mask.sql`.
  8. Delete the dump files.
- [ ] **Step 3: Guard test.** Run the script locally with the branch-ref lookup stubbed to return the prod ref (env var `PREVIEW_REFRESH_TEST_REF`, read only when set).
  Expected: exits 1 with "Refusing to refresh: target is prod" before any `psql` call.
- [ ] **Step 4: Commit**: `feat: preview refresh workflow`. The end-to-end run happens in Task 4, once the integration exists.

---

### Task 4: Connect integrations and the Vercel Preview environment (dashboards, with the user)

- [ ] **Step 1: GitHub secrets.** Add `SUPABASE_ACCESS_TOKEN` (a personal access token from the Supabase dashboard), `PROD_DB_URL` (prod's session-pooler connection string) and `SUPABASE_PROD_PROJECT_REF`.
- [ ] **Step 2: Supabase dashboard → Project Settings → Integrations → GitHub.** Connect this repo, with production branch `main`, Supabase directory `supabase`, and automatic branching on for PRs.
- [ ] **Step 3: Supabase dashboard → Integrations → Vercel.** Connect the Vercel project and sync environment variables to preview branches.
  Confirm the variable names it sets match the three Supabase names in Global Constraints; if not, add aliases in Vercel.
- [ ] **Step 4: Vercel → Settings → Environment Variables, Preview scope only** (the user enters the secret values; never paste them in chat):
  - `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`: same values as prod.
  - `TWILIO_WHATSAPP_FROM`: the sandbox number, as `whatsapp:+<number>` from Twilio's sandbox page.
  - `WHATSAPP_WEBHOOK_URL`: **unset**, so signature checks use the preview's own URL (`route.ts:122`).
  - `ANTHROPIC_API_KEY`, `WHATSAPP_BOT_MODEL` and `WHATSAPP_PARSE_MODEL`: same as prod. These can simply have both Production and Preview ticked.
  - `BANKING_ENCRYPTION_KEY`: new, generated with `openssl rand -base64 32`.
  - Confirm `BANKING_ENCRYPTION_KEY`, `TWILIO_WHATSAPP_FROM` and `WHATSAPP_WEBHOOK_URL` are **not** sharing their Production values with Preview.
- [ ] **Step 5: End-to-end check, using the PR that contains Tasks 1–3.** Close and reopen the PR so `pull_request: reopened` fires.
  Expected:
  - a Supabase preview branch is created;
  - Preview Refresh succeeds;
  - the Vercel preview loads;
  - you can log in with your normal phone and password;
  - clients show `0 00…` style phone numbers;
  - bank details are empty;
  - prod is unchanged.
- [ ] **Step 5b: WhatsApp check.** Point the sandbox webhook at `https://<preview-url>/api/whatsapp`, then message the sandbox from the user's joined phone.
  Expected: the bot replies from the sandbox number, and the prod WhatsApp sender is untouched. Afterwards, point the webhook back or leave it; it only affects the sandbox.
- [ ] **Step 6: Manual Refresh.** Run "Preview Refresh" with this branch from the Actions tab.
  Expected: it succeeds and the data is reloaded.

---

### Task 5: Team guardrails and docs

**Files:**
- Modify: `.github/workflows/ci.yml` (add a step `Unique migration timestamps` to `build`)
- Create: `.env.example`
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Add the CI step.** It fails, listing the clashing versions, if `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` prints anything. Test it by temporarily copying a migration under an existing version, pushing, and seeing it fail; then remove the copy and see it pass.
- [ ] **Step 2: `.env.example`.** List every variable the app reads (`src/lib/supabase/env.ts`, `src/lib/crypto.ts`, `src/lib/otp.ts`, `src/lib/whatsapp/*`, `src/app/api/whatsapp/route.ts`), each with empty values. Add a header comment: "Point these at YOUR PR's Supabase preview branch (Supabase dashboard → Branches → your branch → Connect), never at prod."
- [ ] **Step 3: `CONTRIBUTING.md`.** Short sections covering:
  - the branch → draft PR → preview → merge flow;
  - `supabase migration new`, never pasting SQL into prod;
  - re-timestamping when `main` has a newer migration;
  - pressing Refresh after fixing a broken migration;
  - that the `scripts/*.mjs` that use `.env.local` will hit whatever database `.env.local` points at.
- [ ] **Step 4: Commit**: `chore: migration timestamp check, env template, contributing guide`. Merge the PR. This is the first release through the new flow, so check prod's migration list afterwards.
- [ ] **Step 5: Repo settings** (after merge):
  - `gh repo edit --delete-branch-on-merge`
  - `gh api -X PUT repos/{owner}/{repo}/branches/main/protection` with `required_status_checks: {strict: false, contexts: ["build"]}`, `required_pull_request_reviews: {required_approving_review_count: 0}`, `enforce_admins: false` and `restrictions: null`.
  Expected: a direct `git push origin main` is rejected.
