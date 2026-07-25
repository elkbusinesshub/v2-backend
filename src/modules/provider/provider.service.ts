import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ProviderStatus, Role, type ProviderProfile } from '@prisma/client';
import {
  DomainException,
  DuplicateResourceException,
  ForbiddenResourceException,
  ResourceNotFoundException,
} from '@/common/errors/domain.exceptions';
import { toRoles } from '@/common/utils/roles';
import type { AuthUser } from '@/common/types/auth.types';
import { UsersRepository } from '@/modules/users/users.repository';
import type {
  RegisterProviderDto,
  RespondRequestDto,
  SetAvailabilityDto,
  VerifyProviderDto,
} from './provider.dto';
import {
  toDashboardJson,
  toEarningsJson,
  toProfileJson,
  toRequestJson,
  toScheduleJson,
} from './provider.mapper';
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
    const profile = await this.assertProfile(user);
    const requests = await this.providers.listRequests(profile.id);
    return toDashboardJson(profile, requests);
  }

  async getSchedule(user: AuthUser): Promise<Record<string, unknown>> {
    const profile = await this.assertProfile(user);
    const requests = await this.providers.listRequests(profile.id);
    return toScheduleJson(profile, requests);
  }

  async getEarnings(user: AuthUser): Promise<Record<string, unknown>> {
    const profile = await this.assertProfile(user);
    const requests = await this.providers.listRequests(profile.id);
    return toEarningsJson(profile, requests);
  }

  // ─── availability / requests ──────────────────────────────────────────────────

  async setAvailability(user: AuthUser, dto: SetAvailabilityDto): Promise<Record<string, unknown>> {
    const profile = await this.assertProfile(user);
    const updated = await this.providers.updateProfile(profile.id, {
      isAvailable: dto.isAvailable,
    });
    return { isAvailable: updated.isAvailable };
  }

  async respondToRequest(
    user: AuthUser,
    requestId: string,
    dto: RespondRequestDto,
  ): Promise<Record<string, unknown>> {
    const profile = await this.assertProfile(user);
    const request = await this.providers.findRequestForProvider(requestId, profile.id);
    if (!request) {
      throw new ResourceNotFoundException('Request');
    }
    const ok = await this.providers.respondToRequest(requestId, dto.accept);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'REQUEST_ALREADY_HANDLED',
        'This request has already been accepted or declined',
      );
    }
    const updated = await this.providers.findRequestForProvider(requestId, profile.id);
    this.logger.log(`provider request ${dto.accept ? 'accepted' : 'declined'}: ${requestId}`);
    return toRequestJson(updated!);
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
}
