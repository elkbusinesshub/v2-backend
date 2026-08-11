import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '@/cache/redis.constants';
import { UpstreamServiceException } from '@/common/errors/domain.exceptions';
import { OtpService } from '@/modules/auth/otp.service';
import { SmsService } from '@/modules/auth/sms.service';

const settings: Record<string, unknown> = {
  'otp.ttlSeconds': 300,
  'otp.resendCooldownSeconds': 30,
  'app.isProduction': false,
  'otp.testPhones': [] as string[],
  'otp.testCode': '123456',
};

describe('OtpService', () => {
  let service: OtpService;
  let redis: { set: jest.Mock; get: jest.Mock; del: jest.Mock; ttl: jest.Mock; incr: jest.Mock };
  let sms: { send: jest.Mock };

  async function build(): Promise<void> {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(-2), // no cooldown active
      incr: jest.fn(),
    };
    sms = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: SmsService, useValue: sms },
        { provide: ConfigService, useValue: { get: (k: string) => settings[k] } },
      ],
    }).compile();
    service = moduleRef.get(OtpService);
  }

  beforeEach(async () => {
    settings['otp.testPhones'] = [];
    await build();
  });

  it('sends a 6-digit code over SMS', async () => {
    await service.issue('+919876543210');

    expect(sms.send).toHaveBeenCalledTimes(1);
    const [phone, message] = sms.send.mock.calls[0] as [string, string];
    expect(phone).toBe('+919876543210');
    expect(message).toMatch(/^Your OTP for ELK is: \d{6}\./);
  });

  it('stores the same code it sends', async () => {
    await service.issue('+919876543210');

    const sent = /(\d{6})/.exec(sms.send.mock.calls[0][1] as string)![1];
    expect(redis.set).toHaveBeenCalledWith('auth:otp:+919876543210', sent, 'EX', 300);
  });

  it('clears the code and cooldown when delivery fails, so the user can retry', async () => {
    sms.send.mockRejectedValue(new UpstreamServiceException());

    await expect(service.issue('+919876543210')).rejects.toThrow(UpstreamServiceException);

    expect(redis.del).toHaveBeenCalledWith(
      'auth:otp:+919876543210',
      'auth:otp:cooldown:+919876543210',
    );
  });

  it('returns the resend cooldown on success', async () => {
    await expect(service.issue('+919876543210')).resolves.toBe(30);
  });

  describe('test phones (ported from the legacy backend)', () => {
    beforeEach(async () => {
      settings['otp.testPhones'] = ['+919999999999'];
      await build();
    });

    it('issues the fixed code and never contacts the SMS gateway', async () => {
      await expect(service.issue('+919999999999')).resolves.toBe(30);

      expect(sms.send).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith('auth:otp:+919999999999', '123456', 'EX', 300);
    });

    it('verifies against the fixed code', async () => {
      await service.issue('+919999999999');
      redis.get.mockResolvedValue('123456');

      await expect(service.verify('+919999999999', '123456')).resolves.toBeUndefined();
    });

    it('still rejects a wrong code for a test phone', async () => {
      await service.issue('+919999999999');
      redis.get.mockResolvedValue('123456');
      redis.incr.mockResolvedValue(1);

      await expect(service.verify('+919999999999', '000000')).rejects.toThrow('Invalid OTP');
    });

    it('leaves every other number on the real SMS path', async () => {
      await service.issue('+919876543210');

      // Contacting the gateway is the observable difference; asserting the code
      // is *not* 123456 would flake once in a million runs.
      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(sms.send.mock.calls[0][1] as string).toMatch(/^Your OTP for ELK is: \d{6}\./);
    });
  });
});
