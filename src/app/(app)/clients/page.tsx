import { redirect } from "next/navigation";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canEdit, canViewContracts } from "@/lib/auth/permissions";

import { ClientPanel } from "./client-panel";
import { ClientsTable } from "./clients-table";
import type { ClientWithBanking } from "./types";

export default async function ClientsPage() {
  const profile = await getCurrentProfile();
  if (!profile || !canViewContracts(profile.role)) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  // Banking details aren't filtered by client id here (a small table,
  // fetched in full) so this doesn't wait on the clients query first.
  const [{ data: clients }, { data: banking }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, full_name, id_number, cell_number, alt_cell_number, email, address, notes, blacklisted, blacklist_reason")
      .order("full_name"),
    supabase
      .from("client_banking_details")
      .select("id, client_id, bank_name, account_type, branch_code, account_number_last4"),
  ]);

  const bankingByClient = new Map((banking ?? []).map((b) => [b.client_id, b]));

  const rows: ClientWithBanking[] = (clients ?? []).map((c) => {
    const b = bankingByClient.get(c.id);
    return {
      ...c,
      banking: b
        ? {
            id: b.id,
            bank_name: b.bank_name,
            account_type: b.account_type,
            branch_code: b.branch_code,
            account_number_last4: b.account_number_last4,
          }
        : null,
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        {canEdit(profile.role) && <ClientPanel />}
      </div>

      <ClientsTable rows={rows} exportedBy={profile.fullName} canEdit={canEdit(profile.role)} />
    </div>
  );
}
