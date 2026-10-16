import { ProfessionalStatus } from '@prisma/client';
import { ApprovalsQueryDto } from '@/modules/admin/admin.dto';
import type { ProfessionalApprovalsRepository } from '@/modules/admin/professional-approvals.repository';
import { ProfessionalApprovalsService } from '@/modules/admin/professional-approvals.service';

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'pr-1',
    name: 'Anil Kumar',
    phone: '+919847021456',
    email: 'anil@example.com',
    experienceYears: 4,
    status: ProfessionalStatus.PENDING,
    categories: [{ category: 'cln' }, { category: 'bth' }],
    company: { id: 'co-1', name: 'Shine Home Services', phone: '+919562461531' },
    decidedBy: null,
    decidedAt: null,
    note: '',
    updatedAt: new Date('2026-10-14T05:00:00Z'),
    ...overrides,
  }) as never;

describe('ProfessionalApprovalsService', () => {
  let repo: jest.Mocked<ProfessionalApprovalsRepository>;
  let svc: ProfessionalApprovalsService;

  beforeEach(() => {
    repo = {
      waiting: jest.fn().mockResolvedValue(1),
      page: jest.fn().mockResolvedValue([[row()], 1]),
      decide: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue(row()),
    } as never;
    svc = new ProfessionalApprovalsService(repo);
  });

  it('lists the waiting professionals with their company', async () => {
    const { items } = await svc.list(new ApprovalsQueryDto());
    expect(repo.page).toHaveBeenCalledWith(false, 0, 20);
    expect(items[0]).toMatchObject({
      name: 'Anil Kumar',
      categories: ['bth', 'cln'],
      company: { name: 'Shine Home Services' },
    });
  });

  it('approves a waiting professional', async () => {
    repo.find.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ status: 'APPROVED' }));
    await expect(svc.approve('pr-1', 'u-super')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(repo.decide).toHaveBeenCalledWith('pr-1', ProfessionalStatus.APPROVED, 'u-super', '');
  });

  it('rejects with the reason the company will see', async () => {
    await svc.reject('pr-1', 'u-super', '  ID proof missing ');
    expect(repo.decide).toHaveBeenCalledWith(
      'pr-1',
      ProfessionalStatus.REJECTED,
      'u-super',
      'ID proof missing',
    );
  });

  it('will not decide twice', async () => {
    repo.decide.mockResolvedValue(false);
    await expect(svc.approve('pr-1', 'u-super')).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });
});
