# SAR2O Fleet

Internal fleet management app for the SA Rent 2 Own rent-to-own vehicle fleet — replaces the OneDrive Excel workbook. **Live in production.** See [`SPEC.md`](./SPEC.md) for the full data model, tech stack, security design, current feature list, and open items this was built against.

## Stack

Next.js 16 (App Router) + Supabase (Postgres, Auth, RLS) + Tailwind CSS v4. Login is by cell phone number + password (no email required) via Supabase phone auth. Hosted on Vercel.

## Getting started (local dev)

### 1. Supabase project

Create a project at [supabase.com](https://supabase.com) (or run one locally with the Supabase CLI + Docker), then apply the schema:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This runs every migration in `supabase/migrations/` — all tables, enums, triggers, and Row Level Security policies described in `SPEC.md`.

In the Supabase dashboard, under **Authentication → Providers → Phone**, enable phone auth and configure Twilio (or another supported provider) as the SMS sender. (As of writing, the client's Twilio setup isn't fully live yet — see `SPEC.md` §5 for the interim workaround for creating accounts.)

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — same page. **Server-only, never commit this or expose it to the browser.**
- `BANKING_ENCRYPTION_KEY` — a 32-byte AES-256 key for encrypting client banking details, generated with `openssl rand -base64 32`. Losing this key makes existing encrypted banking rows unrecoverable, so store it in your secrets manager, not just `.env.local`.
- `OTP_CHANNEL` — `sms` or `whatsapp`; keep on `sms` until a WhatsApp Business sender is configured.

These same values (minus anything only needed locally) are set in Vercel's project settings for the deployed app — `NEXT_PUBLIC_*` as "Config" type (meant to reach the browser), the rest as "Secret".

### 3. Install and run

Requires Node.js 22+ (see `.nvmrc`/`package.json#engines` — `@supabase/supabase-js` drops support for older versions).

```bash
npm install
npm run dev
```

### 4. Create the first admin account

There's no public sign-up — every account is created by an admin from inside the app (**Staff** page, `/admin/users`). To bootstrap the very first admin before any account exists, create one directly via the Supabase dashboard (**Authentication → Users → Add user**), or via the Admin API directly if you need a password set immediately rather than going through the OTP setup flow:

```bash
curl -X POST 'https://<project-ref>.supabase.co/auth/v1/admin/users' \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+27821234567",
    "password": "SomeTempPassword123!",
    "phone_confirm": true,
    "user_metadata": { "full_name": "Your Name" },
    "app_metadata": { "role": "admin" }
  }'
```

`app_metadata.role` is picked up automatically by the `handle_new_auth_user` trigger, which creates the matching `profiles` row — it has to be `app_metadata`, not `user_metadata`: only this service-role-authenticated call can ever set `app_metadata`, while `user_metadata` can be set by the account's own owner, so the trigger only ever trusts the former for a privilege decision (see migration `20261113120000`). From there, that admin can add every other staff member from the **Staff** page.

## Deployment

Hosted on Vercel, auto-deploying from the `main` branch. Feature work happens on a separate branch; merging (or fast-forwarding) into `main` triggers a production deploy. See `SPEC.md` §8 for environment variable setup on the Vercel side.

## Project structure

- `supabase/migrations/` — the full schema, RLS policies, and helper functions, in the order they apply
- `src/app/(app)/` — the authenticated app shell and pages (Dashboard, Vehicles, Clients, Contracts, Staff)
- `src/app/login`, `src/app/setup-account` — phone/password login and the first-time setup / password-reset flow
- `src/components/app-shell/` — sidebar nav, collapsible app shell
- `src/components/dashboard/` — shared dashboard stat cards and the fleet-map placeholder, reused across the Dashboard/Vehicles/Contracts pages
- `src/components/ui/` — shared UI primitives (table, sheet panel, drag-and-drop column header, column visibility menu, etc.)
- `src/lib/supabase/` — Supabase client helpers (browser, server, admin, Proxy session refresh)
- `src/lib/crypto.ts` — AES-256-GCM encryption used for client banking details
- `src/lib/export-to-excel.ts` — the styled `.xlsx` export engine (exceljs-based) shared by all three list views
- `src/lib/database.types.ts` — hand-maintained TypeScript types matching the migrations; keep this in sync whenever a migration changes a table shape
- `scripts/import-current-fleet.mjs` — one-off script used to import the client's real fleet data; see `SPEC.md` §7 and §10
- `scripts/reload-fleet-data.mjs` — plans the full fleet data reload and the client exception report; `scripts/apply-client-corrections.mjs` — turns the client's returned answers into a guarded SQL patch (both only write files, never touch the database); see `SPEC.md` §11 item 22

## What's built vs. what's next

Vehicles, Clients, and Contracts are all complete CRUD modules (list/create/edit/delete, search/filter/sort, Excel export), plus a Dashboard and a Staff admin page. See `SPEC.md` §9 for the full current feature list and §11 for the prioritized list of what's still outstanding (Twilio SMS setup and the forgot-password flow it unblocks, an archive view for ended-contract vehicles, in-app role editing, field-locking pending a TBC trigger event, login phone-input UX polish, email notifications/reporting, WhatsApp OTP and a client-facing WhatsApp bot, full mobile support, and a few schema-only tables — insurance claims, sale listings, rental payment periods — with no UI yet).
