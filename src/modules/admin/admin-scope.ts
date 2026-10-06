import type { ServiceVertical } from '@prisma/client';
import { ForbiddenResourceException } from '@/common/errors/domain.exceptions';

const NAMES: Record<ServiceVertical, string> = { CLEANING: 'ELK Clean', REPAIR: 'ELK Repair' };

/** Refuses an admin whose modules do not include [vertical]. */
export function assertVertical(
  vertical: ServiceVertical,
  verticals: readonly ServiceVertical[],
): void {
  if (!verticals.includes(vertical)) {
    throw new ForbiddenResourceException(`Your admin account does not cover ${NAMES[vertical]}`);
  }
}
