import type { BankAccountType } from "@/lib/database.types";

export interface ClientWithBanking {
  id: string;
  full_name: string;
  id_number: string | null;
  cell_number: string;
  alt_cell_number: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  blacklisted: boolean;
  blacklist_reason: string | null;
  banking: {
    id: string;
    bank_name: string;
    account_type: BankAccountType;
    branch_code: string | null;
    account_number_last4: string;
  } | null;
}
