import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { upsertEnv } from "./env-file.mjs";

// Prod's project ref: preview branches are looked up under it. Keep in sync with
// scripts/guard-prod.mjs, scripts/dev-check.mjs and src/lib/supabase/env.ts.
const PROD_PROJECT_REF = "srxleeenohgazegtyujb";
const API = "https://api.supabase.com/v1";
const ENV_FILE = ".env.local";

export function currentGitBranch() {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
}

/**
 * Rewrites the three Supabase values in .env.local to the preview branch database of
 * `gitBranch`, leaving every other line alone. Returns { url, anonKey, projectRef, status }.
 * Throws an Error whose message says what to do when it can't.
 *
 * `token` is a Supabase personal access token scoped to the prod project with
 * Development Branches: Read, API Keys: Read and API Key Secrets: Read (CONTRIBUTING.md).
 */
export async function pointEnvAtPreview({ token, gitBranch }) {
  if (!token) {
    throw new Error(
      `Missing SUPABASE_ACCESS_TOKEN. Add it to ${ENV_FILE}: a Supabase personal access token with\n` +
        "Development Branches: Read, API Keys: Read and API Key Secrets: Read (see CONTRIBUTING.md)."
    );
  }

  const api = async (path) => {
    const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403
          ? " Your SUPABASE_ACCESS_TOKEN has expired or is missing a permission: create a new one (CONTRIBUTING.md)."
          : "";
      throw new Error(`Supabase API ${path} failed: ${response.status} ${response.statusText}.${hint}`);
    }
    return response.json();
  };

  const branches = await api(`/projects/${PROD_PROJECT_REF}/branches`);
  const branch = branches.find((b) => b.git_branch === gitBranch && !b.is_default);
  if (!branch) {
    throw new Error(
      `No Supabase preview branch found for git branch "${gitBranch}".\n` +
        "Push the branch (or open a draft PR) and wait for it under Supabase → Branches, then try again."
    );
  }
  if (branch.project_ref === PROD_PROJECT_REF) {
    throw new Error("Refusing: the branch found is the prod project.");
  }

  const keys = await api(`/projects/${branch.project_ref}/api-keys?reveal=true`);
  const pick = (legacyName, type) =>
    (keys.find((k) => k.name === legacyName) ?? keys.find((k) => k.type === type))?.api_key;
  const anonKey = pick("anon", "publishable");
  const serviceRoleKey = pick("service_role", "secret");
  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      `Could not read the API keys of preview branch ${branch.project_ref}. Does the token have API Key Secrets: Read?`
    );
  }

  const url = `https://${branch.project_ref}.supabase.co`;
  const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  writeFileSync(
    ENV_FILE,
    upsertEnv(before, {
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    })
  );

  return { url, anonKey, projectRef: branch.project_ref, status: branch.status };
}
