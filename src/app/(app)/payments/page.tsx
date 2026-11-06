import { redirect } from "next/navigation";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";

import { PaymentsViewSwitcher } from "./view-switcher";
import { buildTransactionsQuery, toTransactionRow } from "./transactions-query";
import type {
  ContractMonthlyReportRow,
  ContractPaymentSummaryRow,
  MonthlyCollectedDatum,
  MonthlyReportCell,
  TransactionsSortKey,
  TransactionsTypeFilter,
} from "./types";

const MONTHS_SHOWN = 12;
const MONTH_LABEL = new Intl.DateTimeFormat("en-ZA", { month: "short", year: "numeric" });

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

/** Steps a "YYYY-MM" key back by `n` months. */
function monthKeyMinus(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const SORT_KEYS: readonly TransactionsSortKey[] = ["date", "deal", "client", "amount"];
const TYPE_FILTERS: readonly TransactionsTypeFilter[] = ["all", "receipt", "debit_note"];

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) {
    redirect("/");
  }
  // Fleet Managers get a trimmed view: no Dashboard tab, no "Cash"
  // payments, no outstanding balances. All of that is dropped here on the
  // server so none of it is ever sent to their browser.
  const showFinancials = canSeeFinancials(profile.role);

  const params = await searchParams;
  // The Transactions tab's search/filter/sort/page live in the URL (not
  // local component state) so a filter change can be a real server-side
  // query instead of filtering thousands of already-downloaded rows —
  // and so the tab a filter change was made from survives the resulting
  // navigation instead of the page resetting to Report.
  const initialTab = firstParam(params.tab) === "transactions" ? "transactions" : "report";
  const txQ = firstParam(params.tx_q) ?? "";
  const txTypeParam = firstParam(params.tx_type);
  const txType: TransactionsTypeFilter = TYPE_FILTERS.includes(txTypeParam as TransactionsTypeFilter)
    ? (txTypeParam as TransactionsTypeFilter)
    : "all";
  const txSortParam = firstParam(params.tx_sort);
  const txSort: TransactionsSortKey = SORT_KEYS.includes(txSortParam as TransactionsSortKey)
    ? (txSortParam as TransactionsSortKey)
    : "date";
  const txDir: "asc" | "desc" = firstParam(params.tx_dir) === "asc" ? "asc" : "desc";
  const txAll = firstParam(params.tx_page) === "all";
  const txPageNum = Math.max(1, Number(firstParam(params.tx_page)) || 1);
  const txFilters = { q: txQ, type: txType, sort: txSort, dir: txDir, page: txPageNum, all: txAll };

  const supabase = await createSupabaseServerClient();

  const [
    { data: transactionRowsRaw, count: transactionsTotal },
    { data: contracts },
    { data: clients },
    { data: registrations },
    { data: monthlyRows },
    { data: contractSummaries },
    { data: contractMonthlies },
  ] = await Promise.all([
    // Only the Transactions tab's current page/filter/search/sort — the
    // join view (payment_transactions_detail) and the role-based cash
    // filter are applied in the query itself, not after fetching
    // everything (see buildTransactionsQuery).
    buildTransactionsQuery(supabase, showFinancials, txFilters),
    supabase
      .from("contracts")
      .select("id, deal_number, client_id, vehicle_id, payment_method, outstanding_balance"),
    supabase.from("clients").select("id, full_name, blacklisted"),
    supabase.from("vehicle_registrations").select("vehicle_id, plate_number").is("effective_to", null),
    // Per-month totals come pre-aggregated from a view (every month, not just the latest 12).
    showFinancials
      ? supabase.from("payment_monthly_totals").select("month, collected, reversed, net").order("month", { ascending: false })
      : Promise.resolve({ data: [] as { month: string; collected: number; reversed: number; net: number }[] }),
    // One row per contract that's ever had a transaction — feeds the
    // Report tab's contract list + first-coverage month (both roles) and
    // the Dashboard rollup/stat cards (admin only).
    supabase
      .from("payment_contract_summary")
      .select("contract_id, net_collected, reversal_count, transaction_count, first_transaction_date, last_transaction_date, last_type"),
    // One row per contract per month that had activity — feeds the
    // Report tab's monthly matrix (both roles).
    supabase.from("payment_contract_monthly").select("contract_id, month, net_collected"),
  ]);

  const cashContractIds = new Set((contracts ?? []).filter((c) => c.payment_method === "cash").map((c) => c.id));
  const contractSummaryRows = showFinancials
    ? (contractSummaries ?? [])
    : (contractSummaries ?? []).filter((r) => !cashContractIds.has(r.contract_id));
  const contractMonthlyRows = showFinancials
    ? (contractMonthlies ?? [])
    : (contractMonthlies ?? []).filter((r) => !cashContractIds.has(r.contract_id));

  const dealNumberByContract = new Map((contracts ?? []).map((c) => [c.id, c.deal_number]));
  const clientIdByContract = new Map((contracts ?? []).map((c) => [c.id, c.client_id]));
  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.full_name]));
  const blacklistedClientIds = new Set((clients ?? []).filter((c) => c.blacklisted).map((c) => c.id));
  const vehicleIdByContract = new Map((contracts ?? []).map((c) => [c.id, c.vehicle_id]));
  const paymentMethodByContract = new Map((contracts ?? []).map((c) => [c.id, c.payment_method]));
  const outstandingBalanceByContract = new Map((contracts ?? []).map((c) => [c.id, c.outstanding_balance]));
  const plateByVehicle = new Map((registrations ?? []).map((r) => [r.vehicle_id, r.plate_number]));

  const summaryRows: ContractPaymentSummaryRow[] = contractSummaryRows.map((row) => ({
    contractId: row.contract_id,
    dealNumber: dealNumberByContract.get(row.contract_id) ?? null,
    clientName: clientNameById.get(clientIdByContract.get(row.contract_id) ?? "") ?? "Unknown client",
    clientBlacklisted: blacklistedClientIds.has(clientIdByContract.get(row.contract_id) ?? ""),
    lastTransactionDate: row.last_transaction_date,
    lastStatus: row.last_type === "debit_note" ? "reversed" : "cleared",
    netCollected: Number(row.net_collected),
    reversalCount: Number(row.reversal_count),
    transactionCount: Number(row.transaction_count),
    outstandingBalance: outstandingBalanceByContract.get(row.contract_id) ?? null,
  }));

  const monthlyData: MonthlyCollectedDatum[] = (monthlyRows ?? []).map((r) => ({
    month: MONTH_LABEL.format(new Date(`${r.month}T00:00:00Z`)),
    collected: Number(r.collected),
    reversed: Number(r.reversed),
    total: Number(r.net),
  }));

  const netCollected = (monthlyRows ?? []).reduce((sum, r) => sum + Number(r.net), 0);
  const lastMonthKey = monthlyRows?.[0]?.month ? monthKey(monthlyRows[0].month) : null;
  const lastMonthNetCollected = monthlyRows?.[0] ? Number(monthlyRows[0].net) : 0;
  const lastMonthLabel = lastMonthKey ? MONTH_LABEL.format(new Date(`${lastMonthKey}-01T00:00:00Z`)) : null;
  const contractsInArrears = summaryRows.filter((r) => r.lastStatus === "reversed").length;

  // Report window — anchored to the most recent month actually present in
  // the (role-filtered) data, not the real calendar "today": this is
  // historical/imported data, and today's calendar date usually runs
  // ahead of it, which would otherwise show every account "missing"
  // trailing months that just haven't happened yet.
  const windowAnchorKey = contractSummaryRows.length
    ? monthKey(contractSummaryRows.reduce((max, r) => (r.last_transaction_date > max ? r.last_transaction_date : max), contractSummaryRows[0].last_transaction_date))
    : null;
  const windowEndKey = windowAnchorKey ?? monthKey(new Date().toISOString());
  // Most recent month first — the report reads left-to-right as "now,
  // then going back", unlike the dashboard chart's chronological order.
  const windowKeys = Array.from({ length: MONTHS_SHOWN }, (_, i) => monthKeyMinus(windowEndKey, i));

  const monthlyByContract = new Map<string, Map<string, number>>();
  for (const row of contractMonthlyRows) {
    if (!monthlyByContract.has(row.contract_id)) monthlyByContract.set(row.contract_id, new Map());
    monthlyByContract.get(row.contract_id)!.set(monthKey(row.month), Number(row.net_collected));
  }
  const firstMonthByContract = new Map(
    contractSummaryRows.map((row) => [row.contract_id, monthKey(row.first_transaction_date)])
  );

  const reportRows: ContractMonthlyReportRow[] = contractSummaryRows.map(({ contract_id: contractId }) => {
    const contractMonths = monthlyByContract.get(contractId) ?? new Map();
    const firstMonth = firstMonthByContract.get(contractId) ?? windowKeys[0];
    let missedCount = 0;
    const months: MonthlyReportCell[] = windowKeys.map((key) => {
      const beforeCoverage = key < firstMonth;
      const net = contractMonths.get(key) ?? 0;
      const missed = !beforeCoverage && net <= 0;
      if (missed) missedCount += 1;
      return { monthKey: key, netCollected: net, beforeCoverage, missed };
    });
    return {
      contractId,
      dealNumber: dealNumberByContract.get(contractId) ?? null,
      clientName: clientNameById.get(clientIdByContract.get(contractId) ?? "") ?? "Unknown client",
      clientBlacklisted: blacklistedClientIds.has(clientIdByContract.get(contractId) ?? ""),
      reg: plateByVehicle.get(vehicleIdByContract.get(contractId) ?? "") ?? null,
      vehicleId: vehicleIdByContract.get(contractId) ?? null,
      outstandingBalance: showFinancials ? (outstandingBalanceByContract.get(contractId) ?? null) : null,
      paymentMethod: paymentMethodByContract.get(contractId) ?? "other",
      months,
      missedCount,
    };
  });

  const monthLabels = windowKeys.map((key) => MONTH_LABEL.format(new Date(`${key}-01T00:00:00Z`)));

  // Already in the requested order straight from the query (default:
  // most-recent-first) — no client-side sort needed.
  const transactionRows = (transactionRowsRaw ?? []).map(toTransactionRow);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PaymentsViewSwitcher
        showFinancials={showFinancials}
        reportRows={reportRows}
        monthLabels={monthLabels}
        summaryRows={showFinancials ? summaryRows : []}
        transactionRows={transactionRows}
        transactionsTotal={transactionsTotal ?? transactionRows.length}
        transactionsFilters={txFilters}
        monthlyData={showFinancials ? monthlyData : []}
        netCollected={showFinancials ? netCollected : 0}
        lastMonthLabel={showFinancials ? lastMonthLabel : null}
        lastMonthNetCollected={showFinancials ? lastMonthNetCollected : 0}
        contractsInArrears={showFinancials ? contractsInArrears : 0}
        contractsTracked={showFinancials ? summaryRows.length : 0}
        exportedBy={profile.fullName}
        initialTab={initialTab}
      />
    </div>
  );
}
