import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { NotificationsRepository } from '@/modules/notifications/notifications.repository';
import { NotificationsService } from '@/modules/notifications/notifications.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const notification = {
  id: 'n-1',
  userId: 'u-1',
  icon: '🧹',
  colorHex: 0xffe0f7f5,
  title: 'Provider On The Way',
  message: 'Royal Shine is heading to your location. ETA: 12 mins',
  isRead: false,
  createdAt: new Date(Date.now() - 2 * 60_000),
  updatedAt: new Date(),
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repository: jest.Mocked<NotificationsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: NotificationsRepository,
          useValue: {
            findAllByUser: jest.fn().mockResolvedValue([notification]),
            create: jest.fn().mockResolvedValue(notification),
            markAllRead: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
    repository = moduleRef.get(NotificationsRepository);
  });

  it('lists notifications with a computed relative time and isUnread flag', async () => {
    const list = await service.list(user);
    expect(list[0]).toMatchObject({
      icon: '🧹',
      colorHex: 0xffe0f7f5,
      title: 'Provider On The Way',
      time: '2 min ago',
      isUnread: true,
    });
  });

  it('marks all of the caller’s notifications read', async () => {
    await service.markAllRead(user);
    expect(repository.markAllRead).toHaveBeenCalledWith('u-1');
  });

  it('creates a notification for a target user', async () => {
    const dto = {
      userId: 'u-2',
      icon: '🎉',
      colorHex: 0xfffef3c7,
      title: 'Offer',
      message: 'Weekend deal',
    };
    await service.create(dto);
    expect(repository.create).toHaveBeenCalledWith(dto);
  });
});
