# Working on SA Rent 2 Own

Every change reaches production through a pull request. Each PR gets its own preview: a Supabase
branch database filled with masked prod data, and a Vercel preview URL. Merging to `main` is the
release. Why it works this way: [docs/adr/0001-per-pr-preview-databases.md](docs/adr/0001-per-pr-preview-databases.md).

## The flow

1. Branch off `main`: `git switch main && git pull && git switch -c feat/<name>` (or `fix/<name>`).
2. Push and open a **draft PR** straight away. Supabase creates your preview database, then the
   "Preview Refresh" action copies masked prod data into it. Vercel posts the preview URL on the PR.
3. Point your `.env.local` at your branch's database (Supabase dashboard → Branches → your
   branch → Connect), using `.env.example` as the template. **Never point localhost at prod.**
4. Build and test, locally and on the preview URL.
5. When CI is green, merge. Migrations run on prod and Vercel deploys. The branch and its preview
   database are deleted.

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
