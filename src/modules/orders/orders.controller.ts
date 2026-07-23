import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { SendMessageDto } from './orders.dto';
import { OrdersService } from './orders.service';

/**
 * `/orders/:id/chat`, `/orders/:id/tracking`, `/orders/:id/cancel` — the
 * exact paths ChatRepository / TrackingRepository already call. An "order"
 * is a home-services booking (referenced by its id).
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get(':id/chat')
  @ApiOperation({ summary: 'Chat thread for an order' })
  async chatThread(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getThread(user, id);
  }

  @Post(':id/chat')
  @ApiOperation({ summary: 'Send a message (persisted + broadcast over /chat)' })
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.sendMessage(user, id, dto), 'Message sent');
  }

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
