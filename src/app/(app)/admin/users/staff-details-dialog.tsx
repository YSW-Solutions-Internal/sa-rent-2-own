"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/auth/permissions";
import { formatSaPhoneForDisplay } from "@/lib/phone";
import type { UserRole } from "@/lib/database.types";

import { getStaffActivity, updateStaffUser, type ActivityEntry } from "./actions";
import { editStaffFormSchema, splitFullName, type EditStaffFormValues } from "./schema";

export interface StaffMember {
  id: string;
  full_name: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
  whatsapp_enabled: boolean;
  whatsapp_finance_enabled: boolean;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}

function ActivityLog({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStaffActivity(userId).then((result) => {
      if (cancelled) return;
      if (result.error) setError(result.error);
      else setEntries(result.entries ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!entries) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (entries.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">No activity recorded yet.</p>;
  }

  return (
    <ul className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{entry.label}</span>
            <span className="text-muted-foreground shrink-0 text-xs">{formatWhen(entry.at)}</span>
          </div>
          {entry.detail && <span className="text-muted-foreground text-xs">{entry.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function StaffDetailsDialog({
  member,
  isSelf,
  open,
  onOpenChange,
}: {
  member: StaffMember;
  isSelf: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState("details");

  const form = useForm<EditStaffFormValues>({
    resolver: zodResolver(editStaffFormSchema),
    defaultValues: {
      ...splitFullName(member.full_name),
      phone: formatSaPhoneForDisplay(member.phone),
      role: member.role,
      whatsappEnabled: member.whatsapp_enabled,
      whatsappFinanceEnabled: member.whatsapp_finance_enabled,
    },
  });

  // Reopening should show the latest saved values, not stale edits.
  useEffect(() => {
    if (open) {
      form.reset({
        ...splitFullName(member.full_name),
        phone: formatSaPhoneForDisplay(member.phone),
        role: member.role,
        whatsappEnabled: member.whatsapp_enabled,
        whatsappFinanceEnabled: member.whatsapp_finance_enabled,
      });
    }
  }, [open, member, form]);

  const role = useWatch({ control: form.control, name: "role" });
  const whatsappEnabled = useWatch({ control: form.control, name: "whatsappEnabled" });
  const roles: UserRole[] = member.role === "technician" ? ["technician", ...ASSIGNABLE_ROLES] : [...ASSIGNABLE_ROLES];

  function onSubmit(values: EditStaffFormValues) {
    startTransition(async () => {
      const result = await updateStaffUser(member.id, values);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("User updated");
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTab("details");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member.full_name}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="activity">Activity log</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="surname"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Surname</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cell number</FormLabel>
                      <FormControl>
                        <Input type="tel" {...field} />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">
                        This is also their login — they&apos;ll use the new number next time.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={isSelf}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isSelf && (
                        <p className="text-muted-foreground text-xs">You can&apos;t change your own role.</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="whatsappEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={role !== "technician" && field.value}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                          disabled={role === "technician"}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Allowed to use the WhatsApp bot</FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="whatsappFinanceEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 pl-6">
                      <FormControl>
                        <Checkbox
                          checked={role !== "technician" && whatsappEnabled && field.value}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                          disabled={role === "technician" || !whatsappEnabled}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">
                        Also allowed to ask about payments, revenue and transactions
                      </FormLabel>
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Saving…" : "Save changes"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>
          <TabsContent value="activity" className="pt-2">
            {tab === "activity" && <ActivityLog userId={member.id} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
