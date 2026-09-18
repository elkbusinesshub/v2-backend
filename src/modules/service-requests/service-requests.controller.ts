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
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import {
  AcceptRequestDto,
  CreateCleaningRequestDto,
  CreateRentalRequestDto,
  RequestListQueryDto,
  VerifyOtpDto,
} from './service-requests.dto';
import { ServiceRequestsService } from './service-requests.service';

type Json = Record<string, unknown>;

/** Literal paths are declared before `:id` so the parameter does not swallow them. */
@ApiTags('service-requests')
@ApiBearerAuth()
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Districts, cleaning service types, vehicle types' })
  catalog(): Json {
    return this.requests.catalog();
  }

  @Post('cleaning')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request cleaning; a partner in the district is assigned' })
  async createCleaning(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCleaningRequestDto,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.createCleaning(user, dto), 'Request sent');
  }

  @Post('rental')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a vehicle; the nearest shop with one free is assigned' })
  async createRental(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRentalRequestDto,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.createRental(user, dto), 'Request sent');
  }

  @Get('mine')
  @ApiOperation({ summary: "The caller's requests as a buyer" })
  async mine(@CurrentUser() user: AuthUser, @Query() query: RequestListQueryDto): Promise<Json[]> {
    return this.requests.listMine(user, query);
  }

  @Get('incoming')
  @ApiOperation({ summary: 'Requests assigned to the caller as a partner' })
  async incoming(
    @CurrentUser() user: AuthUser,
    @Query() query: RequestListQueryDto,
  ): Promise<Json[]> {
    return this.requests.listIncoming(user, query);
  }

  @Get('staff-jobs')
  @ApiOperation({ summary: "Live jobs the caller can work as a partner's staff" })
  async staffJobs(@CurrentUser() user: AuthUser): Promise<Json[]> {
    return this.requests.listStaffJobs(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One request, as the buyer, partner or staff sees it' })
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Json> {
    return this.requests.detail(user, id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ask again after a decline, skipping partners who declined' })
  async retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.retry(user, id), 'Request sent');
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.cancel(user, id), 'Request cancelled');
  }

  @Post(':id/new-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buyer: replace the OTP and reset wrong attempts' })
  async newCode(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.newCode(user, id), 'New code ready');
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptRequestDto,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.accept(user, id, dto), 'Request accepted');
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.decline(user, id), 'Request declined');
  }

  @Post(':id/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Partner or staff: check the buyer's code and start" })
  async verifyOtp(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyOtpDto,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.verifyOtp(user, id, dto.otpCode), 'Code matched');
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Json>> {
    return ApiResponse.of(await this.requests.complete(user, id), 'Completed');
  }
}
