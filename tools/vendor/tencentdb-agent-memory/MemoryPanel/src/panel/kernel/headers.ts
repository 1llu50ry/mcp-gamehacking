/**
 * 记忆内核 v3 `/v3/meta/*` 全局 HTTP 头（与 tdai-memory-plugin 对齐）。
 * Control 面板入站校验与出站转发均使用同一套名称。
 */
export const META_HEADER_SERVICE_ID = 'x-tdai-service-id';
export const META_HEADER_USER_KEY = 'x-tdai-user-key';
export const META_HEADER_REQUEST_ID = 'x-request-id';
