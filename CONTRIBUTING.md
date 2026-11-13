# Working on SA Rent 2 Own

Every change reaches production through a pull request. Each PR gets its own preview: a Supabase
branch database filled with masked prod data, and a Vercel preview URL. Merging to `main` is the
release. Why it works this way: [docs/adr/0001-per-pr-preview-databases.md](docs/adr/0001-per-pr-preview-databases.md).

## The flow

1. Branch off `main`: `git switch main && git pull && git switch -c feat/<name>` (or `fix/<name>`).
2. Push and open a **draft PR** straight away. Supabase creates your preview database, then the
   "Preview Refresh" action copies masked prod data into it. Vercel posts the preview URL on the PR.
3. Point your `.env.local` at your branch's database (Supabase dashboard → Branches → your
   branch → Connect), using `.env.example` as the template. **Never point localhost at prod:**
   `npm run dev` and the `scripts/*.mjs` scripts refuse to run against it. A script you really
   mean to run on prod needs `ALLOW_PROD=1` for that one run.
4. Build and test, locally and on the preview URL.
5. When CI is green, merge. Migrations run on prod and Vercel deploys. The branch and its preview
   database are deleted.

### Testing before opening a PR

Pushing a new branch makes Supabase create its preview database (schema only, no data). Load
masked prod data with **Actions → Preview Refresh → Run workflow** and your branch name, then
point `.env.local` at the branch. If no branch appears under Supabase → Branches, open a draft PR
or create it there with **Create branch**. A branch database costs about $0.32/day until the git
branch is merged or deleted, so delete abandoned branches.

## Database changes

- Only through migration files: `npx supabase migration new <name>`, then write the SQL in the
  new file. **Never paste SQL into the prod dashboard.** Prod changes only by merging.
- Pushing runs your new migrations on your preview database. If one is wrong, editing the file
  won't re-run it: fix the file, push, then run **Actions → Preview Refresh → Run workflow** with
  your branch name. That rebuilds your preview database from the migrations and reloads the data.
- If `main` gets a newer migration than yours before you merge, update your branch from `main`
  and re-create your migration with `supabase migration new` so it sorts after the other one.
  CI fails if two migration files share a timestamp.

## Previews

- Client contact details, ID numbers and addresses are fake; bank details are empty. Staff logins
  are real, so log in with your normal phone and password.
- WhatsApp goes through the Twilio Sandbox, which only delivers to phones that joined it. To
  test incoming messages, set the sandbox's "When a message comes in" to
  `https://<preview-url>/api/whatsapp` in the Twilio console.
- Vehicle invoice files aren't copied, so invoice links in previews don't open.

## GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | What it is |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token, scoped to the prod project, permission **Infrastructure and delivery → Development Branches: Read** only. |
| `SUPABASE_PROD_PROJECT_REF` | Prod's project ID (from its dashboard URL). |
| `PROD_DB_URL` | Prod's **Session pooler** connection string, password included. |

**`SUPABASE_ACCESS_TOKEN` expires one year after it was created.** Check the date under Supabase →
your avatar → Account preferences → Access Tokens, and keep a calendar reminder. When it expires,
Preview Refresh fails with an authentication error (401). To renew: generate a new token with the
same scope and permission, replace the secret's value, delete the old token, and re-run the
failed Preview Refresh. If the token may have leaked, delete it in Supabase straight away: it can
read the password of every preview database, and those hold real staff logins and business data.

If prod's database password is ever reset, update `PROD_DB_URL` too, or Preview Refresh and the
Schema drift check fail.
