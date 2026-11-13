// Prod's Supabase project ref (public: it is part of the app's Supabase URL). Preview branch
// databases each have their own ref, so everything that isn't this one is allowed.
// Keep in sync with scripts/guard-prod.mjs.
const PROD_PROJECT_REF = "srxleeenohgazegtyujb";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseUrl() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  // Local development must never touch prod (docs/adr/0001). Production builds, i.e. the live
  // site, are the only thing allowed to use it.
  if (process.env.NODE_ENV !== "production" && url.includes(PROD_PROJECT_REF)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL points at the PROD database. Point .env.local at your PR's Supabase preview branch instead; see CONTRIBUTING.md."
    );
  }
  return url;
}

export function getSupabaseAnonKey() {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function getSupabaseServiceRoleKey() {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}
