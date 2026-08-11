import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PlaceSearchQueryDto,
  PlaceSuggestionDto,
  ResolvedPlaceDto,
  ReverseGeocodeQueryDto,
  RouteDto,
  RouteQueryDto,
  StaticMapQueryDto,
} from './places.dto';
import { PlacesService } from './places.service';

/**
 * Address lookup for the location picker.
 *
 * Authenticated on purpose: this proxies a metered Google account, so an open
 * endpoint is a way for anyone to spend the project's Maps budget. Guest users
 * never reach it — their cubits short-circuit before any network call.
 *
 * `search`, `reverse`, `static-map` and `route` are declared before `:placeId`
 * because Nest matches routes in declaration order and `:placeId` would
 * otherwise swallow them all.
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

  @Get('static-map')
  @ApiOperation({ summary: 'Map image for a coordinate, proxied so the key stays server-side' })
  @Header('Cache-Control', 'public, max-age=2592000')
  async staticMap(@Query() query: StaticMapQueryDto, @Res() res: Response): Promise<void> {
    const image = await this.places.staticMap(query);
    res.type(image.contentType).send(image.body);
  }

  @Get('route')
  @ApiOperation({ summary: 'Driving route between two points, for the map polyline' })
  async route(@Query() query: RouteQueryDto): Promise<RouteDto | null> {
    return this.places.route(query);
  }

  @Get(':placeId')
  @ApiOperation({ summary: 'Full detail for a suggestion the user picked' })
  async details(@Param('placeId') placeId: string): Promise<ResolvedPlaceDto> {
    return this.places.details(placeId);
  }
}
