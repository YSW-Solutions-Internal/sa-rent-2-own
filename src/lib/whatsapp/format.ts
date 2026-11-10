// Pure formatting/sanitising helpers shared by the WhatsApp bot's tools.
// Deliberately no `server-only` import here (unlike tools.ts) -- neither
// function touches a database or secret, and keeping them plain makes them
// importable from a unit test without pulling in the whole tools module.

/** Letters/digits (and spaces) only, so user text can never reach a filter string. */
export const clean = (s: string) => s.replace(/[^A-Za-z0-9 ]/g, "").trim();

export const round2 = (n: number) => Math.round(n * 100) / 100;
