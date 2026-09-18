import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { AddStaffDto, UpdateCleaningSetupDto, UpdateRentalSetupDto } from './service-requests.dto';
import { PartnerSetupService } from './partner-setup.service';

type Json = Record<string, unknown>;

@ApiTags('partner-setup')
@ApiBearerAuth()
@Controller('partner-setup')
export class PartnerSetupController {
  constructor(private readonly setup: PartnerSetupService) {}

  @Get()
  @ApiOperation({ summary: "The caller's cleaning and rental offer" })
  async get(@CurrentUser() user: AuthUser): Promise<Json> {
    return this.setup.get(user);
  }

  @Patch('cleaning')
  async updateCleaning(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCleaningSetupDto,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.setup.updateCleaning(user, dto), 'Cleaning setup saved');
  }

  @Patch('rental')
  async updateRental(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateRentalSetupDto,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.setup.updateRental(user, dto), 'Rental setup saved');
  }

  @Get('staff')
  async listStaff(@CurrentUser() user: AuthUser): Promise<Json[]> {
    return this.setup.listStaff(user);
  }

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  async addStaff(
    @CurrentUser() user: AuthUser,
    @Body() dto: AddStaffDto,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.setup.addStaff(user, dto), 'Staff added');
  }

  @Delete('staff/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStaff(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.setup.removeStaff(user, id);
  }

  @Get('staff-of')
  @ApiOperation({ summary: 'Partners the caller works for as staff' })
  async staffOf(@CurrentUser() user: AuthUser): Promise<Json[]> {
    return this.setup.staffOf(user);
  }
}
