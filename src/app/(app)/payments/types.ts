export interface ContractPaymentSummaryRow {
  contractId: string;
  dealNumber: string | null;
  clientName: string;
  clientBlacklisted: boolean;
  lastTransactionDate: string;
  lastStatus: "cleared" | "reversed";
  netCollected: number;
  reversalCount: number;
  transactionCount: number;
  outstandingBalance: number | null;
}

export interface MonthlyCollectedDatum {
  month: string; // "Jan 2026"
  collected: number;
  reversed: number;
  /** collected - reversed */
  total: number;
}

export interface MonthlyReportCell {
  monthKey: string; // "2026-04"
  netCollected: number;
  /** No transaction history at all for this contract this early — shown
   * as a neutral cell, not counted as a miss (the contract may not have
   * started, or wasn't matched into the ledger yet at that point). */
  beforeCoverage: boolean;
  /** Has coverage, but netCollected <= 0 — a payment was due and didn't
   * clear by month end. */
  missed: boolean;
}

export interface ContractMonthlyReportRow {
  contractId: string;
  dealNumber: string | null;
  clientName: string;
  clientBlacklisted: boolean;
  reg: string | null;
  vehicleId: string | null;
  /** The contract's outstanding balance (contracts.outstanding_balance) — admin only, null for Fleet Managers. */
  outstandingBalance: number | null;
  paymentMethod: string;
  months: MonthlyReportCell[];
  missedCount: number;
}

// Shared between the server-only query builder (transactions-query.ts)
// and the client-side Transactions tab — kept here, not in
// transactions-query.ts, since that file is `import "server-only"`'d and
// a client component importing even a plain constant from it would throw.
export const TRANSACTIONS_PAGE_SIZE = 250;
export type TransactionsSortKey = "date" | "deal" | "client" | "amount";
export type TransactionsTypeFilter = "all" | "receipt" | "debit_note";

export interface TransactionsFilters {
  q: string;
  type: TransactionsTypeFilter;
  sort: TransactionsSortKey;
  /** The *real* database order direction — not the client-side table
   * hook's historical "asc secretly means newest-first for the date
   * column" trick. desc = newest/highest first, for every column. */
  dir: "asc" | "desc";
  /** 1-indexed. */
  page: number;
  all?: boolean;
}

export interface PaymentTransactionRow {
  id: string;
  transactionDate: string;
  dealNumber: string | null;
  clientName: string;
  clientBlacklisted: boolean;
  reg: string | null;
  vehicleId: string | null;
  type: "receipt" | "debit_note";
  reference: string;
  invoiceReference: string;
  cashEffect: number;
  /** This row is linked (either direction) to a reversal pair — a receipt
   * with reversed=true bounced; a debit_note always has reversed=true by
   * definition (it IS a reversal). */
  reversed: boolean;
}
