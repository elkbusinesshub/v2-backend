import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { CreateOfferDto } from './offers.dto';
import { OffersService } from './offers.service';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OffersController {
  constructor(private readonly service: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'Reward points summary + active offer banners' })
  async list(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getOffersPage(user);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Add an offer banner (admin)' })
  async create(@Body() dto: CreateOfferDto): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.createOffer(dto), 'Offer created');
  }
}
