"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canExport, canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";

import type { PaymentTransactionRow, TransactionsFilters } from "./types";
import { buildTransactionsQuery, toTransactionRow } from "./transactions-query";

/** Export always needs every matching row, not just the page the browser
 * has loaded — this re-queries with the same filters, server-side, so
 * the role-based cash-contract check happens against the real session
 * (never trust the client to have filtered its own export). The role
 * check itself is re-done here too, not just left to the UI hiding the
 * button — a Fleet Manager calling this action directly must still be
 * refused. */
export async function exportTransactions(
  filters: Omit<TransactionsFilters, "page">
): Promise<{ rows: PaymentTransactionRow[] } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role) || !canExport(profile.role)) {
    return { error: "Not authorized" };
  }
  const showFinancials = canSeeFinancials(profile.role);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await buildTransactionsQuery(supabase, showFinancials, {
    ...filters,
    page: 1,
    all: true,
  });

  if (error || !data) {
    return { error: "Couldn't load transactions to export" };
  }

  return { rows: data.map(toTransactionRow) };
}
