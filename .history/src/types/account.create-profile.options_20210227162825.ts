import { SrvRecord } from "dns";

export interface AccountCreateProfileOptions {
    is_secondary_account_creation?: boolean;
    tos_version?: string;
    suggestedUsername?: string;
    sn_result?: string;
    do_not_auto_login_if_credentials_match?: boolean;

    verification_code: string;
    phone_number: string;
    username: string;
    password: string;
    first_name: string;
    birthdate_day: number;
    birthdate_year: number;
    birthdate_day: number;
    biography: string;
    email: string;
  }