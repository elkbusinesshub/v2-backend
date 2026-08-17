import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { OrdersService } from './orders.service';

/**
 * `/orders/:id/tracking` and `/orders/:id/cancel` — an "order" here is a
 * booking placed against a listing.
 *
 * Chat used to live here too, as `/orders/:id/chat`. It does not any more:
 * conversations are between accounts, so they are at `/chat/threads/:contactId`
 * and the tracking screen asks `/chat/order/:orderId/contact` for the person
 * to open one with.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get(':id/tracking')
  @ApiOperation({ summary: 'Order tracking timeline (derived from status)' })
  async tracking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getTracking(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an order' })
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ApiResponse<null>> {
    await this.service.cancelOrder(user, id);
    return ApiResponse.of(null, 'Order cancelled');
  }
}
