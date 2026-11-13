// `predev` npm script: see scripts/dev-check.mjs.
import { checkDevEnv, ensureDevEnv } from "./dev-check.mjs";
import { currentGitBranch, pointEnvAtPreview } from "./point-env-at-preview.mjs";

const { level, message } = await ensureDevEnv({
  env: { url: process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  check: checkDevEnv,
  point: () => pointEnvAtPreview({ token: process.env.SUPABASE_ACCESS_TOKEN, gitBranch: currentGitBranch() }),
});

if (level === "block") {
  console.error(`\n${message}\n`);
  process.exit(1);
}
if (message) console[level === "warn" ? "warn" : "log"](`\n${message}\n`);
