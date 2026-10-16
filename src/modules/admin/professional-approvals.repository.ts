import { Inject, Injectable } from '@nestjs/common';
import { ProfessionalStatus, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

const person = { select: { id: true, name: true, phone: true } } as const;

export const approvalInclude = {
  categories: { select: { category: true } },
  company: person,
  decidedBy: person,
} satisfies Prisma.ProfessionalInclude;

export type ProfessionalApprovalRow = Prisma.ProfessionalGetPayload<{
  include: typeof approvalInclude;
}>;

/** Professionals across every company, as the super admin reviews them. */
@Injectable()
export class ProfessionalApprovalsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async waiting(): Promise<number> {
    return this.db.professional.count({ where: { status: ProfessionalStatus.PENDING } });
  }

  /** One page of waiting professionals (oldest first) or decided ones (newest first). */
  async page(
    decided: boolean,
    skip: number,
    take: number,
  ): Promise<[ProfessionalApprovalRow[], number]> {
    const where: Prisma.ProfessionalWhereInput = decided
      ? { status: { not: ProfessionalStatus.PENDING } }
      : { status: ProfessionalStatus.PENDING };
    return Promise.all([
      this.db.professional.findMany({
        where,
        include: approvalInclude,
        orderBy: decided ? [{ decidedAt: 'desc' }, { id: 'desc' }] : [{ updatedAt: 'asc' }],
        skip,
        take,
      }),
      this.db.professional.count({ where }),
    ]);
  }

  /**
   * Records the decision only if the professional is still waiting, so two
   * super admins cannot both decide. False when it was already decided.
   */
  async decide(
    id: string,
    status: ProfessionalStatus,
    decidedById: string,
    note: string,
  ): Promise<boolean> {
    const { count } = await this.db.professional.updateMany({
      where: { id, status: ProfessionalStatus.PENDING },
      data: { status, decidedById, decidedAt: new Date(), note },
    });
    return count === 1;
  }

  async find(id: string): Promise<ProfessionalApprovalRow | null> {
    return this.db.professional.findUnique({ where: { id }, include: approvalInclude });
  }
}
