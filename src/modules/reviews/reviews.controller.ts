import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { SubmitReviewDto } from './reviews.dto';
import { ReviewsService } from './reviews.service';

/** `/bookings/:id/review-target` and `/bookings/:id/reviews` — the exact paths `ReviewRepository` already calls. */
@ApiTags('reviews')
@ApiBearerAuth()
@Controller('bookings')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get(':id/review-target')
  @ApiOperation({ summary: 'Rating-screen context for a completed booking' })
  async reviewTarget(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getReviewTarget(user, id);
  }

  @Post(':id/reviews')
  @ApiOperation({ summary: 'Submit a rating + review for a completed booking' })
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SubmitReviewDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const result = await this.service.submitReview(user, id, dto);
    return ApiResponse.of(result, 'Thanks for your review');
  }
}
