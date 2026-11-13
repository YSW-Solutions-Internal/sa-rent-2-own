/**
 * Runs before `npm run dev` (the `predev` npm script): checks that .env.local points at a live
 * Supabase preview branch database, never at prod, and says what to do when it doesn't.
 * See CONTRIBUTING.md.
 */

// Keep in sync with scripts/guard-prod.mjs and src/lib/supabase/env.ts.
const PROD_PROJECT_REF = "srxleeenohgazegtyujb";

const FIX =
  "`npm run dev` switches .env.local to your git branch's preview database by itself when it can.\n" +
  "To switch by hand: `npm run env:preview` (CONTRIBUTING.md).";

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

/**
 * What `npm run dev` runs first: checks the Supabase target (`check`, i.e. checkDevEnv) and, when
 * it is blocked, switches .env.local to the current git branch's preview database (`point`, i.e.
 * pointEnvAtPreview) and checks again. A working setup is never rewritten, so a deliberate choice
 * of another branch's database survives. Returns { level, message } like checkDevEnv.
 */
export async function ensureDevEnv({ env, check, point }) {
  const first = await check(env);
  if (first.level !== "block") return first;

  let pointed;
  try {
    pointed = await point();
  } catch (error) {
    return { level: "block", message: `${first.message}\n\nSwitching automatically failed: ${error.message}` };
  }

  const second = await check({ url: pointed.url, anonKey: pointed.anonKey });
  const switched = `.env.local now points at this branch's preview database (${pointed.projectRef}).`;
  return { level: second.level, message: second.message ? `${switched}\n${second.message}` : switched };
}
