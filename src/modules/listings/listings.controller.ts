import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import type { AdDto } from '@/modules/marketplace/marketplace.dto';
import { CreateListingDto, ListingsQueryDto } from './listings.dto';
import { ListingsService } from './listings.service';

/**
 * Listing flow. Detail, edit, pause and delete are
 * `/marketplace/ads/:id`; photos are `POST /uploads/image`.
 */
@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Browse published listings by category, price, area and text' })
  async browse(@CurrentUser() user: AuthUser, @Query() query: ListingsQueryDto): Promise<AdDto[]> {
    return this.listings.browse(user, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Publish a listing to the marketplace' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateListingDto,
  ): Promise<ApiResponse<AdDto>> {
    return ApiResponse.of(await this.listings.create(user, dto), 'Listing published');
  }
}
