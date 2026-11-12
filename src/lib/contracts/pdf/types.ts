export type AgreementCategory = "rent_to_own" | "rental";

export interface AgreementClause {
  heading: string;
  body: string;
}

export interface AgreementClient {
  fullName: string;
  idNumber: string | null;
  cellNumber: string;
  email: string | null;
  address: string | null;
}

export interface AgreementVehicle {
  fileNo: string;
  regNumber: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  vin: string | null;
  engineNumber: string | null;
  currentMileage: number | null;
  licenseDiscExpiry: string | null;
}

export interface AgreementData {
  category: AgreementCategory;
  contractTypeLabel: string;
  dealNumber: string | null;
  startDate: string;
  endDate: string | null;
  termMonths: number | null;
  installmentAmount: number | null;
  residualValue: number | null;
  annualEscalationPct: number | null;
  startupFeeTotal: number | null;
  startupFeeAccountAdminMonthly: number | null;
  startupFeeCreditBureau: number | null;
  startupFeeGpsMonthly: number | null;
  startupFeeGpsUnitInstallation: number | null;
  startupFeeInitiation: number | null;
  startupFeePreDeliveryValet: number | null;
  startupFeeRegistrationLicense: number | null;
  monthlyKmAllowance: number | null;
  excessKmRate: number | null;
  motorPlan: string | null;
  productName: string | null;
  expectedEndValueIncVat: number | null;
  client: AgreementClient;
  vehicle: AgreementVehicle;
  clauses: AgreementClause[];
  generatedAt: string;
}
