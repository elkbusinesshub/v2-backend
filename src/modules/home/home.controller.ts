import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { HomeFeedDto } from './home.dto';
import { HomeService } from './home.service';

@ApiTags('home')
@ApiBearerAuth()
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Personalized home screen: greeting, promo, nav tiles, best sellers' })
  async feed(@CurrentUser() user: AuthUser): Promise<ApiResponse<HomeFeedDto>> {
    return ApiResponse.of(await this.homeService.getFeed(user.id));
  }
}
