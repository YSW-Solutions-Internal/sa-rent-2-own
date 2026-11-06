import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

import { TRANSACTIONS_PAGE_SIZE, type PaymentTransactionRow, type TransactionsFilters, type TransactionsSortKey } from "./types";

// "Show all" skips .range() pagination but still needs an explicit cap —
// PostgREST defaults to capping an unbounded select at 1,000 rows, which
// would silently truncate once the ledger passes that (same lesson as
// the old fetchAllTransactions' wave-pagination, applied here as a
// single generous ceiling since "show everything that matches a search"
// is a deliberate, occasional action, not the default path).
const SHOW_ALL_CAP = 10000;

const SORT_COLUMNS: Record<TransactionsSortKey, string> = {
  date: "transaction_date",
  deal: "deal_number",
  client: "client_name",
  amount: "cash_effect",
};

const SELECT_COLUMNS =
  "id, contract_id, transaction_date, type, reference, invoice_reference, cash_effect, reversed_transaction_id, deal_number, vehicle_id, client_name, client_blacklisted, reg";

/** Strips characters that have special meaning in a PostgREST `.or()`
 * filter string (commas separate clauses, parens group them) so a
 * search box can never reshape the query it's meant to filter. */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()]/g, " ").trim();
}

export function buildTransactionsQuery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  showFinancials: boolean,
  filters: TransactionsFilters
) {
  let query = supabase.from("payment_transactions_detail").select(SELECT_COLUMNS, { count: "exact" });

  if (!showFinancials) {
    query = query.neq("payment_method", "cash");
  }
  if (filters.type !== "all") {
    query = query.eq("type", filters.type);
  }
  const q = sanitizeSearch(filters.q);
  if (q) {
    query = query.or(
      `deal_number.ilike.%${q}%,client_name.ilike.%${q}%,reg.ilike.%${q}%,reference.ilike.%${q}%`
    );
  }

  query = query.order(SORT_COLUMNS[filters.sort], { ascending: filters.dir === "asc" });
  // Stable tiebreaker so pages never overlap/gap when many rows share a
  // sort value (e.g. a batch run's same-day receipts) — same reasoning
  // as the (transaction_date, id) convention elsewhere on this page.
  query = query.order("id", { ascending: filters.dir === "asc" });

  if (filters.all) {
    query = query.range(0, SHOW_ALL_CAP - 1);
  } else {
    const from = (filters.page - 1) * TRANSACTIONS_PAGE_SIZE;
    query = query.range(from, from + TRANSACTIONS_PAGE_SIZE - 1);
  }

  return query;
}

export function toTransactionRow(
  row: {
    id: string;
    transaction_date: string;
    deal_number: string | null;
    client_name: string | null;
    client_blacklisted: boolean;
    reg: string | null;
    vehicle_id: string | null;
    type: "receipt" | "debit_note";
    reference: string;
    invoice_reference: string;
    cash_effect: number;
    reversed_transaction_id: string | null;
  }
): PaymentTransactionRow {
  return {
    id: row.id,
    transactionDate: row.transaction_date,
    dealNumber: row.deal_number,
    clientName: row.client_name ?? "Unknown client",
    clientBlacklisted: row.client_blacklisted,
    reg: row.reg,
    vehicleId: row.vehicle_id,
    type: row.type,
    reference: row.reference,
    invoiceReference: row.invoice_reference,
    cashEffect: row.cash_effect,
    reversed: row.reversed_transaction_id !== null,
  };
}
