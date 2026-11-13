import { defineConfig } from "vitest/config";

// Unit tests for pure logic only (no React rendering, no Supabase) --
// Node environment, same @/* path alias as tsconfig.json (Vite 8's native
// tsconfig-paths resolution, no separate plugin needed).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
});
