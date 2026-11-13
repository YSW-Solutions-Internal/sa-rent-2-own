<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Release flow and the database

Every change ships as a PR off a freshly fetched `main` (`git fetch` first); merging the PR is the release. Each PR gets a **preview**: its own Supabase branch database holding masked prod data, plus a Vercel preview URL. Before branching, writing a migration, editing `.env.local`, or running anything against a database, read [CONTRIBUTING.md](CONTRIBUTING.md); the reasons are in [docs/adr/0001-per-pr-preview-databases.md](docs/adr/0001-per-pr-preview-databases.md).

Prod's schema changes only through migration files: create one with `npx supabase migration new <name>`, and it reaches prod when its PR merges. Hard guardrail: never execute SQL against the prod database (no Supabase MCP `apply_migration`/`execute_sql` on the prod project, no dashboard SQL editor); run it against the PR's preview branch instead.
