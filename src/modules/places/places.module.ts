import { Module } from '@nestjs/common';
import { GooglePlacesClient } from './google-places.client';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

@Module({
  controllers: [PlacesController],
  providers: [PlacesService, GooglePlacesClient],
  // exported so the marketplace can resolve an ad's location server-side
  exports: [PlacesService],
})
export class PlacesModule {}
