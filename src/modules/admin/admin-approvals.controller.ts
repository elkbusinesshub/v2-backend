import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserType } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { AdminApprovalsService } from './admin-approvals.service';
import {
  ApprovalsQueryDto,
  ApprovalsSummaryDto,
  RejectChangeDto,
  ServiceChangeDto,
} from './admin.dto';

/** The super admin's approvals screens. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserType.SUPER_ADMIN)
@Controller('admin/approvals')
export class AdminApprovalsController {
  constructor(private readonly approvals: AdminApprovalsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Waiting requests: all, new services, price or duration changes' })
  async summary(): Promise<ApprovalsSummaryDto> {
    return this.approvals.summary();
  }

  @Get()
  @ApiOperation({ summary: 'Waiting requests (view=pending) or decision history (view=decided)' })
  async list(@Query() query: ApprovalsQueryDto): Promise<ApiResponse<ServiceChangeDto[]>> {
    const { items, meta } = await this.approvals.list(query);
    return ApiResponse.of(items, 'OK', meta);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve: the new price goes live, or the new service shows in the app',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ServiceChangeDto> {
    return this.approvals.approve(id, user.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject: the app keeps its price; a new service is deleted' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectChangeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ServiceChangeDto> {
    return this.approvals.reject(id, user.id, dto.note);
  }
}
