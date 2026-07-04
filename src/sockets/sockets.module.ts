import { Module } from '@nestjs/common';
import { SystemGateway } from './system.gateway';

/**
 * Realtime foundation. Future feature gateways (ChatGateway,
 * LocationGateway, …) live in their own feature modules — this module only
 * owns the shared /system namespace. The Redis adapter is installed
 * app-wide in main.ts.
 */
@Module({
  providers: [SystemGateway],
})
export class SocketsModule {}
