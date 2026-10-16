import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ServiceChangeKind, ServiceChangeStatus } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { paginationMeta, type PaginationMeta } from '@/common/http/pagination';
import type {
  ApprovalsQueryDto,
  ApprovalsSummaryDto,
  ServiceChangeDto,
  ServiceTermsDto,
} from './admin.dto';
import { AdminRepository } from './admin.repository';
import {
  ServiceChangeRepository,
  type ChangeForDecision,
  type ChangeRow,
} from './service-change.repository';
import { priceOf, startingPrice, termsOf, type ServiceTerms } from './service-terms';
import { ProfessionalApprovalsService } from './professional-approvals.service';

const { PENDING, APPROVED, REJECTED } = ServiceChangeStatus;

/**
 * The super admin's side of the catalogue: new services and price or
 * duration changes the admin asked for, approved or rejected. What a decision
 * means for the service is decided here; the repositories only store it.
 */
@Injectable()
export class AdminApprovalsService {
  private readonly logger = new Logger(AdminApprovalsService.name);

  constructor(
    private readonly changes: ServiceChangeRepository,
    private readonly catalog: AdminRepository,
    private readonly professionals: ProfessionalApprovalsService,
  ) {}

  async summary(): Promise<ApprovalsSummaryDto> {
    const [counts, professionals] = await Promise.all([
      this.changes.counts(),
      this.professionals.waiting(),
    ]);
    return {
      waiting: counts.NEW_SERVICE + counts.PRICE_CHANGE + professionals,
      newServices: counts.NEW_SERVICE,
      priceChanges: counts.PRICE_CHANGE,
      professionals,
    };
  }

  async list(
    query: ApprovalsQueryDto,
  ): Promise<{ items: ServiceChangeDto[]; meta: PaginationMeta }> {
    const [rows, total] = await this.changes.page(
      query.view === 'decided',
      query.skip,
      query.limit,
    );
    return { items: rows.map((r) => this.changeJson(r)), meta: paginationMeta(query, total) };
  }

  async approve(id: string, superAdminId: string): Promise<ServiceChangeDto> {
    return this.decide(id, true, superAdminId, '');
  }

  async reject(id: string, superAdminId: string, note = ''): Promise<ServiceChangeDto> {
    return this.decide(id, false, superAdminId, note.trim());
  }

  /**
   * In one transaction: claims the request (only one decision can land),
   * records the live and requested terms as they are at this moment, then
   * applies it. Approving puts the new price live or shows the new service;
   * rejecting a new service deletes it, and a rejected price leaves the app
   * as it is.
   */
  private async decide(
    id: string,
    approve: boolean,
    superAdminId: string,
    note: string,
  ): Promise<ServiceChangeDto> {
    const row = await this.changes.transaction(async (tx) => {
      const change = await this.changes.findForDecision(id, tx);
      if (!change) throw new ResourceNotFoundException('Request');
      if (change.status !== PENDING || !change.service) throw alreadyDecided();

      const service = change.service;
      const isNew = change.kind === ServiceChangeKind.NEW_SERVICE;
      const live = termsOf(service);
      const requested = this.requestedTerms(change, live);

      const claimed = await this.changes.claim(
        id,
        {
          status: approve ? APPROVED : REJECTED,
          before: isNew ? null : live,
          requested,
          decidedById: superAdminId,
          note,
        },
        tx,
      );
      if (!claimed) throw alreadyDecided();

      if (approve) {
        await this.catalog.updateService(
          service.id,
          isNew ? { approved: true } : priceOf(requested),
          tx,
        );
      } else if (isNew) {
        await this.catalog.deleteService(service.id, tx);
      }
      return this.changes.findWithPeople(id, tx);
    });
    this.logger.log(`service change ${row.status.toLowerCase()}: ${row.id} by ${superAdminId}`);
    return this.changeJson(row);
  }

  /** A new service asks for itself; a price change for its price on today's terms. */
  private requestedTerms(change: ChangeForDecision, live: ServiceTerms): ServiceTerms {
    return change.kind === ServiceChangeKind.NEW_SERVICE
      ? live
      : { ...live, ...priceOf(change.requested as ServiceTerms) };
  }

  /**
   * While waiting, "current" is what the app shows right now, so a name or
   * tile edited since the request reads as it is. Once decided, both sides
   * are the snapshot taken at that moment.
   */
  private changeJson(r: ChangeRow): ServiceChangeDto {
    const isNew = r.kind === ServiceChangeKind.NEW_SERVICE;
    let current: ServiceTerms | null;
    let requested: ServiceTerms;
    if (r.status === PENDING && r.service) {
      const live = termsOf(r.service);
      current = isNew ? null : live;
      requested = this.requestedTerms(r, live);
    } else {
      current = r.before as ServiceTerms | null;
      requested = r.requested as ServiceTerms;
    }
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      serviceId: r.serviceId,
      current: current && this.termsJson(current),
      requested: this.termsJson(requested),
      changed: current ? this.changed(current, requested) : [],
      requestedBy: r.requestedBy,
      requestedAt: r.createdAt.toISOString(),
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      note: r.note,
    };
  }

  private termsJson(t: ServiceTerms): ServiceTermsDto {
    return { ...t, startingPrice: startingPrice(t) };
  }

  private changed(a: ServiceTerms, b: ServiceTerms): string[] {
    return (Object.keys(b) as (keyof ServiceTerms)[]).filter((k) => a[k] !== b[k]);
  }
}

function alreadyDecided(): DomainException {
  return new DomainException(
    HttpStatus.CONFLICT,
    'ALREADY_DECIDED',
    'This request has already been approved or rejected',
  );
}
