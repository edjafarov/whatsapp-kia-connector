import { connector as whatsappConnector } from '../index';

describe('whatsappConnector', () => {
  it('declares realtime-primary capabilities', () => {
    expect(whatsappConnector.id).toBe('whatsapp');
    expect(whatsappConnector.capabilities).toMatchObject({
      multiAccount: true,
      requiresAuth: true,
      supportsBackfill: true,
      supportsRealtime: true,
    });
  });

  it('validates an account input (always ok; pairing is interactive)', () => {
    expect(whatsappConnector.validateAccount({})).toEqual({ ok: true });
  });
});
