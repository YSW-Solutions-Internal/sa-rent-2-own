/**
 * Points .env.local at the Supabase preview branch database for a git branch.
 *
 * Usage:
 *   npm run env:preview              (uses the git branch you are on)
 *   npm run env:preview -- feat/x    (a named git branch)
 *
 * Needs SUPABASE_ACCESS_TOKEN, either in .env.local or in your shell: a Supabase personal access
 * token scoped to the prod project with Development Branches: Read, API Keys: Read and
 * API Key Secrets: Read. It rewrites only the three Supabase values in .env.local and leaves
 * everything else in the file alone. See CONTRIBUTING.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { upsertEnv } from "./env-file.mjs";

// Prod's project ref: preview branches are looked up under it. Keep in sync with
// scripts/guard-prod.mjs and src/lib/supabase/env.ts.
const PROD_PROJECT_REF = "srxleeenohgazegtyujb";
const API = "https://api.supabase.com/v1";
const ENV_FILE = ".env.local";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  fail(
    `Missing SUPABASE_ACCESS_TOKEN. Add it to ${ENV_FILE}: a Supabase personal access token with\n` +
      "Development Branches: Read, API Keys: Read and API Key Secrets: Read (see CONTRIBUTING.md)."
  );
}

async function api(path) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? " The token is expired, or is missing a permission listed at the top of this script."
        : "";
    fail(`Supabase API ${path} failed: ${response.status} ${response.statusText}.${hint}`);
  }
  return response.json();
}

const gitBranch =
  process.argv[2] ?? execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();

const branches = await api(`/projects/${PROD_PROJECT_REF}/branches`);
const branch = branches.find((b) => b.git_branch === gitBranch && !b.is_default);
if (!branch) {
  fail(
    `No Supabase preview branch found for git branch "${gitBranch}".\n` +
      "Push the branch (or open a draft PR) and wait for it under Supabase → Branches, then run this again."
  );
}
if (branch.project_ref === PROD_PROJECT_REF) {
  fail("Refusing: the branch found is the prod project.");
}

const keys = await api(`/projects/${branch.project_ref}/api-keys?reveal=true`);
const pick = (legacyName, type) =>
  (keys.find((k) => k.name === legacyName) ?? keys.find((k) => k.type === type))?.api_key;
const anonKey = pick("anon", "publishable");
const serviceRoleKey = pick("service_role", "secret");
if (!anonKey || !serviceRoleKey) {
  fail(`Could not read the API keys of preview branch ${branch.project_ref}. Does the token have API Key Secrets: Read?`);
}

const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
writeFileSync(
  ENV_FILE,
  upsertEnv(before, {
    NEXT_PUBLIC_SUPABASE_URL: `https://${branch.project_ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  })
);

console.log(`${ENV_FILE} now points at preview branch "${gitBranch}" (${branch.project_ref}).`);
if (branch.status && !["MIGRATIONS_PASSED", "FUNCTIONS_DEPLOYED"].includes(branch.status)) {
  console.warn(`Note: the branch's status is ${branch.status}; it may not be ready yet.`);
}
console.log("Restart `npm run dev` to pick up the change.");
