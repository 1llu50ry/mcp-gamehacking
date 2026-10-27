import { randomUUID } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { LogFields, Logger } from '../../infra/logger.js';

declare module 'hono' {
  interface ContextVariableMap {
    reqId: string;
    log: Logger;
  }
}

/**
 * 访问日志中间件：
 * - 为每个请求生成（或透传 x-request-id）reqId，并回写响应头；
 * - 注入 ctx.var.log（带 reqId 的子 logger），业务处理器可直接用它打业务日志；
 * - 请求结束后按级别记录：5xx=error / 4xx=warn / 2xx=info（除噪音路径）。
 *
 * 噪音过滤：
 *   - 静态资源（/、/assets/*、/favicon.ico、/*.html 等）默认不打 access log
 *   - /health 频繁被外部探活，仅 4xx/5xx 才打
 *   - 其他 API 路径（/api/v1/*）正常打 info（保留可观测性）
 */
const STATIC_PREFIXES = ['/assets/', '/favicon'];
const STATIC_EXTS = ['.js', '.css', '.map', '.png', '.svg', '.ico', '.html', '.woff', '.woff2'];

function isStaticAsset(path: string): boolean {
  if (path === '/' ) return true;
  if (STATIC_PREFIXES.some((p) => path.startsWith(p))) return true;
  return STATIC_EXTS.some((ext) => path.endsWith(ext));
}

function isHealthCheck(path: string): boolean {
  return path === '/health';
}

export function requestLogger(logger: Logger) {
  return createMiddleware(async (c, next) => {
    const reqId = c.req.header('x-request-id') ?? randomUUID();
    const start = Date.now();
    const reqLog = logger.child({ reqId });
    c.set('reqId', reqId);
    c.set('log', reqLog);
    c.header('x-request-id', reqId);

    try {
      await next();
    } finally {
      const status = c.res.status;
      const path = c.req.path;
      const isError = status >= 500;
      const isWarn = status >= 400 && status < 500;

      // 噪音过滤：静态资源 + 成功的 health 都不打 info 日志
      const isNoise = !isError && !isWarn && (isStaticAsset(path) || isHealthCheck(path));
      if (isNoise) return;

      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');
      const fields: LogFields = {
        method: c.req.method,
        path,
        status,
        durationMs: Date.now() - start,
      };
      if (user) fields.userId = user.user_id;
      if (ip) fields.ip = ip;

      const level = isError ? 'error' : isWarn ? 'warn' : 'info';
      reqLog[level]('request', fields);
    }
  });
}
