import { Document, Page, Text, View } from "@react-pdf/renderer";

import { blank, formatDate } from "./format";
import { AgreementFooter, AgreementHeader, ClauseSection, DataTable, SectionHeading, SignatureBlock, TwoColumn } from "./layout";
import { styles } from "./styles";
import type { AgreementData } from "./types";

const vehicleDescription = (v: AgreementData["vehicle"]) => [v.year, v.make, v.model].filter(Boolean).join(" ") || "_______________";

export function RentalDocument({ data }: { data: AgreementData }) {
  const ownerRows: [string, string][] = [
    ["Owner / rental company", "Silver Trio CC t/a SA Rent 2 Own"],
    ["Registration number", "2014/206712/07"],
    ["VAT number", "4670274002"],
  ];

  const driverRows: [string, string][] = [
    ["Full name", data.client.fullName],
    ["ID / passport number", blank(data.client.idNumber)],
    ["Telephone", data.client.cellNumber],
    ["Address", blank(data.client.address)],
  ];

  const vehicleRows: [string, string][] = [
    ["Make & model", vehicleDescription(data.vehicle)],
    ["Registration number", blank(data.vehicle.regNumber)],
    ["VIN", blank(data.vehicle.vin)],
  ];

  const periodRows: [string, string][] = [
    ["Start date", formatDate(data.startDate)],
    ["End date", formatDate(data.endDate)],
  ];

  return (
    <Document title={`Vehicle Rental Agreement${data.dealNumber ? ` - ${data.dealNumber}` : ""}`}>
      <Page size="A4" style={styles.page}>
        <AgreementHeader dealNumber={data.dealNumber} />
        <AgreementFooter generatedAt={data.generatedAt} />

        <Text style={styles.docTitle}>Vehicle Rental Agreement</Text>
        <Text style={[styles.clauseBody, { marginBottom: 6 }]}>
          This agreement sets out the terms under which the vehicle described below is rented by the Owner to the Driver. This is a
          formal and legally binding agreement.
        </Text>

        <SectionHeading>Parties</SectionHeading>
        <TwoColumn left={<DataTable rows={ownerRows} />} right={<DataTable rows={driverRows} />} />

        <SectionHeading>Vehicle Details</SectionHeading>
        <DataTable rows={vehicleRows} />

        <SectionHeading>Rental Period</SectionHeading>
        <DataTable rows={periodRows} />
      </Page>

      <Page size="A4" style={styles.page}>
        <AgreementHeader dealNumber={data.dealNumber} />
        <AgreementFooter generatedAt={data.generatedAt} />

        <Text style={styles.docTitle}>Terms and Conditions</Text>

        {data.clauses.map((clause) => (
          <ClauseSection key={clause.heading} clause={clause} />
        ))}

        <View style={styles.signatureRow} wrap={false}>
          <SignatureBlock role="Owner" />
          <SignatureBlock role="Driver" />
        </View>
      </Page>
    </Document>
  );
}
