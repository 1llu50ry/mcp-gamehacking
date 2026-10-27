import type { Context } from 'hono';
import type { MetaEnvelope } from '../kernel/envelope.js';
import { mapHttpStatusFromEnvelopeCode } from '../kernel/envelope.js';

export function controlEnvelope(
  code: number,
  message: string,
  requestId: string,
): MetaEnvelope<null> {
  return {
    code,
    message,
    request_id: requestId,
    data: null,
  };
}

export function respondEnvelope(c: Context, envelope: MetaEnvelope<unknown>) {
  return c.json(envelope, mapHttpStatusFromEnvelopeCode(envelope.code) as never);
}

export function respondControlError(c: Context, code: number, message: string) {
  const reqId = c.get('reqId') ?? '';
  return respondEnvelope(c, controlEnvelope(code, message, reqId));
}
