/**
 * Points .env.local at the Supabase preview branch database for a git branch.
 * `npm run dev` does this by itself when .env.local is wrong or stale; run this to switch on
 * purpose, e.g. to another branch's database.
 *
 * Usage:
 *   npm run env:preview              (uses the git branch you are on)
 *   npm run env:preview -- feat/x    (a named git branch)
 *
 * Needs SUPABASE_ACCESS_TOKEN in .env.local or your shell: see scripts/point-env-at-preview.mjs.
 */
import { currentGitBranch, pointEnvAtPreview } from "./point-env-at-preview.mjs";

const gitBranch = process.argv[2] ?? currentGitBranch();

try {
  const { projectRef, status } = await pointEnvAtPreview({ token: process.env.SUPABASE_ACCESS_TOKEN, gitBranch });
  console.log(`.env.local now points at preview branch "${gitBranch}" (${projectRef}).`);
  if (status && !["MIGRATIONS_PASSED", "FUNCTIONS_DEPLOYED"].includes(status)) {
    console.warn(`Note: the branch's status is ${status}; it may not be ready yet.`);
  }
  console.log("Restart `npm run dev` to pick up the change.");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
