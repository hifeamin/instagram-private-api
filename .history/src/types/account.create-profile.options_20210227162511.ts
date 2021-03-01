export interface AccountCreateProfileOptions {
    is_secondary_account_creation?: boolean;
    tos_version?: string;
    phone_number: string;
    username: string;
    first_name: string;
    biography: string;
    email: string;
  }