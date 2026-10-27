/**
 * Mock memory 服务（本地端到端联调用）。
 *
 * 起一个独立 Hono 实例，监听 `MOCK_KERNEL_PORT`（默认 9090），
 * 接收主服务 Outbox worker 投递的全部聚合类型 upsert / delete。
 *
 * - POST /internal/sync/:aggregate     → 落到 received 数组 + stdout 打印
 * - POST /internal/sync/:aggregate/delete → 同上，event_type=delete
 * - GET  /__received                   → 返回已收事件列表（便于断言 / 排错）
 * - DELETE /__received                 → 清空（便于多轮联调）
 *
 * 启动：`tsx scripts/mock-memory-server.ts`
 *
 * 主服务对接：`KERNEL_ENABLED=true KERNEL_BASE_URL=http://127.0.0.1:9090 pnpm dev`
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

interface ReceivedEvent {
  ts: string;
  aggregate: string;
  event_type: 'upsert' | 'delete';
  payload: unknown;
}

const received: ReceivedEvent[] = [];

const app = new Hono();

app.get('/__received', (c) => c.json(received));
app.delete('/__received', (c) => {
  received.length = 0;
  return c.json({ ok: true });
});

// upsert: /internal/sync/:aggregate
app.post('/internal/sync/:aggregate', async (c) => {
  const aggregate = c.req.param('aggregate');
  const payload = await c.req.json().catch(() => ({}));
  const ev: ReceivedEvent = {
    ts: new Date().toISOString(),
    aggregate,
    event_type: 'upsert',
    payload,
  };
  received.push(ev);
  // 一行 JSON，便于 grep
  console.log(JSON.stringify({ tag: 'mock-kernel', ...ev }));
  return c.json({ ok: true });
});

// delete: /internal/sync/:aggregate/delete
app.post('/internal/sync/:aggregate/delete', async (c) => {
  const aggregate = c.req.param('aggregate');
  const payload = await c.req.json().catch(() => ({}));
  const ev: ReceivedEvent = {
    ts: new Date().toISOString(),
    aggregate,
    event_type: 'delete',
    payload,
  };
  received.push(ev);
  console.log(JSON.stringify({ tag: 'mock-kernel', ...ev }));
  return c.json({ ok: true });
});

const port = Number(process.env.MOCK_KERNEL_PORT ?? 9090);
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`mock-kernel listening on http://127.0.0.1:${info.port}`);
});
