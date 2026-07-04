import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/cache/redis.constants';
import { Public } from '@/common/decorators/public.decorator';
import { SkipEnvelope } from '@/common/decorators/skip-envelope.decorator';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/**
 * Probes for load balancers / orchestrators. Unversioned, outside the /api
 * prefix, no auth, no response envelope:
 *
 *  - /health/live  — process is up (liveness)
 *  - /health/ready — dependencies reachable (readiness); 503 tells the LB to
 *    stop routing traffic here without killing the container
 */
@ApiExcludeController()
@Public()
@SkipEnvelope()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('live')
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    const [db, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);
    const checks = {
      database: db.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' ? 'up' : 'down',
    };
    if (db.status === 'rejected' || redis.status === 'rejected') {
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }
}
