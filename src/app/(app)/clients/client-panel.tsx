"use client";

import { useState, useTransition } from "react";
import { useControllableOpen } from "@/lib/use-controllable-open";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, FileText, History, Landmark, Plus, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  PanelModalContent,
  PanelModalFooter,
  PanelModalHeader,
  PanelModalSection,
  PanelModalSections,
  scrollToPanelSection,
} from "@/components/ui/panel-modal";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { BlacklistFlag } from "@/components/blacklist-flag";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import { createClient, revealBankingDetails, updateClient } from "./actions";
import { bankAccountTypeValues, clientFormSchema, type ClientFormValues } from "./schema";
import type { ClientWithBanking } from "./types";
import { ClientContractsSection } from "./client-contracts-section";
import { getClientTotalCollected } from "./contract-links-actions";
import { TotalCollectedCard } from "@/components/total-collected-card";
import { ActivitySection } from "@/lib/activity-log/activity-section";

const ACCOUNT_TYPE_LABELS: Record<(typeof bankAccountTypeValues)[number], string> = {
  cheque: "Cheque / current",
  savings: "Savings",
  other: "Other",
};

function toFormValues(client?: ClientWithBanking): ClientFormValues {
  if (!client) {
    return { fullName: "", cellNumber: "" };
  }
  return {
    fullName: client.full_name,
    idNumber: client.id_number ?? undefined,
    cellNumber: client.cell_number,
    altCellNumber: client.alt_cell_number ?? undefined,
    email: client.email ?? undefined,
    address: client.address ?? undefined,
    notes: client.notes ?? undefined,
    blacklisted: client.blacklisted,
    blacklistReason: client.blacklist_reason ?? undefined,
    bankName: undefined,
    accountType: undefined,
    branchCode: undefined,
    accountHolderName: undefined,
    accountNumber: undefined,
  };
}

function RevealedBanking({ clientId }: { clientId: string }) {
  const [isPending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<{ accountHolderName: string; accountNumber: string } | null>(
    null
  );

  if (revealed) {
    return (
      <p className="text-muted-foreground text-sm">
        {revealed.accountHolderName} — {revealed.accountNumber}
      </p>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await revealBankingDetails(clientId);
          if (result.error || !result.data) {
            toast.error(result.error ?? "Couldn't reveal banking details");
            return;
          }
          setRevealed(result.data);
        })
      }
    >
      <Eye />
      {isPending ? "Revealing…" : "Reveal"}
    </Button>
  );
}

/** Fields in the Banking Details section (anything else is in Client). */
const BANKING_FIELDS = new Set(["bankName", "accountType", "branchCode", "accountHolderName", "accountNumber"]);

export function ClientPanel({
  client,
  readOnly = false,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  onCreated,
}: {
  client?: ClientWithBanking;
  /** View-only (Fleet Manager): fields disabled, no Save, no banking Reveal. */
  readOnly?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called after a new client is saved (not on edits), e.g. to select it in another form. */
  onCreated?: (id: string, values: ClientFormValues) => void;
}) {
  const { open, setOpen, isControlled } = useControllableOpen(openProp, onOpenChangeProp);
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(client);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: toFormValues(client),
  });

  // A save blocked by validation scrolls to the section holding the first bad field.
  function onInvalid(errors: FieldErrors<ClientFormValues>) {
    const first = Object.keys(errors)[0];
    scrollToPanelSection(BANKING_FIELDS.has(first) ? "banking" : "client");
  }

  const blacklisted = useWatch({ control: form.control, name: "blacklisted" });

  function onSubmit(values: ClientFormValues) {
    startTransition(async () => {
      const result = isEditing
        ? await updateClient(client!.id, values)
        : await createClient(values);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(isEditing ? "Client updated" : "Client added");
      if (!isEditing && result.id) onCreated?.(result.id, values);
      setOpen(false);
      form.reset(toFormValues(undefined));
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          form.reset(toFormValues(client));
        }
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          {isEditing ? (
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          ) : (
            <Button>
              <Plus />
              Add client
            </Button>
          )}
        </DialogTrigger>
      )}
      <PanelModalContent>
        <PanelModalHeader
          title={isEditing ? `${readOnly ? "Client details" : "Edit client"} – ${client!.full_name}` : "Add client"}
        />
        <Form {...form}>
          <form id="client-form" onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="contents">
            <PanelModalSections
              sections={[
                { id: "client", label: "Client", icon: User },
                { id: "banking", label: "Banking Details", icon: Landmark },
                ...(isEditing ? [{ id: "contracts", label: "Contracts", icon: FileText }] : []),
                ...(isEditing && !readOnly ? [{ id: "activity", label: "Activity", icon: History }] : []),
              ]}
            >
            <fieldset disabled={readOnly} className="contents">
            <PanelModalSection id="client" title="Client">
            {isEditing && <TotalCollectedCard id={client!.id} load={getClientTotalCollected} />}
            <section className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="idNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ID number</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cellNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cell number</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="082 123 4567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="altCellNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alternate cell number</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            <Separator />

            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="col-span-full flex items-center gap-1.5 text-xs font-semibold tracking-wide text-red-600 uppercase">
                <BlacklistFlag /> Blacklist
              </h3>
              <FormField
                control={form.control}
                name="blacklisted"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 sm:col-span-2">
                    <FormControl>
                      <Checkbox checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(v === true)} />
                    </FormControl>
                    <FormLabel className="!mt-0">Blacklist this client</FormLabel>
                  </FormItem>
                )}
              />
              {blacklisted && (
                <FormField
                  control={form.control}
                  name="blacklistReason"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Reason</FormLabel>
                      <FormControl>
                        <Textarea {...field} value={field.value ?? ""} placeholder="Why is this client blacklisted?" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </section>
            </PanelModalSection>

            <PanelModalSection id="banking" title="Banking Details">
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="col-span-full flex items-center justify-between">
                <span />
                {isEditing && client!.banking && !readOnly && <RevealedBanking clientId={client!.id} />}
              </div>
              {isEditing && client!.banking ? (
                <p className="text-muted-foreground col-span-full text-sm">
                  On file: {client!.banking.bank_name} •••• {client!.banking.account_number_last4}.
                  {!readOnly && " Fill in the fields below to replace it."}
                </p>
              ) : (
                <p className="text-muted-foreground col-span-full text-sm">
                  {readOnly ? "No banking details on file." : "Optional. Encrypted at rest — only admins can reveal it."}
                </p>
              )}
              {!readOnly && (
              <>
              <FormField
                control={form.control}
                name="bankName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bankAccountTypeValues.map((type) => (
                          <SelectItem key={type} value={type}>
                            {ACCOUNT_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="branchCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch code</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountHolderName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account holder name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account number</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </>
              )}
            </section>

            </PanelModalSection>

            {isEditing && (
              <PanelModalSection id="contracts" title="Contracts">
                <ClientContractsSection clientId={client!.id} />
              </PanelModalSection>
            )}
            {isEditing && !readOnly && (
              <PanelModalSection id="activity" title="Activity">
                <ActivitySection entityType="clients" entityId={client!.id} />
              </PanelModalSection>
            )}
            </fieldset>
            </PanelModalSections>
          </form>
        </Form>
        {!readOnly && (
          <PanelModalFooter>
            <Button type="submit" form="client-form" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </PanelModalFooter>
        )}
      </PanelModalContent>
    </Dialog>
  );
}
