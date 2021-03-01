export interface AccountCreateProfileOptions {
    is_secondary_account_creation?: boolean;
    tos_version?: string;
    suggestedUsername?: string;
    sn_result?: string;
    do_not_auto_login_if_credentials_match?: boolean;
    verification_code: string;
    username: string;
    first_name: string;
    biography: string;
    email: string;
  }