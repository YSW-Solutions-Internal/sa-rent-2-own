// `predev` npm script: see scripts/dev-check.mjs.
import { checkDevEnv } from "./dev-check.mjs";

const { level, message } = await checkDevEnv({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (level === "block") {
  console.error(`\n${message}\n`);
  process.exit(1);
}
if (level === "warn") console.warn(`\n${message}\n`);
