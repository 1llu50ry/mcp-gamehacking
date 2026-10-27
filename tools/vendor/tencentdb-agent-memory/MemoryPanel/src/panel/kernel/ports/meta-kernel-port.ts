import type { MetaEnvelope } from '../envelope.js';
import type { MetaCallContext } from '../types.js';

export interface MetaKernelPort {
  invoke(action: string, body: Record<string, unknown>, ctx: MetaCallContext): Promise<MetaEnvelope>;
}
