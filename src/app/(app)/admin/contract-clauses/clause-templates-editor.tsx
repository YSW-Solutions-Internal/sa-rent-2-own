"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ClauseTemplate } from "./actions";
import { ClauseCard } from "./clause-card";

const CATEGORY_LABELS: Record<ClauseTemplate["category"], string> = {
  rent_to_own: "Rent to Own",
  rental: "Rental",
};

export function ClauseTemplatesEditor({ clauses }: { clauses: ClauseTemplate[] }) {
  const categories = (Object.keys(CATEGORY_LABELS) as ClauseTemplate["category"][]).filter((category) =>
    clauses.some((c) => c.category === category)
  );

  if (categories.length === 0) {
    return <p className="text-muted-foreground text-sm">No contract clauses found.</p>;
  }

  return (
    <Tabs defaultValue={categories[0]}>
      <TabsList>
        {categories.map((category) => (
          <TabsTrigger key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </TabsTrigger>
        ))}
      </TabsList>
      {categories.map((category) => (
        <TabsContent key={category} value={category} className="flex flex-col gap-4">
          {clauses
            .filter((c) => c.category === category)
            .map((clause) => (
              <ClauseCard key={clause.id} clause={clause} />
            ))}
        </TabsContent>
      ))}
    </Tabs>
  );
}
