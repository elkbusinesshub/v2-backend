import { Inject, Injectable } from '@nestjs/common';
import { Prisma, ServiceChangeKind, ServiceChangeStatus, type HomeService } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { Tx } from './admin.repository';
import { priceOf, termsOf, type ServicePrice, type ServiceTerms } from './service-terms';

const person = { select: { id: true, name: true, phone: true } } as const;

export const changeInclude = {
  service: true,
  requestedBy: person,
  decidedBy: person,
} satisfies Prisma.ServiceChangeRequestInclude;

export type ChangeRow = Prisma.ServiceChangeRequestGetPayload<{ include: typeof changeInclude }>;

/** A request with its service, as read for a decision. */
export type ChangeForDecision = Prisma.ServiceChangeRequestGetPayload<{
  include: { service: true };
}>;

/** A waiting request, as the services list shows it. */
export type OpenChange = {
  id: string;
  kind: ServiceChangeKind;
  requested: ServicePrice;
  createdAt: Date;
};

/** What a decision records on the request. */
export type Decision = {
  status: typeof ServiceChangeStatus.APPROVED | typeof ServiceChangeStatus.REJECTED;
  before: ServiceTerms | null;
  requested: ServiceTerms;
  decidedById: string;
  note: string;
};

const openChangeSelect = {
  id: true,
  kind: true,
  requested: true,
  createdAt: true,
} satisfies Prisma.ServiceChangeRequestSelect;

function toOpenChange(
  r: Prisma.ServiceChangeRequestGetPayload<{ select: typeof openChangeSelect }>,
): OpenChange {
  return {
    id: r.id,
    kind: r.kind,
    requested: priceOf(r.requested as ServiceTerms),
    createdAt: r.createdAt,
  };
}

const { PENDING } = ServiceChangeStatus;

/**
 * Reads and writes service change requests. Holds no rules about what a
 * decision means; AdminApprovalsService and AdminCatalogService decide that.
 */
@Injectable()
export class ServiceChangeRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn);
  }

  // ── waiting requests ──
  async openChanges(): Promise<Map<string, OpenChange>> {
    const rows = await this.db.serviceChangeRequest.findMany({
      where: { status: PENDING },
      select: { ...openChangeSelect, serviceId: true },
    });
    return new Map(rows.map((r) => [r.serviceId!, toOpenChange(r)]));
  }
  async openChange(serviceId: string): Promise<OpenChange | null> {
    const row = await this.db.serviceChangeRequest.findUnique({
      where: { openFor: serviceId },
      select: openChangeSelect,
    });
    return row && toOpenChange(row);
  }
  /** Files the request that a new, still hidden service be approved. */
  async requestNewService(
    service: HomeService,
    requestedById: string,
    tx: Tx,
  ): Promise<OpenChange> {
    const row = await tx.serviceChangeRequest.create({
      data: {
        kind: ServiceChangeKind.NEW_SERVICE,
        serviceId: service.id,
        openFor: service.id,
        requested: termsOf(service),
        requestedById,
      },
      select: openChangeSelect,
    });
    return toOpenChange(row);
  }
  /** Files a price change, replacing the one waiting for this service. */
  async requestPriceChange(
    service: HomeService,
    price: ServicePrice,
    requestedById: string,
  ): Promise<OpenChange> {
    const requested = { ...termsOf(service), ...price };
    const row = await this.db.serviceChangeRequest.upsert({
      where: { openFor: service.id },
      create: {
        kind: ServiceChangeKind.PRICE_CHANGE,
        serviceId: service.id,
        openFor: service.id,
        requested,
        requestedById,
      },
      update: { requested, requestedById, createdAt: new Date() },
      select: openChangeSelect,
    });
    return toOpenChange(row);
  }
  async withdraw(serviceId: string): Promise<void> {
    await this.db.serviceChangeRequest.deleteMany({ where: { openFor: serviceId } });
  }

  // ── the approvals screens ──
  async counts(): Promise<Record<ServiceChangeKind, number>> {
    const rows = await this.db.serviceChangeRequest.groupBy({
      by: ['kind'],
      where: { status: PENDING },
      _count: { _all: true },
    });
    const counts = { NEW_SERVICE: 0, PRICE_CHANGE: 0 };
    for (const r of rows) counts[r.kind] = r._count._all;
    return counts;
  }
  /** One page of waiting requests (oldest first) or decided ones (newest first). */
  async page(decided: boolean, skip: number, take: number): Promise<[ChangeRow[], number]> {
    const where: Prisma.ServiceChangeRequestWhereInput = decided
      ? { decidedAt: { not: null } }
      : { status: PENDING };
    return this.db.$transaction([
      this.db.serviceChangeRequest.findMany({
        where,
        include: changeInclude,
        orderBy: decided
          ? [{ decidedAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.db.serviceChangeRequest.count({ where }),
    ]);
  }

  // ── deciding ──
  async findForDecision(id: string, tx: Tx): Promise<ChangeForDecision | null> {
    return tx.serviceChangeRequest.findUnique({ where: { id }, include: { service: true } });
  }
  /**
   * Records the decision if the request is still waiting. Conditional on
   * PENDING, so of two decisions at once only one lands; false for the other.
   */
  async claim(id: string, d: Decision, tx: Tx): Promise<boolean> {
    const { count } = await tx.serviceChangeRequest.updateMany({
      where: { id, status: PENDING },
      data: {
        status: d.status,
        openFor: null,
        before: d.before ?? Prisma.DbNull,
        requested: d.requested,
        decidedById: d.decidedById,
        decidedAt: new Date(),
        note: d.note,
      },
    });
    return count === 1;
  }
  async findWithPeople(id: string, tx: Tx): Promise<ChangeRow> {
    return tx.serviceChangeRequest.findUniqueOrThrow({ where: { id }, include: changeInclude });
  }
}
