import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { AdDto, AdListQueryDto, TopSellersQueryDto } from './marketplace.dto';
import { MarketplaceService } from './marketplace.service';

/**
 * Seller ads and the engagement ranking behind "Best sellers".
 *
 * `top-sellers` is declared before `ads/:id` — Nest matches in declaration
 * order, and a bare `:id` route would otherwise swallow it.
 */
@ApiTags('marketplace')
@ApiBearerAuth()
@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('top-sellers')
  @ApiOperation({ summary: 'Ads ranked by engagement (wishlists, then views)' })
  async topSellers(
    @CurrentUser() user: AuthUser,
    @Query() query: TopSellersQueryDto,
  ): Promise<AdDto[]> {
    return this.marketplace.topSellers(user.id, query.limit, query.category);
  }

  @Get('ads')
  @ApiOperation({ summary: 'Browse or search ads' })
  async list(@CurrentUser() user: AuthUser, @Query() query: AdListQueryDto): Promise<AdDto[]> {
    return this.marketplace.list(user.id, {
      categorySlug: query.category,
      query: query.q,
      limit: query.limit,
    });
  }

  @Get('ads/:id')
  @ApiOperation({ summary: "One ad; records the caller's view (once per user)" })
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AdDto> {
    return this.marketplace.detail(id, user.id);
  }

  @Post('ads/:id/wishlist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save an ad' })
  async wishlist(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ isWishlisted: boolean; wishlistCount: number }>> {
    return ApiResponse.of(await this.marketplace.setWishlisted(id, user.id, true), 'Saved');
  }

  @Delete('ads/:id/wishlist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an ad from the wishlist' })
  async unwishlist(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ isWishlisted: boolean; wishlistCount: number }>> {
    return ApiResponse.of(await this.marketplace.setWishlisted(id, user.id, false), 'Removed');
  }
}
