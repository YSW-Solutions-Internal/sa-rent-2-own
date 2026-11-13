// Imported first by every script that talks to Supabase: stops the script when .env.local points
// at the PROD database, unless ALLOW_PROD=1 is set for that one run. Scripts should normally run
// against your PR's preview branch database (CONTRIBUTING.md).
// Keep the ref in sync with src/lib/supabase/env.ts.
const PROD_PROJECT_REF = "srxleeenohgazegtyujb";

if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PROD_PROJECT_REF)) {
  if (process.env.ALLOW_PROD !== "1") {
    console.error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL points at the PROD database.\n" +
        "Point .env.local at your PR's Supabase preview branch (see CONTRIBUTING.md),\n" +
        "or, if you really mean to run this on prod, set ALLOW_PROD=1 for this one run."
    );
    process.exit(1);
  }
  console.warn("ALLOW_PROD=1: running against the PROD database.");
}
