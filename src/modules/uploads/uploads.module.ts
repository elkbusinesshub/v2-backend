import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';

/** StorageModule is @Global, so ImageService needs no explicit import here. */
@Module({ controllers: [UploadsController] })
export class UploadsModule {}
