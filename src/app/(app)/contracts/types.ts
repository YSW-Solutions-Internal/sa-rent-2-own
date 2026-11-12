import type {
  BillingDirection,
  BillingFrequency,
  BillingStatus,
  ContractStatus,
  ContractType,
  PaymentMethod,
} from "@/lib/database.types";

export interface ContractWithDetails {
  id: string;
  /** Display label of the current vehicle (file no · reg · year make model), when known. */
  vehicleLabel?: string;
  /** null = the vehicle was taken off and none has been put on yet. */
  vehicle_id: string | null;
  client_id: string;
  contract_type: ContractType;
  status: ContractStatus;
  start_date: string;
  end_date: string | null;
  payment_method: PaymentMethod;
  installment_amount: number | null;
  residual_value: number | null;
  total_collected: number;
  outstanding_balance: number;
  arrears_amount: number;
  is_paid_up: boolean;
  notes: string | null;
  deal_number: string | null;
  statement_tag: string | null;
  agreement_file_path: string | null;
  billing_day: number | null;
  billing_direction: BillingDirection;
  billing_frequency: BillingFrequency;
  billing_status: BillingStatus;
}

export interface ContractRow extends ContractWithDetails {
  vehicleLabel: string;
  clientName: string;
  clientBlacklisted: boolean;
}

export interface SelectableVehicle {
  id: string;
  label: string;
  /** Shown beside the car in pickers, e.g. "Sold" — it can still be chosen. */
  warning?: string;
}

export interface SelectableClient {
  id: string;
  label: string;
  blacklisted?: boolean;
}
