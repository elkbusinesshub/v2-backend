import { Test } from '@nestjs/testing';
import { DevicePlatform, Role } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { DeviceTokensRepository } from '@/modules/notifications/device-tokens.repository';
import { NotificationsRepository } from '@/modules/notifications/notifications.repository';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PushService } from '@/push/push.service';

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
  let devices: jest.Mocked<DeviceTokensRepository>;
  let push: jest.Mocked<PushService>;
  let pushEnabled: boolean;

  beforeEach(async () => {
    pushEnabled = true;
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
        {
          provide: DeviceTokensRepository,
          useValue: {
            register: jest.fn(),
            remove: jest.fn(),
            removeMany: jest.fn(),
            findTokensByUser: jest.fn().mockResolvedValue(['tok-a', 'tok-b']),
          },
        },
        {
          provide: PushService,
          useValue: {
            get isEnabled() {
              return pushEnabled;
            },
            sendToTokens: jest.fn().mockResolvedValue({ sent: 2, failed: 0, deadTokens: [] }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
    repository = moduleRef.get(NotificationsRepository);
    devices = moduleRef.get(DeviceTokensRepository);
    push = moduleRef.get(PushService);
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

  describe('push delivery', () => {
    const dto = {
      userId: 'u-2',
      icon: '🎉',
      colorHex: 0xfffef3c7,
      title: 'Offer',
      message: 'Weekend deal',
    };

    it('pushes the new notification to every device the user registered', async () => {
      await service.create(dto);

      expect(push.sendToTokens).toHaveBeenCalledWith(['tok-a', 'tok-b'], {
        title: 'Offer',
        body: 'Weekend deal',
        data: { notificationId: 'n-1', type: 'notification' },
      });
    });

    it('deletes the tokens FCM rejected as dead', async () => {
      push.sendToTokens.mockResolvedValue({
        sent: 1,
        failed: 1,
        deadTokens: ['tok-b'],
      });

      await service.create(dto);

      expect(devices.removeMany).toHaveBeenCalledWith(['tok-b']);
    });

    it('keeps tokens when the send failed for a reason other than a dead token', async () => {
      push.sendToTokens.mockResolvedValue({ sent: 0, failed: 2, deadTokens: [] });

      await service.create(dto);

      expect(devices.removeMany).not.toHaveBeenCalled();
    });

    it('skips the token lookup entirely when push is switched off', async () => {
      pushEnabled = false;

      await service.create(dto);

      expect(devices.findTokensByUser).not.toHaveBeenCalled();
      expect(push.sendToTokens).not.toHaveBeenCalled();
    });

    it('sends nothing when the user has no registered device', async () => {
      devices.findTokensByUser.mockResolvedValue([]);

      await service.create(dto);

      expect(push.sendToTokens).not.toHaveBeenCalled();
    });

    it('still stores the notification when delivery blows up', async () => {
      push.sendToTokens.mockRejectedValue(new Error('FCM exploded'));

      await expect(service.create(dto)).resolves.toMatchObject({ title: notification.title });
      expect(repository.create).toHaveBeenCalled();
    });
  });

  describe('device registration', () => {
    it('claims a token for the caller', async () => {
      await service.registerDevice('u-1', 'tok-a', DevicePlatform.ANDROID);

      expect(devices.register).toHaveBeenCalledWith('u-1', 'tok-a', DevicePlatform.ANDROID);
    });

    it('releases only the token that signed out', async () => {
      await service.unregisterDevice('u-1', 'tok-a');

      expect(devices.remove).toHaveBeenCalledWith('u-1', 'tok-a');
    });
  });
});
