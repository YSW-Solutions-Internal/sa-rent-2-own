"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { ClauseTemplate } from "./actions";
import { updateClauseTemplate } from "./actions";

export function ClauseCard({ clause }: { clause: ClauseTemplate }) {
  const [saved, setSaved] = useState({ heading: clause.heading, body: clause.body });
  const [heading, setHeading] = useState(clause.heading);
  const [body, setBody] = useState(clause.body);
  const [isPending, startTransition] = useTransition();

  const dirty = heading !== saved.heading || body !== saved.body;

  function onSave() {
    startTransition(async () => {
      const result = await updateClauseTemplate(clause.id, { heading, body });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSaved({ heading, body });
      toast.success("Clause saved");
    });
  }

  function onReset() {
    setHeading(saved.heading);
    setBody(saved.body);
  }

  return (
    <Card>
      <CardHeader>
        <Input
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          className="font-medium"
          aria-label="Clause heading"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} aria-label="Clause body" />
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onReset} disabled={isPending}>
              Discard
            </Button>
            <Button size="sm" onClick={onSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
