import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ProfessionalStatus } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { paginationMeta, type PaginationMeta } from '@/common/http/pagination';
import type { ApprovalsQueryDto, ProfessionalApprovalDto } from './admin.dto';
import {
  ProfessionalApprovalsRepository,
  type ProfessionalApprovalRow,
} from './professional-approvals.repository';

/**
 * The super admin checks each professional a company adds (and any whose
 * phone or email changes) before the company can send them to a customer.
 */
@Injectable()
export class ProfessionalApprovalsService {
  private readonly logger = new Logger(ProfessionalApprovalsService.name);

  constructor(private readonly repo: ProfessionalApprovalsRepository) {}

  waiting(): Promise<number> {
    return this.repo.waiting();
  }

  async list(
    query: ApprovalsQueryDto,
  ): Promise<{ items: ProfessionalApprovalDto[]; meta: PaginationMeta }> {
    const [rows, total] = await this.repo.page(query.view === 'decided', query.skip, query.limit);
    return { items: rows.map((r) => this.json(r)), meta: paginationMeta(query, total) };
  }

  approve(id: string, superAdminId: string): Promise<ProfessionalApprovalDto> {
    return this.decide(id, ProfessionalStatus.APPROVED, superAdminId, '');
  }

  reject(id: string, superAdminId: string, note = ''): Promise<ProfessionalApprovalDto> {
    return this.decide(id, ProfessionalStatus.REJECTED, superAdminId, note.trim());
  }

  private async decide(
    id: string,
    status: ProfessionalStatus,
    superAdminId: string,
    note: string,
  ): Promise<ProfessionalApprovalDto> {
    const current = await this.repo.find(id);
    if (!current) throw new ResourceNotFoundException('Professional');
    if (!(await this.repo.decide(id, status, superAdminId, note))) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'ALREADY_DECIDED',
        'This professional has already been decided',
      );
    }
    this.logger.log(`professional ${status.toLowerCase()}: ${id} by ${superAdminId}`);
    return this.json((await this.repo.find(id))!);
  }

  private json(p: ProfessionalApprovalRow): ProfessionalApprovalDto {
    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      experienceYears: p.experienceYears,
      categories: p.categories.map((c) => c.category).sort(),
      status: p.status,
      company: p.company,
      submittedAt: p.updatedAt.toISOString(),
      decidedBy: p.decidedBy,
      decidedAt: p.decidedAt?.toISOString() ?? null,
      note: p.note,
    };
  }
}
