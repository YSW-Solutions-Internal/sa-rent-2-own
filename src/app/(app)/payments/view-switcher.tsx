"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PaymentsStatsCards } from "./stats-cards";
import { MonthlyCollectionsChartClient } from "./monthly-collections-chart-client";
import { PaymentsTable } from "./payments-table";
import { MonthlyReportTable } from "./monthly-report-table";
import { TransactionsTable } from "./transactions-table";
import type {
  ContractMonthlyReportRow,
  ContractPaymentSummaryRow,
  MonthlyCollectedDatum,
  PaymentTransactionRow,
  TransactionsFilters,
} from "./types";

export function PaymentsViewSwitcher({
  showFinancials,
  reportRows,
  monthLabels,
  summaryRows,
  transactionRows,
  transactionsTotal,
  transactionsFilters,
  monthlyData,
  netCollected,
  lastMonthLabel,
  lastMonthNetCollected,
  contractsInArrears,
  contractsTracked,
  exportedBy,
  initialTab,
}: {
  /** Admin only: the Dashboard tab and the Outstanding column/total. */
  showFinancials: boolean;
  reportRows: ContractMonthlyReportRow[];
  monthLabels: string[];
  summaryRows: ContractPaymentSummaryRow[];
  transactionRows: PaymentTransactionRow[];
  /** Count of every row matching the current filters, not just this page. */
  transactionsTotal: number;
  transactionsFilters: TransactionsFilters;
  monthlyData: MonthlyCollectedDatum[];
  netCollected: number;
  lastMonthLabel: string | null;
  lastMonthNetCollected: number;
  contractsInArrears: number;
  contractsTracked: number;
  exportedBy: string;
  /** From the URL's ?tab= param, so a Transactions-tab filter change (a
   * real navigation) reopens on that tab instead of resetting to Report. */
  initialTab: "report" | "transactions";
}) {
  // Uncontrolled would be simpler, but Report/Dashboard switches must
  // stay instant (no navigation) while Transactions filter changes do
  // navigate (see transactions-table.tsx) and need the tab to survive
  // that round trip — hence local state seeded from the URL rather than
  // a plain defaultValue.
  const [tab, setTab] = useState<string>(initialTab);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Title and tabs share one row so the tabs don't cost a line of vertical space. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
          <p className="text-muted-foreground text-sm">
            Debit-order payment history, backfilled from the legacy system&apos;s ledger.
          </p>
        </div>
        <TabsList>
          <TabsTrigger value="report">Report</TabsTrigger>
          {showFinancials && <TabsTrigger value="dashboard">Dashboard</TabsTrigger>}
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="report" className="flex min-h-0 flex-1 flex-col">
        <MonthlyReportTable
          rows={reportRows}
          monthLabels={monthLabels}
          exportedBy={exportedBy}
          showCash={showFinancials}
          showOutstanding={showFinancials}
          canExport={showFinancials}
        />
      </TabsContent>

      {showFinancials && (
        <TabsContent value="dashboard" className="flex min-h-0 flex-1 flex-col gap-4">
          <PaymentsStatsCards
            netCollected={netCollected}
            lastMonthLabel={lastMonthLabel}
            lastMonthNetCollected={lastMonthNetCollected}
            contractsInArrears={contractsInArrears}
            contractsTracked={contractsTracked}
          />

          <div className="h-64 rounded-lg border bg-background p-4">
            <h3 className="mb-3 font-semibold tracking-tight">Monthly collected, reversed and total</h3>
            <div className="h-[calc(100%-2rem)]">
              <MonthlyCollectionsChartClient data={monthlyData} />
            </div>
          </div>

          <PaymentsTable rows={summaryRows} />
        </TabsContent>
      )}

      <TabsContent value="transactions" className="flex min-h-0 flex-1 flex-col">
        <TransactionsTable
          rows={transactionRows}
          total={transactionsTotal}
          filters={transactionsFilters}
          exportedBy={exportedBy}
          canExport={showFinancials}
        />
      </TabsContent>
    </Tabs>
  );
}
