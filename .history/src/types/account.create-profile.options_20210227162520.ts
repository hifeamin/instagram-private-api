export interface AccountCreateProfileOptions {
    is_secondary_account_creation?: boolean;
    tos_version?: string;
    suggestedUsername?: string;
    username: string;
    first_name: string;
    biography: string;
    email: string;
  }