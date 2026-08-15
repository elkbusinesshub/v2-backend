import { Injectable, Logger } from '@nestjs/common';
import { ProviderStatus, Role, type ProviderProfile } from '@prisma/client';
import {
  DuplicateResourceException,
  ForbiddenResourceException,
  ResourceNotFoundException,
} from '@/common/errors/domain.exceptions';
import { toRoles } from '@/common/utils/roles';
import type { AuthUser } from '@/common/types/auth.types';
import { UsersRepository } from '@/modules/users/users.repository';
import type { RegisterProviderDto, SetAvailabilityDto, VerifyProviderDto } from './provider.dto';
import { toDashboardJson, toEarningsJson, toProfileJson, toScheduleJson } from './provider.mapper';
import { ProviderRepository } from './provider.repository';

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);

  constructor(
    private readonly providers: ProviderRepository,
    private readonly users: UsersRepository,
  ) {}

  // ─── registration ────────────────────────────────────────────────────────────

  /** Submits a provider application (PENDING). Role is granted only on admin verification. */
  async register(user: AuthUser, dto: RegisterProviderDto): Promise<Record<string, unknown>> {
    const existing = await this.providers.findProfileByUser(user.id);
    if (existing) {
      // A seller who used the panel before registering has a placeholder row
      // (see ensureProfile). Registering fills it in rather than colliding
      // with it — the alternative told them they had already registered when
      // they never had.
      if (existing.status === ProviderStatus.PENDING) {
        const filled = await this.providers.updateProfile(existing.id, {
          businessName: dto.businessName,
          serviceCategory: dto.serviceCategory,
          contactNumber: dto.contactNumber,
          serviceArea: dto.serviceArea,
          tradeLicenseUploaded: dto.tradeLicenseUploaded,
          idDocumentUploaded: dto.idDocumentUploaded,
        });
        this.logger.log(`provider registration completed a placeholder: user=${user.id}`);
        return toProfileJson(filled);
      }
      throw new DuplicateResourceException('You already have a provider profile');
    }
    const profile = await this.providers.createProfile({
      userId: user.id,
      businessName: dto.businessName,
      serviceCategory: dto.serviceCategory,
      contactNumber: dto.contactNumber,
      serviceArea: dto.serviceArea,
      tradeLicenseUploaded: dto.tradeLicenseUploaded,
      idDocumentUploaded: dto.idDocumentUploaded,
    });
    this.logger.log(`provider registration submitted: user=${user.id}`);
    return toProfileJson(profile);
  }

  // ─── dashboard / schedule / earnings ──────────────────────────────────────────

  async getDashboard(user: AuthUser): Promise<Record<string, unknown>> {
    const profile = await this.ensureProfile(user);
    return toDashboardJson(profile, await this.providers.sellerActivity(user.id));
  }

  async getSchedule(user: AuthUser): Promise<Record<string, unknown>> {
    const profile = await this.ensureProfile(user);
    return toScheduleJson(profile, await this.providers.sellerActivity(user.id));
  }

  async getEarnings(user: AuthUser): Promise<Record<string, unknown>> {
    const profile = await this.ensureProfile(user);
    return toEarningsJson(profile, await this.providers.sellerActivity(user.id));
  }

  // ─── availability ─────────────────────────────────────────────────────────────

  async setAvailability(user: AuthUser, dto: SetAvailabilityDto): Promise<Record<string, unknown>> {
    const profile = await this.ensureProfile(user);
    const updated = await this.providers.updateProfile(profile.id, {
      isAvailable: dto.isAvailable,
    });
    return { isAvailable: updated.isAvailable };
  }

  // ─── verification (admin) ─────────────────────────────────────────────────────

  async verify(userId: string, dto: VerifyProviderDto): Promise<Record<string, unknown>> {
    const profile = await this.providers.findProfileByUser(userId);
    if (!profile) {
      throw new ResourceNotFoundException('Provider profile');
    }
    if (dto.decision === 'rejected') {
      const rejected = await this.providers.updateProfile(profile.id, {
        status: ProviderStatus.REJECTED,
      });
      return toProfileJson(rejected);
    }

    const account = await this.users.findById(userId);
    if (!account) {
      throw new ResourceNotFoundException('User');
    }
    const roles = Array.from(new Set([...toRoles(account.roles), Role.PROVIDER]));
    const verified = await this.providers.setStatusAndRole(profile.id, userId, 'VERIFIED', roles);
    this.logger.log(`provider verified, PROVIDER role granted: user=${userId}`);
    return toProfileJson(verified);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async assertProfile(user: AuthUser): Promise<ProviderProfile> {
    const profile = await this.providers.findProfileByUser(user.id);
    if (!profile) {
      throw new ForbiddenResourceException('No provider profile — register first');
    }
    return profile;
  }

  /**
   * The caller's profile, created empty if they have none.
   *
   * The seller panel is one surface for one person: someone who has posted a
   * listing is already trading, and every figure the panel shows is derived
   * from their ad orders rather than from this row. Requiring a separate
   * registration first meant the panel's own duty toggle answered `403` and
   * silently did nothing — the seller believed they were online while the
   * server had never heard of them.
   *
   * The row this creates grants nothing. It stays `PENDING`, so the PROVIDER
   * role still comes only from an admin verifying a real application; it
   * exists to hold the duty flag and the working week.
   */
  private async ensureProfile(user: AuthUser): Promise<ProviderProfile> {
    const existing = await this.providers.findProfileByUser(user.id);
    if (existing) {
      return existing;
    }
    const account = await this.users.findById(user.id);
    const created = await this.providers.createProfile({
      userId: user.id,
      businessName: account?.name ?? 'My business',
      serviceCategory: '',
      contactNumber: account?.phone ?? '',
      serviceArea: '',
    });
    this.logger.log(`provider profile auto-created for seller: user=${user.id}`);
    return created;
  }
}
