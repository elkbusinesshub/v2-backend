import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PushService } from '@/push/push.service';

const initializeApp = jest.fn(() => ({ name: 'elk-push' }));
const deleteApp = jest.fn((): Promise<void> => Promise.resolve());
const cert = jest.fn((sa: unknown): { credential: unknown } => ({ credential: sa }));
const sendEachForMulticast = jest.fn();

jest.mock('firebase-admin/app', () => ({
  initializeApp: (...args: unknown[]) => initializeApp(...(args as [])),
  deleteApp: (...args: unknown[]) => deleteApp(...(args as [])),
  cert: (...args: unknown[]) => cert(...(args as [unknown])),
}));

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));

// A valid-looking service account, written where the service will look for it.
const SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'elkbusinesshub',
  client_email: 'firebase-adminsdk@elkbusinesshub.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
});

jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  readFileSync: (path: string, encoding?: string) => {
    if (typeof path === 'string' && path.includes('service-account')) return SERVICE_ACCOUNT;
    return jest
      .requireActual<typeof import('node:fs')>('node:fs')
      .readFileSync(path, encoding as BufferEncoding);
  },
}));

async function build(overrides: Record<string, unknown> = {}): Promise<PushService> {
  const values: Record<string, unknown> = {
    'push.enabled': true,
    'push.serviceAccountPath': 'secrets/firebase-service-account.json',
    ...overrides,
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PushService,
      { provide: ConfigService, useValue: { get: (k: string) => values[k] } },
    ],
  }).compile();
  const service = moduleRef.get(PushService);
  service.onModuleInit();
  return service;
}

/** Builds the per-token response array `sendEachForMulticast` returns. */
function multicast(outcomes: (true | string)[]) {
  return {
    successCount: outcomes.filter((o) => o === true).length,
    failureCount: outcomes.filter((o) => o !== true).length,
    responses: outcomes.map((o) =>
      o === true ? { success: true } : { success: false, error: { code: o, message: o } },
    ),
  };
}

describe('PushService', () => {
  beforeEach(() => {
    sendEachForMulticast.mockResolvedValue(multicast([true]));
  });

  describe('initialisation', () => {
    it('loads the service account and maps it to the camelCase shape cert() expects', async () => {
      const service = await build();

      expect(service.isEnabled).toBe(true);
      expect(cert).toHaveBeenCalledWith({
        projectId: 'elkbusinesshub',
        clientEmail: 'firebase-adminsdk@elkbusinesshub.iam.gserviceaccount.com',
        privateKey: expect.stringContaining('BEGIN PRIVATE KEY'),
      });
    });

    it('names the Firebase app so it cannot collide with a default instance', async () => {
      await build();

      expect(initializeApp).toHaveBeenCalledWith(expect.anything(), 'elk-push');
    });

    it('does not touch Firebase when push is switched off', async () => {
      const service = await build({ 'push.enabled': false });

      expect(service.isEnabled).toBe(false);
      expect(initializeApp).not.toHaveBeenCalled();
    });

    it('reports itself disabled — rather than crashing the app — when the credentials file is missing', async () => {
      const service = await build({ 'push.serviceAccountPath': 'secrets/nope.json' });

      expect(service.isEnabled).toBe(false);
    });
  });

  describe('sendToTokens', () => {
    it('sends one high-priority multicast to the given tokens', async () => {
      const service = await build();
      sendEachForMulticast.mockResolvedValue(multicast([true, true]));

      const result = await service.sendToTokens(['a', 'b'], {
        title: 'Booking confirmed',
        body: 'Your cleaner is on the way',
        data: { notificationId: 'n-1' },
      });

      expect(result).toEqual({ sent: 2, failed: 0, deadTokens: [] });
      expect(sendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: ['a', 'b'],
          notification: { title: 'Booking confirmed', body: 'Your cleaner is on the way' },
          data: { notificationId: 'n-1' },
          android: { priority: 'high' },
        }),
      );
    });

    it('collapses duplicate tokens so one device is not notified twice', async () => {
      const service = await build();

      await service.sendToTokens(['a', 'a', ''], { title: 't', body: 'b' });

      expect(sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['a']);
    });

    it('reports tokens FCM says are dead, and only those', async () => {
      const service = await build();
      sendEachForMulticast.mockResolvedValue(
        multicast([
          true,
          'messaging/registration-token-not-registered',
          'messaging/quota-exceeded',
          'messaging/invalid-registration-token',
        ]),
      );

      const result = await service.sendToTokens(['a', 'b', 'c', 'd'], {
        title: 't',
        body: 'b',
      });

      // 'c' failed on quota — transient, so its token survives.
      expect(result.deadTokens).toEqual(['b', 'd']);
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(3);
    });

    it('splits a fan-out larger than the 500-token FCM limit', async () => {
      const service = await build();
      const tokens = Array.from({ length: 501 }, (_, i) => `t${i}`);
      sendEachForMulticast.mockResolvedValue(multicast([true]));

      await service.sendToTokens(tokens, { title: 't', body: 'b' });

      expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
      expect(sendEachForMulticast.mock.calls[0][0].tokens).toHaveLength(500);
      expect(sendEachForMulticast.mock.calls[1][0].tokens).toHaveLength(1);
    });

    it('swallows a whole-batch failure and claims no token is dead', async () => {
      const service = await build();
      sendEachForMulticast.mockRejectedValue(new Error('network down'));

      const result = await service.sendToTokens(['a', 'b'], { title: 't', body: 'b' });

      expect(result).toEqual({ sent: 0, failed: 2, deadTokens: [] });
    });

    it('is a no-op when disabled or given no tokens', async () => {
      const disabled = await build({ 'push.enabled': false });
      await expect(disabled.sendToTokens(['a'], { title: 't', body: 'b' })).resolves.toEqual({
        sent: 0,
        failed: 0,
        deadTokens: [],
      });

      const enabled = await build();
      await enabled.sendToTokens([], { title: 't', body: 'b' });
      expect(sendEachForMulticast).not.toHaveBeenCalled();
    });
  });

  it('releases the Firebase app on shutdown', async () => {
    const service = await build();

    await service.onApplicationShutdown();

    expect(deleteApp).toHaveBeenCalled();
    expect(service.isEnabled).toBe(false);
  });
});
