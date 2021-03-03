import { Repository } from '../core/repository';
import { NewsRepositoryInboxResponseRootObject } from '../responses';

export class NewsRepository extends Repository {
  public async inbox(markAsSeen?: boolean): Promise<NewsRepositoryInboxResponseRootObject> {
    const { body } = await this.client.request.send<NewsRepositoryInboxResponseRootObject>({
      url: '/api/v1/news/inbox',
      method: 'GET',
      qs: {
        mark_as_seen: markAsSeen ?? false,
        timezone_offset: this.client.state.timezoneOffset,
      },
    });
    return body;
  }

  public async inboxSeen() {
    const { body } = await this.client.request.send({
      url: `/api/v1/news/inbox_seen/`,
      method: 'POST',
      form: {
        _csrftoken: this.client.state.cookieCsrfToken,
        _uuid: this.client.state.uuid,
      },
    });
    return body;
  }

  public async notificationsBadge(userId?: string | number) {
    const response = await this.client.request.send({
      url: `/api/v1/notifications/badge/`,
      method: 'POST',
      form: {
        phone_id: this.client.state.phoneId,
        _csrftoken: this.client.state.cookieCsrfToken,
        user_ids: userId ?? this.client.state.extractUserId(),
        device_id: this.client.state.deviceId,
        _uuid: this.client.state.uuid,
      },
    });
    return body;
  }
}
