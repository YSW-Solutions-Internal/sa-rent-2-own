# Per-PR preview databases, schema goes up, data comes down

There is no `staging` branch or staging Supabase project. Each pull request gets an ephemeral Supabase Branch (wired to its Vercel preview) that is deleted on merge, and merging to `main` is the release: the Supabase GitHub integration applies `supabase/migrations/` to prod. Schema only ever moves up, as migration files — no data is ever copied into prod, and prod is never changed by pasting SQL into the dashboard. Data only ever moves down: when a PR opens, a Refresh job copies prod's data into the branch database and masks it (client contact details and ID numbers replaced, banking details deleted, WhatsApp queue emptied), so previews behave like prod without exposing client data or messaging real clients.

## Considered Options

- **Second Supabase project + `staging` git branch** (one fixed staging URL). Rejected: about the same cost as always-on staging, but adds a long-lived branch that drifts from `main` and has to be reset after each release. Reconsider if the client needs a stable URL to sign off on before release.
- **Persistent Supabase Branch as staging.** Same cost as a second project, and less isolated from prod.

## Consequences

- Preview databases are built from migrations, so any change made on prod outside a migration file will be missing from previews and may conflict with later migrations.
- Previews send WhatsApp through the Twilio Sandbox (only phones that joined it can receive), share prod's Anthropic key (so preview AI usage counts toward prod's spend), and have no SMS provider. They get a preview-only banking encryption key, so prod banking details are deleted rather than copied. Staff log in with their normal phone and password.
