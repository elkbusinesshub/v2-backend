import { Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import { REPAIR_SUB_CATEGORIES } from './ad-attributes';
import { RepairPriceDto, UpdateRepairPriceDto } from './marketplace.dto';
import { RepairPricingService } from './repair-pricing.service';

/** Only the tiles the app draws can be priced — a stray slug would never be shown. */
const SUB_CATEGORY_ENUM = Object.fromEntries(REPAIR_SUB_CATEGORIES.map((s) => [s, s]));

@ApiTags('repair')
@ApiBearerAuth()
@Controller('repair/pricing')
export class RepairPricingController {
  constructor(private readonly service: RepairPricingService) {}

  @Get()
  @ApiOperation({ summary: 'Hourly rate and spare-parts fee per repair tile' })
  async list(): Promise<RepairPriceDto[]> {
    return this.service.list();
  }

  @Put(':subCategory')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Set the price of one repair tile (admin)' })
  async update(
    @Param('subCategory', new ParseEnumPipe(SUB_CATEGORY_ENUM)) subCategory: string,
    @Body() dto: UpdateRepairPriceDto,
  ): Promise<ApiResponse<RepairPriceDto>> {
    return ApiResponse.of(await this.service.update(subCategory, dto), 'Price updated');
  }
}
