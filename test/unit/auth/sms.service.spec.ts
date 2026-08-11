import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UpstreamServiceException } from '@/common/errors/domain.exceptions';
import { SmsService } from '@/modules/auth/sms.service';

const settings: Record<string, unknown> = {
  'sms.enabled': true,
  'sms.accessToken': 'tok',
  'sms.accessTokenKey': 'key',
  'sms.senderId': 'SGMOLN',
  'sms.countryCode': '+91',
};

async function build(overrides: Record<string, unknown> = {}): Promise<SmsService> {
  const values = { ...settings, ...overrides };
  const moduleRef = await Test.createTestingModule({
    providers: [
      SmsService,
      { provide: ConfigService, useValue: { get: (k: string) => values[k] } },
    ],
  }).compile();
  return moduleRef.get(SmsService);
}

const md5 = (s: string): string => createHash('md5').update(s).digest('hex');

describe('SmsService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
  });

  it('does not contact the gateway when disabled', async () => {
    const sms = await build({ 'sms.enabled': false });

    await sms.send('+919876543210', 'hello');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('strips the country code from the recipient', async () => {
    const sms = await build();

    await sms.send('+919876543210', 'hello');

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('recipients')).toBe('9876543210');
  });

  it('signs the request with the three-stage MD5 chain', async () => {
    const sms = await build();

    await sms.send('+919876543210', 'hello');

    const raw = fetchMock.mock.calls[0][0] as string;
    const expire = new URL(raw).searchParams.get('expire');
    const timeKey = md5(`send-smssms@rits-v1.0${expire}`);
    const expected = md5(md5('tok' + timeKey) + 'key');
    expect(new URL(raw).searchParams.get('authSignature')).toBe(expected);
  });

  it('sends the country code unencoded, as the gateway expects', async () => {
    const sms = await build();

    await sms.send('+919876543210', 'hello');

    expect(fetchMock.mock.calls[0][0]).toContain('&countryCode=+91');
  });

  it('throws when the gateway returns a non-2xx status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('bad token'),
    });
    const sms = await build();

    await expect(sms.send('+919876543210', 'hello')).rejects.toThrow(UpstreamServiceException);
  });

  it('throws when the request fails outright', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const sms = await build();

    await expect(sms.send('+919876543210', 'hello')).rejects.toThrow(UpstreamServiceException);
  });
});
