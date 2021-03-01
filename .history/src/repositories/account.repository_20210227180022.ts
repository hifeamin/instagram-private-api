import { Repository } from '../core/repository';
import {
  AccountRepositoryCurrentUserResponseRootObject,
  AccountRepositoryLoginErrorResponse,
  AccountRepositoryLoginResponseLogged_in_user,
  AccountRepositoryLoginResponseRootObject,
  SpamResponse,
  StatusResponse,
} from '../responses';
import {
  IgLoginBadPasswordError,
  IgLoginInvalidUserError,
  IgLoginTwoFactorRequiredError,
  IgResponseError,
} from '../errors';
import { IgResponse, AccountEditProfileOptions, AccountTwoFactorLoginOptions } from '../types';
import { defaultsDeep } from 'lodash';
import { IgSignupBlockError } from '../errors/ig-signup-block.error';
import Bluebird = require('bluebird');
import debug from 'debug';
import * as crypto from 'crypto';
import { AccountCreateProfileOptions } from 'src/types/account.create-profile.options';

export class AccountRepository extends Repository {
  private static accountDebug = debug('ig:account');
  public async login(username: string, password: string): Promise<AccountRepositoryLoginResponseLogged_in_user> {
    if (!this.client.state.passwordEncryptionPubKey) {
      await this.client.qe.syncLoginExperiments();
    }
    const {encrypted, time} = this.encryptPassword(password);
    const response = await Bluebird.try(() =>
      this.client.request.send<AccountRepositoryLoginResponseRootObject>({
        method: 'POST',
        url: '/api/v1/accounts/login/',
        form: this.client.request.sign({
          username,
          password,
          enc_password: `#PWD_INSTAGRAM:4:${time}:${encrypted}`,
          guid: this.client.state.uuid,
          phone_id: this.client.state.phoneId,
          _csrftoken: this.client.state.cookieCsrfToken,
          device_id: this.client.state.deviceId,
          adid: '' /*this.client.state.adid ? not set on pre-login*/,
          google_tokens: '[]',
          login_attempt_count: 0,
          country_codes: JSON.stringify([{ country_code: '1', source: 'default' }]),
          jazoest: AccountRepository.createJazoest(this.client.state.phoneId),
        }),
      }),
    ).catch(IgResponseError, error => {
      if (error.response.body.two_factor_required) {
        AccountRepository.accountDebug(
          `Login failed, two factor auth required: ${JSON.stringify(error.response.body.two_factor_info)}`,
        );
        throw new IgLoginTwoFactorRequiredError(error.response as IgResponse<AccountRepositoryLoginErrorResponse>);
      }
      switch (error.response.body.error_type) {
        case 'bad_password': {
          throw new IgLoginBadPasswordError(error.response as IgResponse<AccountRepositoryLoginErrorResponse>);
        }
        case 'invalid_user': {
          throw new IgLoginInvalidUserError(error.response as IgResponse<AccountRepositoryLoginErrorResponse>);
        }
        default: {
          throw error;
        }
      }
    });
    return response.body.logged_in_user;
  }

  public static createJazoest(input: string): string {
    const buf = Buffer.from(input, 'ascii');
    let sum = 0;
    for (let i = 0; i < buf.byteLength; i++) {
      sum += buf.readUInt8(i);
    }
    return `2${sum}`;
  }

  public encryptPassword(password: string): { time: string, encrypted: string } {
    const randKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const rsaEncrypted = crypto.publicEncrypt({
      key: Buffer.from(this.client.state.passwordEncryptionPubKey, 'base64').toString(),
      // @ts-ignore
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }, randKey);
    const cipher = crypto.createCipheriv('aes-256-gcm', randKey, iv);
    const time = Math.floor(Date.now() / 1000).toString();
    cipher.setAAD(Buffer.from(time));
    const aesEncrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    const sizeBuffer = Buffer.alloc(2, 0);
    sizeBuffer.writeInt16LE(rsaEncrypted.byteLength, 0);
    const authTag = cipher.getAuthTag();
    return {
      time,
      encrypted: Buffer.concat([
        Buffer.from([1, this.client.state.passwordEncryptionKeyId]),
        iv,
        sizeBuffer,
        rsaEncrypted, authTag, aesEncrypted])
        .toString('base64'),
    };
  }

  public async twoFactorLogin(
    options: AccountTwoFactorLoginOptions,
  ): Promise<AccountRepositoryLoginResponseLogged_in_user> {
    options = defaultsDeep(options, {
      trustThisDevice: '1',
      verificationMethod: '1',
    });
    const { body } = await this.client.request.send<AccountRepositoryLoginResponseLogged_in_user>({
      url: '/api/v1/accounts/two_factor_login/',
      method: 'POST',
      form: this.client.request.sign({
        verification_code: options.verificationCode,
        _csrftoken: this.client.state.cookieCsrfToken,
        two_factor_identifier: options.twoFactorIdentifier,
        username: options.username,
        trust_this_device: options.trustThisDevice,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
        verification_method: options.verificationMethod,
      }),
    });
    return body;
  }

  public async logout() {
    const { body } = await this.client.request.send<StatusResponse>({
      method: 'POST',
      url: '/api/v1/accounts/logout/',
      form: {
        guid: this.client.state.uuid,
        phone_id: this.client.state.phoneId,
        _csrftoken: this.client.state.cookieCsrfToken,
        device_id: this.client.state.deviceId,
        _uuid: this.client.state.uuid,
      },
    });
    return body;
  }

  async create({ username, password, email, first_name }) {
    const { body } = await Bluebird.try(() =>
      this.client.request.send({
        method: 'POST',
        url: '/api/v1/accounts/create/',
        form: this.client.request.sign({
          username,
          password,
          email,
          first_name,
          guid: this.client.state.uuid,
          device_id: this.client.state.deviceId,
          _csrftoken: this.client.state.cookieCsrfToken,
          force_sign_up_code: '',
          qs_stamp: '',
          waterfall_id: this.client.state.uuid,
          sn_nonce: '',
          sn_result: '',
        }),
      }),
    ).catch(IgResponseError, error => {
      switch (error.response.body.error_type) {
        case 'signup_block': {
          AccountRepository.accountDebug('Signup failed');
          throw new IgSignupBlockError(error.response as IgResponse<SpamResponse>);
        }
        default: {
          throw error;
        }
      }
    });
    return body;
  }

  public async currentUser() {
    const { body } = await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>({
      url: '/api/v1/accounts/current_user/',
      qs: {
        edit: true,
      },
    });
    return body.user;
  }

  public async setBiography(text: string) {
    const { body } = await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>({
      url: '/api/v1/accounts/set_biography/',
      method: 'POST',
      form: this.client.request.sign({
        _csrftoken: this.client.state.cookieCsrfToken,
        _uid: this.client.state.cookieUserId,
        device_id: this.client.state.deviceId,
        _uuid: this.client.state.uuid,
        raw_text: text,
      }),
    });
    return body.user;
  }

  public async changeProfilePicture(picture: Buffer): Promise<AccountRepositoryCurrentUserResponseRootObject> {
    const uploadId = Date.now().toString();
    await this.client.upload.photo({
      file: picture,
      uploadId,
    });
    const { body } = await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>({
      url: '/api/v1/accounts/change_profile_picture/',
      method: 'POST',
      form: {
        _csrftoken: this.client.state.cookieCsrfToken,
        _uuid: this.client.state.uuid,
        use_fbuploader: true,
        upload_id: uploadId,
      },
    });
    return body;
  }

  public async editProfile(options: AccountEditProfileOptions) {
    const { body } = await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>({
      url: '/api/v1/accounts/edit_profile/',
      method: 'POST',
      form: this.client.request.sign({
        ...options,
        _csrftoken: this.client.state.cookieCsrfToken,
        _uid: this.client.state.cookieUserId,
        device_id: this.client.state.deviceId,
        _uuid: this.client.state.uuid,
      }),
    });
    return body.user;
  }

  public async changePassword(oldPassword: string, newPassword: string) {
    const { body } = await this.client.request.send({
      url: '/api/v1/accounts/change_password/',
      method: 'POST',
      form: this.client.request.sign({
        _csrftoken: this.client.state.cookieCsrfToken,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
        old_password: oldPassword,
        new_password1: newPassword,
        new_password2: newPassword,
      }),
    });
    return body;
  }

  public async removeProfilePicture() {
    return this.command('remove_profile_picture');
  }

  public async setPrivate() {
    return this.command('set_private');
  }

  public async setPublic() {
    return this.command('set_public');
  }

  private async command(command: string): Promise<AccountRepositoryCurrentUserResponseRootObject> {
    const { body } = await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>({
      url: `/api/v1/accounts/${command}/`,
      method: 'POST',
      form: this.client.request.sign({
        _csrftoken: this.client.state.cookieCsrfToken,
        _uid: this.client.state.cookieUserId,
        _uuid: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async readMsisdnHeader(usage = 'default') {
    const { body } = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/read_msisdn_header/',
      headers: {
        'X-DEVICE-ID': this.client.state.uuid,
      },
      form: this.client.request.sign({
        mobile_subno_usage: usage,
        device_id: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async msisdnHeaderBootstrap(usage = 'default') {
    const { body } = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/msisdn_header_bootstrap/',
      form: this.client.request.sign({
        mobile_subno_usage: usage,
        device_id: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async contactPointPrefill(usage = 'default') {
    const { body } = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/contact_point_prefill/',
      form: this.client.request.sign({
        mobile_subno_usage: usage,
        device_id: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async getPrefillCandidates() {
    const { body } = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/get_prefill_candidates/',
      form: this.client.request.sign({
        android_device_id: this.client.state.deviceId,
        usages: '["account_recovery_omnibox"]',
        device_id: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async processContactPointSignals() {
    const { body } = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/accounts/process_contact_point_signals/',
      form: this.client.request.sign({
        phone_id: this.client.state.phoneId,
        _csrftoken: this.client.state.cookieCsrfToken,
        _uid: this.client.state.cookieUserId,
        device_id: this.client.state.uuid,
        _uuid: this.client.state.uuid,
        google_tokens: '[]',
      }),
    });
    return body;
  }

  public async sendRecoveryFlowEmail(query: string) {
    const { body } = await this.client.request.send({
      url: '/api/v1/accounts/send_recovery_flow_email/',
      method: 'POST',
      form: this.client.request.sign({
        _csrftoken: this.client.state.cookieCsrfToken,
        adid: '' /*this.client.state.adid ? not available on pre-login?*/,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
        query,
      }),
    });
    return body;
  }

  public async checkPhoneNumber(phoneNumber: string) {
    const { body } = await this.client.request.send({
      url: '/api/v1/accounts/check_phone_number/',
      method: 'POST',
      form: this.client.request.sign({
        phone_id: this.client.state.phoneId,
        login_nonce_map: '{}',
        phone_number: phoneNumber,
        _csrftoken: this.client.state.cookieCsrfToken,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
        prefill_shown: false,
      }),
    });
    return body;
  }

  public async sendSignupSmsCode(phoneNumber: string) {
    const { body } = await this.client.request.send({
      url: '/api/v1/accounts/send_signup_sms_code/',
      method: 'POST',
      form: this.client.request.sign({
        phone_id: this.client.state.phoneId,
        phone_number: phoneNumber,
        _csrftoken: this.client.state.cookieCsrfToken,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
        android_build_type: 'release',
        waterfall_id: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async validateSignupSmsCode(phoneNumber: string, verificationCode: string) {
    const { body } = await this.client.request.send({
      url: '/api/v1/accounts/validate_signup_sms_code/',
      method: 'POST',
      form: this.client.request.sign({
        verification_code: verificationCode,
        phone_number: phoneNumber,
        _csrftoken: this.client.state.cookieCsrfToken,
        guid: this.client.state.uuid,
        device_id: this.client.state.deviceId,
        waterfall_id: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async fetchHeaders(challengeType: string) {
    const { body } = await this.client.request.send({
      url: '/api/v1/si/fetch_headers/',
      method: 'GET',
      qs: {
        guid: this.client.state.uuid,
        challenge_type: challengeType,
      },
    });
    return body;
  }

  public async usernameSuggestions(userName: string) {
    const { body } = await this.client.request.send({
      url: '/api/v1/accounts/username_suggestions/',
      method: 'POST',
      form: this.client.request.sign({
        phone_id: this.client.state.phoneId,
        _csrftoken: this.client.state.cookieCsrfToken,
        guid: this.client.state.uuid,
        name: userName,
        device_id: this.client.state.deviceId,
        email: '',
        waterfall_id: this.client.state.uuid,
      }),
    });
    return body;
  }

  public async checkAgeEligibility(day: number, year: number, month: number) {
    const { body } = await this.client.request.send({
      url: '/api/v1/consent/check_age_eligibility/',
      method: 'POST',
      form: {
        _csrftoken: this.client.state.cookieCsrfToken,
        day,
        year,
        month,
      },
    });
    return body;
  }

  public async newUserFlowBegins() {
    const { body } = await this.client.request.send({
      url: '/api/v1/consent/new_user_flow_begins/',
      method: 'POST',
      form: this.client.request.sign({
        _csrftoken: this.client.state.cookieCsrfToken,
        device_id: this.client.state.deviceId,
      }),
    });
    return body;
  }

  public async dynamicOnboarding() {
    const { body } = await this.client.request.send({
      url: '/api/v1/dynamic_onboarding/get_steps/',
      method: 'POST',
      form: this.client.request.sign({
        is_secondary_account_creation: false,
        fb_connected: false,
        // tslint:disable-next-line:max-line-length
        seen_steps: '[{"step_name":"CHECK_FOR_PHONE","value":1},{"step_name":"CREATE_PASSWORD","value":-1},{"step_name":"FB_CONNECT","value":0},{"step_name":"FB_FOLLOW","value":-1},{"step_name":"UNKNOWN","value":-1},{"step_name":"CONTACT_INVITE","value":-1},{"step_name":"ACCOUNT_PRIVACY","value":-1},{"step_name":"TAKE_PROFILE_PHOTO","value":1},{"step_name":"ADD_PHONE","value":-1},{"step_name":"TURN_ON_ONETAP","value":-1},{"step_name":"DISCOVER_PEOPLE","value":1},{"step_name":"INTEREST_ACCOUNT_SUGGESTIONS","value":-1}]',
        progress_state: 'finish',
        phone_id: this.client.state.phoneId,
        fb_installed: false,
        locale: this.client.state.language,
        timezone_offset: this.client.state.timezoneOffset,
        network_type: this.client.state.radioType,
        guid: this.client.state.uuid,
        is_ci: false,
        android_id: this.client.state.deviceId,
        waterfall_id: this.client.state.uuid,
        reg_flow_taken: 'phone',
        tos_accepted: true,
      }),
    });
    return body;
  }

  public async createValidated(options: AccountCreateProfileOptions) {
    const {encrypted, time} = this.encryptPassword(options.password);
    const { body } = await this.client.request.send({
      url: '/api/v1/accounts/create_validated/',
      method: 'POST',
      form: this.client.request.sign({
        is_secondary_account_creation: options.is_secondary_account_creation ?? false,
        jazoest: AccountRepository.createJazoest(this.client.state.phoneId),
        tos_version: options.tos_version ?? 'row',
        suggestedUsername: options.suggestedUsername ?? '',
        verification_code: options.verification_code,
        sn_result: options.sn_result ?? 'API_ERROR:+class+X.868:7:+',
        do_not_auto_login_if_credentials_match: options.do_not_auto_login_if_credentials_match ?? true,
        phone_id: this.client.state.phoneId,
        enc_password: `#PWD_INSTAGRAM:4:${time}:${encrypted}`,
        phone_number: options.phone_number,
        _csrftoken: this.client.state.cookieCsrfToken,
        username: options.username,
        first_name: options.first_name,
        day: options.birthdate_day,
        adid: this.client.state.adid,
        guid: this.client.state.uuid,
        year: options.birthdate_year,
        device_id: this.client.state.deviceId,
        _uuid: this.client.state.deviceId,
        month: options.birthdate_month,
        sn_nonce: options.sn_nonce ?? 'Kzg2MTY1NzE3NDEyMzB8MTU5MDQ0MTUxM3xT2X15QlksJZGXppRcPQiVG3FuzdH390w=',
        force_sign_up_code: options.force_sign_up_code ?? '',
        waterfall_id: this.client.state.uuid,
        qs_stamp: options.qs_stamp ?? '',
        has_sms_consent: options.has_sms_consent ?? true,
      }),
    });
    return body;
  }

  public async getAccountFamily() {
    const { body } = await this.client.request.send({
      baseUrl: 'https://b.i.instagram.com/',
      url: '/api/v1/multiple_accounts/get_account_family/',
      method: 'GET',
    });
    return body;
  }

  public async newAccountNuxSeen() {
    const { body } = await this.client.request.send({
      url: '/api/v1/nux/new_account_nux_seen/',
      method: 'POST',
      form: {
        device_type: 'android_fcm',
        is_main_push_channel: true,
        device_sub_type: 0,
        // tslint:disable-next-line:max-line-length
        device_token: 'dYJKzd30nm8%3AAPA91bE1kDVJJg_YhVxPCgho3Z2Wtq64_kTm2Qo4mnmwg6UQHeYYRzp6XZ6Yo199S2nOTAccCxlVbBw5cKD0PjwMQ_kwlDWMQ-owdXVmKmi0DaR7BrlIQ2GzCZ6E3tkJiqC-GETRsfeZ',
        _csrftoken: this.client.state.cookieCsrfToken,
        guid: this.client.state.uuid,
        _uuid: this.client.state.uuid,
        users: this.client.state.extractUserId(),
        family_device_id: '2e4f9e63-6c3d-494e-9e4d-18aa5dc21171',
      },
    });
    return body;
  }

  public async fbEntrypointInfo() {
    const { body } = await this.client.request.send({
      url: '/api/v1/fb/fb_entrypoint_info/',
      method: 'GET',
    });
    return body;
  }

  public async banyan(viewsParam) {
    const { body } = await this.client.request.send({
      url: '/api/v1/banyan/banyan/',
      method: 'GET',
      qs: {
        // tslint:disable-next-line:max-line-length
        views: viewsParam ?? '["story_share_sheet","direct_user_search_nullstate","forwarding_recipient_sheet","threads_people_picker","direct_inbox_active_now","group_stories_share_sheet","reshare_share_sheet","direct_user_search_keypressed"]',
      },
    });
    return body;
  }
}
