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
import { ApprovalsQueryDto, ProfessionalApprovalDto, RejectChangeDto } from './admin.dto';
import { ProfessionalApprovalsService } from './professional-approvals.service';

/** The super admin approves or rejects the professionals companies add. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserType.SUPER_ADMIN)
@Controller('admin/approvals/professionals')
export class ProfessionalApprovalsController {
  constructor(private readonly approvals: ProfessionalApprovalsService) {}

  @Get()
  @ApiOperation({ summary: 'Professionals waiting (view=pending) or decided (view=decided)' })
  async list(@Query() query: ApprovalsQueryDto): Promise<ApiResponse<ProfessionalApprovalDto[]>> {
    const { items, meta } = await this.approvals.list(query);
    return ApiResponse.of(items, 'OK', meta);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve: the company can now assign this professional' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ProfessionalApprovalDto> {
    return this.approvals.approve(id, user.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject, with a reason the company sees' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectChangeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProfessionalApprovalDto> {
    return this.approvals.reject(id, user.id, dto.note);
  }
}
