import type { MetaEnvelope } from '../envelope.js';
import type { MetaCallContext } from '../types.js';

/**
 * 内核 /v3/skill/* 数据面透明代理端口。
 * 与 MetaKernelPort 同形，但转发到 /v3/skill/{action} 而非 /v3/meta/{action}。
 */
export interface SkillKernelPort {
  invoke(action: string, body: Record<string, unknown>, ctx: MetaCallContext): Promise<MetaEnvelope>;
}
