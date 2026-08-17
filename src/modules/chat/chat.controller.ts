import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { SendMessageDto } from './chat.dto';
import { ChatService } from './chat.service';

/**
 * Conversations between accounts.
 *
 * A thread is addressed by *who* it is with, not by an order — which is why
 * `:contactId` is a user id everywhere below. Chat used to hang off an order,
 * so a buyer needed a zero-value "enquiry" invented for them before they
 * could ask a question, and every new order started an empty conversation
 * beside the one that already had the messages in it.
 */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Get('threads')
  @ApiOperation({ summary: 'The caller’s conversations, most recent first' })
  async threads(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listThreads(user);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread messages across every conversation (badge)' })
  async unread(@CurrentUser() user: AuthUser): Promise<{ unreadCount: number }> {
    return this.service.unreadTotal(user);
  }

  @Get('order/:orderId/contact')
  @ApiOperation({ summary: 'Which account an order screen should open a chat with' })
  async contactForOrder(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
  ): Promise<{ contactId: string }> {
    return this.service.contactForOrder(user, orderId);
  }

  @Get('threads/:contactId')
  @ApiOperation({ summary: 'The conversation with one account (marks it read)' })
  async thread(
    @CurrentUser() user: AuthUser,
    @Param('contactId') contactId: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getThread(user, contactId);
  }

  @Post('threads/:contactId')
  @ApiOperation({ summary: 'Send a message to one account' })
  async send(
    @CurrentUser() user: AuthUser,
    @Param('contactId') contactId: string,
    @Body() dto: SendMessageDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.sendMessage(user, contactId, dto), 'Message sent');
  }
}
