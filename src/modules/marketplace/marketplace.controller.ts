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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import {
  AdDto,
  AdListQueryDto,
  AdOrderDto,
  AdOrdersQueryDto,
  CreateAdOrderDto,
  CreateAdDto,
  MyAdsQueryDto,
  TopSellersQueryDto,
  UpdateAdDto,
  UpdateAdOrderStatusDto,
} from './marketplace.dto';
import { AdOrdersService } from './ad-orders.service';
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
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly orders: AdOrdersService,
  ) {}

  @Get('top-sellers')
  @ApiOperation({ summary: 'Ads ranked by engagement (wishlists, then views)' })
  async topSellers(
    @CurrentUser() user: AuthUser,
    @Query() query: TopSellersQueryDto,
  ): Promise<AdDto[]> {
    return this.marketplace.topSellers(user.id, query.limit, query.category);
  }

  @Get('my-ads')
  @ApiOperation({ summary: "The caller's own listings, drafts and paused included" })
  async myAds(@CurrentUser() user: AuthUser, @Query() query: MyAdsQueryDto): Promise<AdDto[]> {
    return this.marketplace.myAds(user, query.status);
  }

  // ─── orders ───────────────────────────────────────────────────────────────
  // Declared before `ads/:id` for the same reason `my-ads` is: literal
  // segments must not be shadowed by a parameterised sibling.

  @Get('seller-orders')
  @ApiOperation({ summary: "Orders placed against the caller's listings" })
  async sellerOrders(
    @CurrentUser() user: AuthUser,
    @Query() query: AdOrdersQueryDto,
  ): Promise<AdOrderDto[]> {
    return this.orders.listForSeller(user, query.status);
  }

  @Get('seller-orders/counts')
  @ApiOperation({ summary: 'Per-status tallies for the seller order tabs' })
  async sellerOrderCounts(@CurrentUser() user: AuthUser): Promise<Record<string, number>> {
    return this.orders.countsForSeller(user);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Orders the caller has placed' })
  async myOrders(
    @CurrentUser() user: AuthUser,
    @Query() query: AdOrdersQueryDto,
  ): Promise<AdOrderDto[]> {
    return this.orders.listForBuyer(user, query.status);
  }

  @Patch('orders/:id/status')
  @ApiOperation({ summary: 'Advance or cancel an order' })
  async setOrderStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdOrderStatusDto,
  ): Promise<ApiResponse<AdOrderDto>> {
    return ApiResponse.of(await this.orders.setStatus(user, id, dto.status), 'Order updated');
  }

  @Post('ads/:id/orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place an order against a listing' })
  async placeOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAdOrderDto,
  ): Promise<ApiResponse<AdOrderDto>> {
    return ApiResponse.of(await this.orders.place(user, id, dto), 'Order placed');
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
  // ─── seller-owned writes ──────────────────────────────────────────────────

  @Post('ads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a listing (status DRAFT or ACTIVE)' })
  async createAd(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAdDto,
  ): Promise<ApiResponse<AdDto>> {
    return ApiResponse.of(await this.marketplace.create(user, dto), 'Listing created');
  }

  @Patch('ads/:id')
  @ApiOperation({ summary: 'Update own listing — also how it is paused or resumed' })
  async updateAd(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdDto,
  ): Promise<ApiResponse<AdDto>> {
    return ApiResponse.of(await this.marketplace.update(user, id, dto), 'Listing updated');
  }

  @Delete('ads/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete own listing' })
  async deleteAd(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.marketplace.remove(user, id);
    return ApiResponse.of(null, 'Listing deleted');
  }
}
