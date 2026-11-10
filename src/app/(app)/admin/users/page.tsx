import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canEdit } from "@/lib/auth/permissions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { NewStaffDialog } from "./new-staff-dialog";
import { StaffRow } from "./staff-row";
import { StaffActiveToggle } from "./staff-active-toggle";
import { StaffWhatsAppToggle } from "./staff-whatsapp-toggle";

export default async function StaffPage() {
  const profile = await getCurrentProfile();
  if (!profile || !canEdit(profile.role)) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, is_active, whatsapp_enabled, whatsapp_finance_enabled")
    .order("full_name");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Accounts log in with a cell number and password — no email required.
        </p>
        <NewStaffDialog />
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Cell number</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>WhatsApp bot</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(staff ?? []).map((member) => (
              <StaffRow
                key={member.id}
                member={member}
                isSelf={member.id === profile.id}
                whatsapp={
                  <StaffWhatsAppToggle
                    userId={member.id}
                    enabled={member.whatsapp_enabled}
                    disabled={!member.is_active || member.role === "technician"}
                  />
                }
                actions={
                  member.id !== profile.id && (
                    <StaffActiveToggle userId={member.id} isActive={member.is_active} />
                  )
                }
              />
            ))}
            {(staff ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center py-8">
                  No users yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
