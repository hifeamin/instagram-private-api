import { Expose } from 'class-transformer';
import { Feed } from '../core/feed';
import { MediaCommentsFeedResponse, MediaCommentsFeedResponseCommentsItem } from '../responses/';

export class MediaCommentsFeed extends Feed<MediaCommentsFeedResponse, MediaCommentsFeedResponseCommentsItem> {
  id: string;
  canSupportThreading: boolean = true;
  carouselIndex: number = 0;
  analyticsModule: string = 'comments_v2_feed_contextual_profile';
  isCarouselBumpedPost: boolean = false;
  feedPosition: number = 0;
  @Expose()
  private nextMaxId: string;
  @Expose()
  private nextMinId: string;

  set state(body: MediaCommentsFeedResponse) {
    this.moreAvailable = !!body.next_max_id || !!body.next_min_id;
    this.nextMaxId = body.next_max_id;
    this.nextMinId = body.next_min_id;
  }

  async request() {
    const { body } = await this.client.request.send<MediaCommentsFeedResponse>({
      url: `/api/v1/media/${this.id}/comments/`,
      qs: {
        can_support_threading: this.canSupportThreading,
        max_id: this.nextMaxId,
        min_id: this.nextMinId,
        carousel_index: this.carouselIndex,
        analytics_module: this.analyticsModule,
        is_carousel_bumped_post: this.isCarouselBumpedPost,
        feed_position: this.feedPosition,
      },
    });
    this.state = body;
    return body;
  }

  async items() {
    const response = await this.request();
    return response.comments;
  }
}
