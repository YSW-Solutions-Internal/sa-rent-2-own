-- NO-OP ON PROD: prod already has these grants, because it was created when Supabase gave the
-- API roles (anon, authenticated, service_role) access to everything in `public` automatically.
-- New Supabase databases, including every preview branch, no longer do that: tables created by
-- the migrations above come out with no grants at all there, so a logged-in user cannot even read
-- their own `profiles` row and the app redirects in a loop. Recorded here so preview branches,
-- which are built from migrations, match prod.
-- Access is still decided by row level security on every table, exactly as on prod; a grant only
-- lets a role reach the table so that its policies can be evaluated.
-- Functions are deliberately left alone: several are revoked from anon/authenticated on purpose.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- The same for tables and sequences that later migrations create.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
