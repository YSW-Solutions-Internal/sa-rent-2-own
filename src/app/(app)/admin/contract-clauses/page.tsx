import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { canEdit } from "@/lib/auth/permissions";

import { listClauseTemplates } from "./actions";
import { ClauseTemplatesEditor } from "./clause-templates-editor";

export default async function ContractClausesPage() {
  const profile = await getCurrentProfile();
  if (!profile || !canEdit(profile.role)) {
    redirect("/");
  }

  const { data: clauses, error } = await listClauseTemplates();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        The terms-and-conditions wording rendered into every generated contract agreement PDF. Editing a clause here
        changes the wording for any agreement generated or regenerated afterwards — it doesn&apos;t change PDFs
        already saved on existing contracts.
      </p>
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : (
        <ClauseTemplatesEditor clauses={clauses ?? []} />
      )}
    </div>
  );
}
