import type { ReactNode } from "react";

import { Text, View } from "@react-pdf/renderer";

import { styles } from "./styles";
import type { AgreementClause } from "./types";

/** Letterhead bar, repeated on every page via `fixed`. */
export function AgreementHeader({ dealNumber }: { dealNumber: string | null }) {
  return (
    <View style={styles.headerBar} fixed>
      <View>
        <Text style={styles.headerCompany}>SA Rent 2 Own</Text>
        <Text style={styles.headerCompanySub}>Silver Trio CC t/a SA Rent 2 Own · Reg 2014/206712/07 · VAT 4670274002</Text>
      </View>
      <View style={styles.headerDealBox}>
        <Text style={styles.headerDealLabel}>Deal number</Text>
        <Text style={styles.headerDealValue}>{dealNumber ?? "—"}</Text>
      </View>
    </View>
  );
}

/** Page number + generation timestamp, repeated on every page via `fixed`. */
export function AgreementFooter({ generatedAt }: { generatedAt: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>Generated {new Date(generatedAt).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export function SectionHeading({ children }: { children: string }) {
  return <Text style={styles.sectionHeading}>{children}</Text>;
}

/** A bordered two-column label/value table, e.g. "Deal details". */
export function DataTable({ rows }: { rows: [string, string][] }) {
  return (
    <View style={styles.table} wrap={false}>
      {rows.map(([label, value], i) => (
        <View key={label} style={i === rows.length - 1 ? styles.rowLast : styles.row}>
          <Text style={styles.cellLabel}>{label}</Text>
          <Text style={styles.cellValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/** One numbered clause from contract_clause_templates, body split on blank
 * lines so each paragraph wraps independently. */
export function ClauseSection({ clause }: { clause: AgreementClause }) {
  const paragraphs = clause.body.split(/\n\n+/);
  return (
    <View wrap>
      <Text style={styles.clauseHeading}>{clause.heading}</Text>
      {paragraphs.map((paragraph, i) => (
        <Text key={i} style={[styles.clauseBody, i > 0 ? { marginTop: 4 } : undefined]}>
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

/** Two tables (or any two blocks) side by side, e.g. Rental Provider +
 * Renter. Falls back to stacking if the page is too narrow to matter -
 * react-pdf has no media queries, so this is just a fixed 49/49 split. */
export function TwoColumn({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <View style={styles.twoCol}>
      <View style={styles.twoColItem}>{left}</View>
      <View style={styles.twoColItem}>{right}</View>
    </View>
  );
}

export function SignatureBlock({ role }: { role: string }) {
  return (
    <View style={styles.signatureBlock}>
      <Text style={styles.signatureLine}>{role} signature</Text>
      <Text style={[styles.signatureLine, { marginTop: 14 }]}>Date</Text>
    </View>
  );
}
