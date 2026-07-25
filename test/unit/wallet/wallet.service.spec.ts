import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { WalletRepository } from '@/modules/wallet/wallet.repository';
import { WalletService } from '@/modules/wallet/wallet.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const transaction = {
  id: 't-1',
  userId: 'u-1',
  icon: '💳',
  title: 'Wallet Top-up',
  amount: new Prisma.Decimal(200),
  isCredit: true,
  colorHex: 0xffd1fae5,
  createdAt: new Date('2026-05-17T12:00:00.000Z'),
  updatedAt: new Date(),
};

describe('WalletService', () => {
  let service: WalletService;
  let wallet: jest.Mocked<WalletRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: WalletRepository,
          useValue: {
            getBalance: jest.fn().mockResolvedValue(240.5),
            getSummary: jest.fn().mockResolvedValue({
              balance: 240.5,
              rewardPoints: 150,
              transactions: [transaction],
            }),
            credit: jest.fn().mockResolvedValue(340.5),
            debitIfSufficient: jest.fn().mockResolvedValue(140.5),
            logActivity: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(WalletService);
    wallet = moduleRef.get(WalletRepository);
  });

  describe('listPaymentMethods', () => {
    it('serves 4 methods with the wallet subLabel computed from the live balance', async () => {
      const methods = await service.listPaymentMethods(user);
      expect(methods).toHaveLength(4);
      const walletMethod = methods.find((m) => m.id === 'wallet');
      expect(walletMethod).toMatchObject({ label: 'ELK Wallet', subLabel: 'Balance: AED 241' });
      const cardMethod = methods.find((m) => m.id === 'card');
      expect(cardMethod).toMatchObject({ subLabel: 'Visa, Mastercard, Amex' });
    });

    it('404s a deleted/missing account', async () => {
      wallet.getBalance.mockResolvedValue(null);
      await expect(service.listPaymentMethods(user)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe('charge', () => {
    it('debits the wallet for real and returns a reference', async () => {
      const result = await service.charge(user, { methodId: 'wallet', amount: 100 });
      expect(result.reference).toMatch(/^#ELK-\d{4}-\d{5}$/);
      expect(wallet.debitIfSufficient).toHaveBeenCalledWith(
        'u-1',
        100,
        expect.objectContaining({ title: 'Payment', isCredit: false, amount: 100 }),
      );
      expect(wallet.logActivity).not.toHaveBeenCalled();
    });

    it('402s an insufficient wallet balance', async () => {
      wallet.debitIfSufficient.mockResolvedValue(null);
      await expect(service.charge(user, { methodId: 'wallet', amount: 999 })).rejects.toMatchObject(
        { code: 'INSUFFICIENT_BALANCE' },
      );
    });

    it('logs (but does not debit) a non-wallet method as a mock charge', async () => {
      const result = await service.charge(user, { methodId: 'card', amount: 50 });
      expect(result.reference).toMatch(/^#ELK-/);
      expect(wallet.logActivity).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ amount: 50, isCredit: false }),
      );
      expect(wallet.debitIfSufficient).not.toHaveBeenCalled();
    });
  });

  describe('wallet', () => {
    it('serves the balance/points/transactions summary', async () => {
      const summary = await service.getSummary(user);
      expect(summary).toMatchObject({ balance: 240.5, rewardPoints: 150 });
      const transactions = summary.transactions as Record<string, unknown>[];
      expect(transactions[0]).toMatchObject({
        title: 'Wallet Top-up',
        date: '17 May 2026',
        amount: 200,
        isCredit: true,
      });
    });

    it('404s a missing account', async () => {
      wallet.getSummary.mockResolvedValue(null);
      await expect(service.getSummary(user)).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('tops up and returns the new balance', async () => {
      const result = await service.topUp(user, { amount: 100 });
      expect(result).toEqual({ balance: 340.5 });
      expect(wallet.credit).toHaveBeenCalledWith(
        'u-1',
        100,
        expect.objectContaining({ title: 'Wallet Top-up', isCredit: true }),
      );
    });

    it('withdraws and returns the new balance', async () => {
      const result = await service.withdraw(user, { amount: 100 });
      expect(result).toEqual({ balance: 140.5 });
    });

    it('402s an insufficient withdrawal', async () => {
      wallet.debitIfSufficient.mockResolvedValue(null);
      await expect(service.withdraw(user, { amount: 999 })).rejects.toBeInstanceOf(DomainException);
    });
  });
});
