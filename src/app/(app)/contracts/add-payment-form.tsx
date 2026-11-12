"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { createManualPayment } from "./payment-actions";
import { paymentMethodValues } from "./schema";

const PAYMENT_METHOD_LABELS: Record<(typeof paymentMethodValues)[number], string> = {
  debit_order: "Debit order",
  eft: "EFT",
  cash: "Cash",
  other: "Other",
};

/** Inline form for manually capturing a payment against a contract (the Financials tab's "Add payment"). */
export function AddPaymentForm({
  contractId,
  onSaved,
  onCancel,
}: {
  contractId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createManualPayment(contractId, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Payment recorded");
      formRef.current?.reset();
      onSaved();
    });
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      className="bg-muted/30 flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="transactionDate">Date</Label>
          <Input
            id="transactionDate"
            name="transactionDate"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="amount">Amount (R)</Label>
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="paymentMethod">Method</Label>
          <Select name="paymentMethod">
            <SelectTrigger id="paymentMethod" className="w-full">
              <SelectValue placeholder="Not specified" />
            </SelectTrigger>
            <SelectContent>
              {paymentMethodValues.map((m) => (
                <SelectItem key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reference">Reference</Label>
          <Input id="reference" name="reference" placeholder="Auto-generated if blank" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save payment"}
        </Button>
      </div>
    </form>
  );
}
