import { redirect } from "next/navigation";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canSeeFinancials, canViewContracts } from "@/lib/auth/permissions";
import type { PaymentTransactionType } from "@/lib/database.types";

import { PaymentsViewSwitcher } from "./view-switcher";
import type {
  ContractMonthlyReportRow,
  ContractPaymentSummaryRow,
  MonthlyCollectedDatum,
  MonthlyReportCell,
  PaymentTransactionRow,
} from "./types";

const MONTHS_SHOWN = 12;
const MONTH_LABEL = new Intl.DateTimeFormat("en-ZA", { month: "short", year: "numeric" });
const PAGE_SIZE = 1000;

interface TransactionRow {
  id: string;
  contract_id: string;
  transaction_date: string;
  type: PaymentTransactionType;
  reference: string;
  invoice_reference: string;
  cash_effect: number;
  reversed_transaction_id: string | null;
}

const TRANSACTION_SELECT =
  "id, contract_id, transaction_date, type, reference, invoice_reference, cash_effect, reversed_transaction_id";

/** PostgREST caps an unpaginated select at 1000 rows by default — with
 * 3,600+ transactions and counting, a plain .select() here silently
 * dropped everything after the 1000th row (ordered oldest-first, so the
 * UI looked like history just stopped in late 2024). Page through with
 * .range() instead of trusting a single request to return everything.
 *
 * Ordering by transaction_date alone isn't a *stable* sort — many rows
 * share the same date (a batch run's receipts), so Postgres doesn't
 * guarantee the same relative order for tied rows across two separate
 * requests. Without a unique tiebreaker, that let the same row land in
 * two different pages (seen as a duplicate React key on id) while
 * another row could just as easily have been skipped between pages.
 * Ordering by (transaction_date, id) makes every page's boundary
 * deterministic, so pages never overlap or gap.
 *
 * Pages are fired in parallel waves rather than awaited one at a time —
 * a separate upfront count query would add a full extra round trip to
 * the critical path before any real data could even start loading, and
 * sequential .range() awaits were the bigger cost before that. A wave
 * covers comfortably more than today's ~3,600 rows, so in practice this
 * resolves in a single wave; it only reaches for a second wave once the
 * ledger actually grows past that.
 */
async function fetchAllTransactions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
): Promise<TransactionRow[]> {
  const WAVE_SIZE = 5; // 5,000 rows of headroom per wave
  const all: TransactionRow[] = [];
  let pageIndex = 0;
  let reachedEnd = false;

  while (!reachedEnd) {
    const wave = await Promise.all(
      Array.from({ length: WAVE_SIZE }, (_, i) => {
        const page = pageIndex + i;
        return supabase
          .from("payment_transactions")
          .select(TRANSACTION_SELECT)
          .order("transaction_date", { ascending: true })
          .order("id", { ascending: true })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      })
    );
    pageIndex += WAVE_SIZE;

    for (const { data, error } of wave) {
      if (error || !data || data.length === 0) {
        reachedEnd = true;
        continue;
      }
      all.push(...data);
      if (data.length < PAGE_SIZE) reachedEnd = true;
    }
  }

  return all;
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

export default async function PaymentsPage() {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) {
    redirect("/");
  }
  // Fleet Managers get a trimmed view: no Dashboard tab, no "Cash"
  // payments, no outstanding balances. All of that is dropped here on the
  // server so none of it is ever sent to their browser.
  const showFinancials = canSeeFinancials(profile.role);

  const supabase = await createSupabaseServerClient();

  const [
    allTransactions,
    { data: contracts },
    { data: clients },
    { data: registrations },
    { data: monthlyRows },
    { data: contractSummaries },
    { data: contractMonthlies },
  ] = await Promise.all([
    // Still needed raw for the flat Transactions tab (item 32's
    // remaining step — paging/windowing that list — is its own
    // follow-up; everything else below now reads from views instead).
    fetchAllTransactions(supabase),
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
  const transactions = showFinancials
    ? allTransactions
    : allTransactions.filter((t) => !cashContractIds.has(t.contract_id));
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

  // Most-recent-first, individual-transaction view — the flat ledger
  // underneath the per-contract rollups above.
  const transactionRows: PaymentTransactionRow[] = [...transactions].reverse().map((t) => ({
    id: t.id,
    transactionDate: t.transaction_date,
    dealNumber: dealNumberByContract.get(t.contract_id) ?? null,
    clientName: clientNameById.get(clientIdByContract.get(t.contract_id) ?? "") ?? "Unknown client",
    clientBlacklisted: blacklistedClientIds.has(clientIdByContract.get(t.contract_id) ?? ""),
    reg: plateByVehicle.get(vehicleIdByContract.get(t.contract_id) ?? "") ?? null,
    vehicleId: vehicleIdByContract.get(t.contract_id) ?? null,
    type: t.type,
    reference: t.reference,
    invoiceReference: t.invoice_reference,
    cashEffect: t.cash_effect,
    reversed: t.reversed_transaction_id !== null,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PaymentsViewSwitcher
        showFinancials={showFinancials}
        reportRows={reportRows}
        monthLabels={monthLabels}
        summaryRows={showFinancials ? summaryRows : []}
        transactionRows={transactionRows}
        monthlyData={showFinancials ? monthlyData : []}
        netCollected={showFinancials ? netCollected : 0}
        lastMonthLabel={showFinancials ? lastMonthLabel : null}
        lastMonthNetCollected={showFinancials ? lastMonthNetCollected : 0}
        contractsInArrears={showFinancials ? contractsInArrears : 0}
        contractsTracked={showFinancials ? summaryRows.length : 0}
        exportedBy={profile.fullName}
      />
    </div>
  );
}
