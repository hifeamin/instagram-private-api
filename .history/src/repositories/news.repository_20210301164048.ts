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
}
