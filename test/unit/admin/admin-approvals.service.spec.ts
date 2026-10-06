import { Test } from '@nestjs/testing';
import { Prisma, ServiceChangeKind, ServiceChangeStatus, ServiceVertical } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { AdminApprovalsService } from '@/modules/admin/admin-approvals.service';
import { ApprovalsQueryDto } from '@/modules/admin/admin.dto';
import { AdminRepository } from '@/modules/admin/admin.repository';
import { ServiceChangeRepository, type ChangeRow } from '@/modules/admin/service-change.repository';

const kitchen = {
  id: 's-1',
  vertical: ServiceVertical.CLEANING,
  category: 'kit',
  name: 'Kitchen deep clean',
  description: '',
  minHours: 3,
  hourlyRate: new Prisma.Decimal(399),
  extraProRate: new Prisma.Decimal(349),
  materialsFee: new Prisma.Decimal(199),
  active: true,
  online: true,
  approved: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const terms = {
  name: 'Kitchen deep clean',
  vertical: ServiceVertical.CLEANING,
  category: 'kit',
  minHours: 3,
  hourlyRate: 399,
  extraProRate: 349,
  materialsFee: 199,
};
const admin = { id: 'u-admin', name: 'Admin', phone: '+919000000001' };
const boss = { id: 'u-super', name: 'Super admin', phone: '+919000000002' };

function row(over: Partial<ChangeRow>): ChangeRow {
  return {
    id: 'c-1',
    kind: ServiceChangeKind.PRICE_CHANGE,
    status: ServiceChangeStatus.PENDING,
    serviceId: 's-1',
    service: kitchen,
    openFor: 's-1',
    before: null,
    requested: { ...terms, hourlyRate: 449, extraProRate: 379 },
    requestedById: admin.id,
    requestedBy: admin,
    decidedById: null,
    decidedBy: null,
    decidedAt: null,
    note: '',
    createdAt: new Date('2026-10-04T04:10:00Z'),
    updatedAt: new Date(),
    ...over,
  };
}

describe('AdminApprovalsService', () => {
  let svc: AdminApprovalsService;
  let repo: jest.Mocked<ServiceChangeRepository>;
  let catalog: jest.Mocked<AdminRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminApprovalsService,
        {
          provide: ServiceChangeRepository,
          useValue: {
            counts: jest.fn().mockResolvedValue({ NEW_SERVICE: 1, PRICE_CHANGE: 1 }),
            page: jest.fn().mockResolvedValue([[row({})], 41]),
            transaction: jest.fn().mockImplementation((fn: (tx: string) => unknown) => fn('tx')),
            findForDecision: jest.fn().mockResolvedValue(row({})),
            claim: jest.fn().mockResolvedValue(true),
            findWithPeople: jest.fn().mockResolvedValue(row({ status: 'APPROVED' })),
          },
        },
        {
          provide: AdminRepository,
          useValue: { updateService: jest.fn(), deleteService: jest.fn() },
        },
      ],
    }).compile();
    svc = moduleRef.get(AdminApprovalsService);
    repo = moduleRef.get(ServiceChangeRepository);
    catalog = moduleRef.get(AdminRepository);
  });

  it('counts what is waiting, by kind', async () => {
    await expect(svc.summary()).resolves.toEqual({ waiting: 2, newServices: 1, priceChanges: 1 });
  });

  it('shows a waiting price change against what the app charges now', async () => {
    const query = Object.assign(new ApprovalsQueryDto(), { page: 3, limit: 20 });
    const { items, meta } = await svc.list(query);
    expect(repo.page).toHaveBeenCalledWith(false, 40, 20);
    expect(meta).toEqual({ page: 3, limit: 20, total: 41, totalPages: 3 });
    expect(items[0]).toMatchObject({
      kind: 'PRICE_CHANGE',
      current: { hourlyRate: 399, extraProRate: 349, startingPrice: 1197 },
      requested: {
        name: 'Kitchen deep clean',
        hourlyRate: 449,
        extraProRate: 379,
        startingPrice: 1347,
      },
      changed: ['hourlyRate', 'extraProRate'],
      requestedBy: admin,
      decidedBy: null,
    });
  });

  it('reads the history from the snapshots taken when it was decided', async () => {
    repo.page.mockResolvedValue([
      [
        row({
          status: ServiceChangeStatus.APPROVED,
          service: { ...kitchen, hourlyRate: new Prisma.Decimal(499) },
          openFor: null,
          before: terms,
          requested: { ...terms, hourlyRate: 449 },
          decidedBy: boss,
          decidedAt: new Date('2026-10-04T05:00:00Z'),
        }),
      ],
      1,
    ]);
    const query = Object.assign(new ApprovalsQueryDto(), { view: 'decided' });
    const { items } = await svc.list(query);
    expect(repo.page).toHaveBeenCalledWith(true, 0, 20);
    expect(items[0]).toMatchObject({
      status: 'APPROVED',
      current: { hourlyRate: 399 },
      requested: { hourlyRate: 449 },
      changed: ['hourlyRate'],
      decidedBy: boss,
      decidedAt: '2026-10-04T05:00:00.000Z',
    });
  });

  it('shows a new service with nothing in the app to compare against', async () => {
    repo.page.mockResolvedValue([
      [row({ kind: ServiceChangeKind.NEW_SERVICE, service: { ...kitchen, approved: false } })],
      1,
    ]);
    const { items } = await svc.list(new ApprovalsQueryDto());
    expect(items[0]).toMatchObject({
      current: null,
      requested: { name: 'Kitchen deep clean', hourlyRate: 399 },
      changed: [],
    });
  });

  it('approving a price change puts the requested price live and keeps the old one', async () => {
    await svc.approve('c-1', boss.id);
    expect(repo.claim).toHaveBeenCalledWith(
      'c-1',
      {
        status: 'APPROVED',
        before: terms,
        requested: { ...terms, hourlyRate: 449, extraProRate: 379 },
        decidedById: boss.id,
        note: '',
      },
      'tx',
    );
    expect(catalog.updateService).toHaveBeenCalledWith(
      's-1',
      { minHours: 3, hourlyRate: 449, extraProRate: 379, materialsFee: 199 },
      'tx',
    );
  });

  it('approving a new service shows it in the app', async () => {
    repo.findForDecision.mockResolvedValue(
      row({ kind: ServiceChangeKind.NEW_SERVICE, service: { ...kitchen, approved: false } }),
    );
    await svc.approve('c-1', boss.id);
    expect(repo.claim).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ before: null, requested: terms }),
      'tx',
    );
    expect(catalog.updateService).toHaveBeenCalledWith('s-1', { approved: true }, 'tx');
  });

  it('rejecting a price change leaves the service as it is, with the note', async () => {
    repo.findWithPeople.mockResolvedValue(
      row({ status: ServiceChangeStatus.REJECTED, decidedBy: boss, note: 'Too steep' }),
    );
    const decided = await svc.reject('c-1', boss.id, '  Too steep ');
    expect(repo.claim).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ status: 'REJECTED', note: 'Too steep' }),
      'tx',
    );
    expect(catalog.updateService).not.toHaveBeenCalled();
    expect(catalog.deleteService).not.toHaveBeenCalled();
    expect(decided).toMatchObject({ status: 'REJECTED', note: 'Too steep', decidedBy: boss });
  });

  it('rejecting a new service deletes it', async () => {
    repo.findForDecision.mockResolvedValue(
      row({ kind: ServiceChangeKind.NEW_SERVICE, service: { ...kitchen, approved: false } }),
    );
    await svc.reject('c-1', boss.id);
    expect(catalog.deleteService).toHaveBeenCalledWith('s-1', 'tx');
  });

  it('will not decide a request twice', async () => {
    repo.findForDecision.mockResolvedValue(row({ status: ServiceChangeStatus.APPROVED }));
    await expect(svc.approve('c-1', boss.id)).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('loses cleanly to a decision made at the same moment', async () => {
    repo.claim.mockResolvedValue(false);
    await expect(svc.approve('c-1', boss.id)).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    expect(catalog.updateService).not.toHaveBeenCalled();
  });

  it('reports a request that does not exist', async () => {
    repo.findForDecision.mockResolvedValue(null);
    await expect(svc.reject('c-9', boss.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
