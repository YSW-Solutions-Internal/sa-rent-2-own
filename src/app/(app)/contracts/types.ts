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
  vehicle_id: string;
  client_id: string;
  contract_type: ContractType;
  status: ContractStatus;
  start_date: string;
  end_date: string | null;
  payment_method: PaymentMethod;
  installment_amount: number | null;
  purchase_price: number | null;
  potential_sale_price: number | null;
  sale_price: number | null;
  residual_value: number | null;
  total_collected: number;
  outstanding_balance: number;
  arrears_amount: number;
  is_paid_up: boolean;
  notes: string | null;
  deal_number: string | null;
  statement_tag: string | null;
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
}

export interface SelectableClient {
  id: string;
  label: string;
  blacklisted?: boolean;
}
