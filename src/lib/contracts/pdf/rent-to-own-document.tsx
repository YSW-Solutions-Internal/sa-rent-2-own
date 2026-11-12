import { Document, Page, Text, View } from "@react-pdf/renderer";

import { BRAND } from "./brand";
import { formatCurrency, formatDate, formatKm, formatPercent, blank } from "./format";
import { AgreementFooter, AgreementHeader, ClauseSection, DataTable, SectionHeading, SignatureBlock, TwoColumn } from "./layout";
import { styles } from "./styles";
import type { AgreementData } from "./types";

const vehicleDescription = (v: AgreementData["vehicle"]) => [v.year, v.make, v.model].filter(Boolean).join(" ") || "_______________";

export function RentToOwnDocument({ data }: { data: AgreementData }) {
  const providerRows: [string, string][] = [
    ["Company name", "Silver Trio CC t/a SA Rent 2 Own"],
    ["Registration number", "2014/206712/07"],
    ["VAT number", "4670274002"],
    ["Registered address", "11-13 Republic Rd, Bordeaux, 2194"],
    ["Telephone number", "0768887100"],
  ];

  const renterRows: [string, string][] = [
    ["Full name", data.client.fullName],
    ["ID number", blank(data.client.idNumber)],
    ["Mobile number", data.client.cellNumber],
    ["Email address", blank(data.client.email)],
    ["Residential address", blank(data.client.address)],
  ];

  const vehicleRows: [string, string][] = [
    ["Registration number", blank(data.vehicle.regNumber)],
    ["Make & model", vehicleDescription(data.vehicle)],
    ["Colour", blank(data.vehicle.colour)],
    ["VIN", blank(data.vehicle.vin)],
    ["Engine number", blank(data.vehicle.engineNumber)],
    ["Current km reading", data.vehicle.currentMileage != null ? formatKm(data.vehicle.currentMileage) : "_______________"],
    ["Licence disc expiry", formatDate(data.vehicle.licenseDiscExpiry)],
  ];

  const contractRows: [string, string][] = [
    ["Product", blank(data.productName)],
    ["Term", data.termMonths != null ? `${data.termMonths} months` : "_______________"],
    ["Annual escalation", formatPercent(data.annualEscalationPct)],
    ["Start date", formatDate(data.startDate)],
    ["End date", formatDate(data.endDate)],
    ["Monthly instalment inc VAT", formatCurrency(data.installmentAmount)],
    ["Monthly km allowance", data.monthlyKmAllowance != null ? formatKm(data.monthlyKmAllowance) : "_______________"],
    ["Excess km billing rate", data.excessKmRate != null ? `${formatCurrency(data.excessKmRate)}/km` : "_______________"],
    ["Residual value", formatCurrency(data.residualValue)],
    ["Motor plan", blank(data.motorPlan)],
  ];

  const startupFeeRows: [string, string][] = [
    ["Account administration monthly fee", formatCurrency(data.startupFeeAccountAdminMonthly)],
    ["Credit bureau report fee", formatCurrency(data.startupFeeCreditBureau)],
    ["GPS tracking monthly fee", formatCurrency(data.startupFeeGpsMonthly)],
    ["GPS tracking unit & installation fee", formatCurrency(data.startupFeeGpsUnitInstallation)],
    ["Initiation fee", formatCurrency(data.startupFeeInitiation)],
    ["Pre-delivery valet fee", formatCurrency(data.startupFeePreDeliveryValet)],
    ["Registration and licence fee", formatCurrency(data.startupFeeRegistrationLicense)],
    ["Total startup fee inc VAT", formatCurrency(data.startupFeeTotal)],
    ["Expected end value inc VAT", formatCurrency(data.expectedEndValueIncVat)],
  ];

  return (
    <Document title={`Rent to Own Agreement${data.dealNumber ? ` - ${data.dealNumber}` : ""}`}>
      <Page size="A4" style={styles.page}>
        <AgreementHeader dealNumber={data.dealNumber} />
        <AgreementFooter generatedAt={data.generatedAt} />

        <Text style={styles.docTitle}>Rent to Own Agreement</Text>

        <SectionHeading>Rental Provider & Renter</SectionHeading>
        <TwoColumn left={<DataTable rows={providerRows} />} right={<DataTable rows={renterRows} />} />

        <TwoColumn
          left={
            <>
              <SectionHeading>Vehicle Description</SectionHeading>
              <DataTable rows={vehicleRows} />
            </>
          }
          right={
            <>
              <SectionHeading>Contract Details</SectionHeading>
              <DataTable rows={contractRows} />
            </>
          }
        />

        <SectionHeading>Startup Fee & Expected Value (inc VAT)</SectionHeading>
        <DataTable rows={startupFeeRows} />

        <View style={styles.signatureRow} wrap={false}>
          <SignatureBlock role="Rental provider" />
          <SignatureBlock role="Renter" />
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <AgreementHeader dealNumber={data.dealNumber} />
        <AgreementFooter generatedAt={data.generatedAt} />

        <Text style={styles.docTitle}>Terms and Conditions</Text>

        {data.clauses.map((clause) => {
          const isMandate = clause.heading === "Debit Order Mandate";
          return (
            <View key={clause.heading} style={isMandate ? { marginTop: 10, borderTopWidth: 0.5, borderTopColor: BRAND.greyLight, paddingTop: 8 } : undefined}>
              <ClauseSection clause={clause} />
            </View>
          );
        })}

        <View style={styles.signatureRow} wrap={false}>
          <SignatureBlock role="Account holder (debit order mandate)" />
          <SignatureBlock role="Witness" />
        </View>
      </Page>
    </Document>
  );
}
