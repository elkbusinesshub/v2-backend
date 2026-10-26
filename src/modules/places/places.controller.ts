import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PlaceSearchQueryDto,
  PlaceSuggestionDto,
  ResolvedPlaceDto,
  ReverseGeocodeQueryDto,
} from './places.dto';
import { PlacesService } from './places.service';

/**
 * Address lookup for the location picker.
 *
 * Authenticated on purpose: this proxies a metered Google account, so an open
 * endpoint is a way for anyone to spend the project's Maps budget. Guest users
 * never reach it — their cubits short-circuit before any network call.
 *
 * `search` and `reverse` are declared before `:placeId` because Nest matches
 * routes in declaration order and `:placeId` would otherwise swallow them.
 */
@ApiTags('places')
@ApiBearerAuth()
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('search')
  @ApiOperation({ summary: 'Autocomplete an address the user is typing' })
  async search(@Query() query: PlaceSearchQueryDto): Promise<PlaceSuggestionDto[]> {
    return this.places.search(query.query);
  }

  @Get('reverse')
  @ApiOperation({ summary: 'Resolve a GPS coordinate to a named place' })
  async reverse(@Query() query: ReverseGeocodeQueryDto): Promise<ResolvedPlaceDto> {
    return this.places.reverse(query.lat, query.lng);
  }

  @Get(':placeId')
  @ApiOperation({ summary: 'Full detail for a suggestion the user picked' })
  async details(@Param('placeId') placeId: string): Promise<ResolvedPlaceDto> {
    return this.places.details(placeId);
  }
}
