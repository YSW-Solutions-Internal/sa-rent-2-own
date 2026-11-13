import { describe, expect, it } from "vitest";

import { checkDevEnv, ensureDevEnv } from "./dev-check.mjs";

const PROD_URL = "https://srxleeenohgazegtyujb.supabase.co";
const PREVIEW_URL = "https://abcdefghijklmnopqrst.supabase.co";

const respond = (status) => async () => ({ ok: status >= 200 && status < 300, status });
const unreachable = async () => {
  throw new TypeError("fetch failed");
};
// Preview host is gone, but the internet works.
const previewGone = async (url) => {
  if (url.startsWith(PREVIEW_URL)) throw new TypeError("fetch failed");
  return { ok: true, status: 200 };
};

describe("checkDevEnv", () => {
  it("passes for a live preview database", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: respond(200) });
    expect(result.level).toBe("ok");
  });

  it("blocks when the Supabase values are missing", async () => {
    const result = await checkDevEnv({ url: undefined, anonKey: undefined, fetchImpl: respond(200) });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/npm run env:preview/);
  });

  it("blocks prod without making any request", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return { ok: true, status: 200 };
    };
    const result = await checkDevEnv({ url: PROD_URL, anonKey: "k", fetchImpl });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/PROD database/);
    expect(called).toBe(false);
  });

  it("blocks a deleted preview database", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: previewGone });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/no longer exists/);
  });

  it("blocks when the keys are rejected", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: respond(401) });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/keys/);
  });

  it("only warns when offline", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: unreachable });
    expect(result.level).toBe("warn");
  });

  it("only warns on an unexpected status, e.g. a branch still starting up", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: respond(503) });
    expect(result.level).toBe("warn");
  });
});

describe("ensureDevEnv", () => {
  const ok = { level: "ok", message: "" };
  const block = { level: "block", message: "stale" };
  const pointed = { url: PREVIEW_URL, anonKey: "new", projectRef: "abcdefghijklmnopqrst" };

  it("leaves a working setup alone", async () => {
    let pointCalls = 0;
    const result = await ensureDevEnv({
      env: { url: PREVIEW_URL, anonKey: "k" },
      check: async () => ok,
      point: async () => (pointCalls++, pointed),
    });
    expect(result.level).toBe("ok");
    expect(pointCalls).toBe(0);
  });

  it("switches to the current branch's preview when the setup is blocked, then re-checks the new values", async () => {
    const checked = [];
    const result = await ensureDevEnv({
      env: { url: PROD_URL, anonKey: "k" },
      check: async (env) => (checked.push(env.anonKey), env.anonKey === "new" ? ok : block),
      point: async () => pointed,
    });
    expect(checked).toEqual(["k", "new"]);
    expect(result.level).toBe("ok");
    expect(result.message).toMatch(/now points at/);
  });

  it("stays blocked, with both reasons, when switching fails", async () => {
    const result = await ensureDevEnv({
      env: { url: PROD_URL, anonKey: "k" },
      check: async () => block,
      point: async () => {
        throw new Error("No Supabase preview branch found");
      },
    });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/stale/);
    expect(result.message).toMatch(/No Supabase preview branch found/);
  });

  it("does not switch on a warning", async () => {
    let pointCalls = 0;
    const result = await ensureDevEnv({
      env: { url: PREVIEW_URL, anonKey: "k" },
      check: async () => ({ level: "warn", message: "offline" }),
      point: async () => (pointCalls++, pointed),
    });
    expect(result.level).toBe("warn");
    expect(pointCalls).toBe(0);
  });
});
