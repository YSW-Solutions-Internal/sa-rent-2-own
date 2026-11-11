// Not a "use server" file: a plain constant/type here would break that
// directive's "only async functions" rule (see actions.ts's history —
// this is exactly what broke it the first time around).
export const ACTIVITY_ENTITY_TYPES = ["vehicles", "clients", "contracts"] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];
