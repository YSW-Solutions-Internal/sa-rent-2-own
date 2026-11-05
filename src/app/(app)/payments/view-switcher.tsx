"use client";

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
} from "./types";

export function PaymentsViewSwitcher({
  showFinancials,
  reportRows,
  monthLabels,
  summaryRows,
  transactionRows,
  monthlyData,
  netCollected,
  lastMonthLabel,
  lastMonthNetCollected,
  contractsInArrears,
  contractsTracked,
  exportedBy,
}: {
  /** Admin only: the Dashboard tab and the Outstanding column/total. */
  showFinancials: boolean;
  reportRows: ContractMonthlyReportRow[];
  monthLabels: string[];
  summaryRows: ContractPaymentSummaryRow[];
  transactionRows: PaymentTransactionRow[];
  monthlyData: MonthlyCollectedDatum[];
  netCollected: number;
  lastMonthLabel: string | null;
  lastMonthNetCollected: number;
  contractsInArrears: number;
  contractsTracked: number;
  exportedBy: string;
}) {
  return (
    <Tabs defaultValue="report" className="flex min-h-0 flex-1 flex-col gap-4">
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
        <TransactionsTable rows={transactionRows} exportedBy={exportedBy} />
      </TabsContent>
    </Tabs>
  );
}
