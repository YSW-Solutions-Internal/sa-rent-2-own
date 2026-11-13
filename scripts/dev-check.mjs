/**
 * Runs before `npm run dev` (the `predev` npm script): checks that .env.local points at a live
 * Supabase preview branch database, never at prod, and says what to do when it doesn't.
 * See CONTRIBUTING.md.
 */

// Keep in sync with scripts/guard-prod.mjs and src/lib/supabase/env.ts.
const PROD_PROJECT_REF = "srxleeenohgazegtyujb";

const FIX =
  "Run `npm run env:preview` on your feature branch to point .env.local at its preview database.\n" +
  "If that fails with 401, your SUPABASE_ACCESS_TOKEN has expired: create a new one (CONTRIBUTING.md).";

/**
 * Returns { level: "ok" | "warn" | "block", message }. "block" stops `npm run dev`; "warn" lets
 * it start, for cases this check can't judge (offline, a branch still starting up).
 */
export async function checkDevEnv({ url, anonKey, fetchImpl = fetch }) {
  if (!url || !anonKey) {
    return { level: "block", message: `.env.local has no Supabase URL or anon key.\n${FIX}` };
  }
  if (url.includes(PROD_PROJECT_REF)) {
    return { level: "block", message: `.env.local points at the PROD database. Local development must use a preview.\n${FIX}` };
  }

  const attempt = (target, headers) => fetchImpl(target, { headers, signal: AbortSignal.timeout(5000) });

  let response;
  try {
    response = await attempt(`${url}/auth/v1/health`, { apikey: anonKey });
  } catch {
    // Deleted preview databases stop resolving. Tell that apart from having no internet.
    const online = await attempt("https://api.supabase.com/v1/health", {}).then(
      () => true,
      () => false
    );
    return online
      ? {
          level: "block",
          message: `The preview database in .env.local no longer exists (its PR was probably merged).\n${FIX}`,
        }
      : { level: "warn", message: "Could not reach Supabase to check .env.local (offline?). Starting anyway." };
  }

  if (response.ok) return { level: "ok", message: "" };
  if (response.status === 401 || response.status === 403) {
    return { level: "block", message: `The preview database rejected the keys in .env.local.\n${FIX}` };
  }
  return {
    level: "warn",
    message: `The preview database answered ${response.status}; it may still be starting up. Starting anyway.`,
  };
}
