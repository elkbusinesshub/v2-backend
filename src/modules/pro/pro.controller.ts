import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import type { ServiceBookingDto } from '@/modules/home-services/home-services.dto';
import { JobsQueryDto, ProProfileDto, UpdateDutyDto } from './pro.dto';
import { ProService } from './pro.service';

/**
 * The professional's screens in the app. Open to any signed-in user; the
 * service refuses (403) anyone who is not linked to a professional.
 */
@ApiTags('pro')
@ApiBearerAuth()
@Controller('pro')
export class ProController {
  constructor(private readonly service: ProService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in professional, with job counts' })
  async me(@CurrentUser() user: AuthUser): Promise<ProProfileDto> {
    return this.service.profile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Go on or off duty' })
  async setDuty(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateDutyDto,
  ): Promise<ApiResponse<ProProfileDto>> {
    const pro = await this.service.setDuty(user.id, dto.onDuty);
    return ApiResponse.of(pro, dto.onDuty ? 'You are on duty' : 'You are off duty');
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Your jobs: today (default), upcoming, or done' })
  async jobs(
    @CurrentUser() user: AuthUser,
    @Query() query: JobsQueryDto,
  ): Promise<ServiceBookingDto[]> {
    return this.service.jobs(user.id, query.view ?? 'today');
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'One of your jobs' })
  async job(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceBookingDto> {
    return this.service.job(user.id, id);
  }

  @Post('jobs/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a confirmed job on its day' })
  async start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<ServiceBookingDto>> {
    return ApiResponse.of(await this.service.start(user.id, id), 'Job started');
  }

  @Post('jobs/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a job in progress as done' })
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<ServiceBookingDto>> {
    return ApiResponse.of(await this.service.complete(user.id, id), 'Job done');
  }
}
