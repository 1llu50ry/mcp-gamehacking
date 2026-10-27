/**
 * 日志端口（抽象）。业务/基础设施只依赖此接口，不绑定具体日志库。
 * 替换实现（console / pino / 上报到日志平台）只改 adapter + container，
 * 见 docs/architecture/06-logging.md。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 结构化字段，跟随一条日志一起输出。 */
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /**
   * 派生一个带固定字段的子 logger（如 reqId / userId），
   * 之后该 logger 打的每条日志都自动带上这些字段，便于串联一次请求。
   */
  child(bindings: LogFields): Logger;
}
