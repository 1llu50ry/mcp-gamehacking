/**
 * storage-utils.ts — 本地演示数据层的共享底座。
 *
 * 供 agent-template-store / asset-scope-store / user-asset-store /
 * account-store / user-profile-store 共用：
 *   - safeParse：容错的 JSON.parse，解析失败时回退默认值；
 *   - emitChange / CHANGE_EVENT：写操作后广播一个全局事件，配合
 *     useChangeNotifier 让订阅方（各 useXxx hook）自动重渲染；
 *   - useChangeNotifier：简易 forceUpdate，监听 CHANGE_EVENT 与浏览器
 *     原生 'storage' 事件（跨 tab 同步）。
 *
 * 这些 store 均为前端演示阶段的 localStorage 实现，后端上线后整批替换为
 * fetch 即可，UI 层不需要改。
 */

import { useEffect, useState } from 'react';

export const CHANGE_EVENT = 'tdai-memory.demo-store-change';

export function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function emitChange(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

/** 简易 forceUpdate：localStorage / 自定义事件触发后 +1。 */
export function useChangeNotifier(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((v) => v + 1);
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange); // 跨 tab 同步
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return tick;
}
