import type { UserRole } from "@/lib/database.types";

/**
 * Role → capability map. `manager` is shown as "Fleet Manager": it can view
 * the fleet, clients, contracts and payments, but never edit anything
 * (enforced in RLS by supabase/migrations/20261022090000_fleet_manager_read_only.sql
 * and again in every Server Action via requireAdmin()).
 *
 * Field-level hiding for Fleet Managers (prices, cash payments, outstanding
 * balances, banking reveal, the Payments dashboard) is done in the pages'
 * server code so that data never reaches their browser — keep all of those
 * checks going through these helpers instead of comparing `role` inline.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Fleet Manager",
  technician: "Technician",
};

/** Roles an admin can assign when creating a user (technician is retired from the UI). */
export const ASSIGNABLE_ROLES = ["admin", "manager"] as const satisfies readonly UserRole[];

/** Create/edit/delete anything, manage staff. */
export function canEdit(role: UserRole | undefined): boolean {
  return role === "admin";
}

/** Can open clients, contracts, payments and the contract columns on vehicles (read-only for managers). */
export function canViewContracts(role: UserRole | undefined): boolean {
  return role === "admin" || role === "manager";
}

/**
 * Sensitive money fields and views: Fleet value card, purchase/potential
 * sale price, banking Reveal, Payments dashboard, "Cash" payments and the
 * outstanding total. Admin only.
 */
export function canSeeFinancials(role: UserRole | undefined): boolean {
  return role === "admin";
}

/** Export to Excel, on every list view (Vehicles, Clients, Contracts,
 * Payments' Report and Transactions tabs). Fleet Managers are read-only
 * everywhere else in the app; exporting a spreadsheet is a way to take
 * data out of it, so it's withheld the same way edit rights are. */
export function canExport(role: UserRole | undefined): boolean {
  return role === "admin";
}
