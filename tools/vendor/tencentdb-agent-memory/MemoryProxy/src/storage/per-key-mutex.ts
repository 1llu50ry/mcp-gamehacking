/**
 * per-key mutex —— 让同一个 key 的 async 操作串行执行，不同 key 完全并发。
 *
 * 用于 KvBindingRepo.touchLastSeen / KvExtractStore.incrBy 等 R-M-W 操作，
 * 在**单节点内**消除竞争。跨节点场景见迁移方案 §6.2 的分析（业务可接受精度损失）。
 *
 * 实现思路：给每个 key 维护一个 Promise 链，withPerKeyLock 在旧链尾追加新任务。
 * 任务完成后如果自己还是链尾就删掉——避免长期持有 dead entry。
 */
const inflight = new Map<string, Promise<unknown>>();

export function withPerKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = inflight.get(key) ?? Promise.resolve();
  // 两个位置都用 fn —— reject/fulfill 都要串行等待，防止一个抛出后
  // 后来的任务 leak 到旧链之前。
  const cur = prev.then(fn, fn) as Promise<T>;
  // tail 用于登记链尾 & 清理；把 rejection 转成 resolved 避免"未处理拒绝"警告。
  // 真实错误仍会通过 cur 返回给调用方。
  const tail: Promise<void> = cur.then(() => {}, () => {}).finally(() => {
    if (inflight.get(key) === tail) inflight.delete(key);
  });
  inflight.set(key, tail);
  return cur;
}

/** 测试专用：清空全部 in-flight 锁（不等待完成，用完请自己 await）。 */
export function __resetPerKeyLocksForTests(): void {
  inflight.clear();
}
