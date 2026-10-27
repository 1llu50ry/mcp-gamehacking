/**
 * Auth Store (zustand)
 *
 * 对接新面板 Control（无 Cookie、无状态代理，见 09 设计文档 §3.3）。
 * 登录凭证（instance_id + user_key）缓存在 localStorage（lib/panelSession.ts），
 * "退出登录"/"会话失效"都只是清本地缓存，Control 无登出 API、无服务端会话表。
 *
 * 多 tab 同步：通过 storage 事件监听 localStorage 变化。
 *   - 其他 tab 登录 → 本 tab 自动恢复登录态（checkSession）
 *   - 其他 tab 登出 / 401 → 本 tab 自动退出到 LoginGate
 *
 * auth 三态：
 *   - null      检测登录态中（App 启动时调 checkSession 读取 localStorage 缓存）
 *   - undefined 确认未登录 → 渲染 LoginGate
 *   - AuthState 已登录 → 渲染主界面
 */
import { create } from 'zustand';
import { readAuth, clearAuth, resumeSession, type AuthState } from '@/components/LoginGate';
import { onUnauthorized } from '@/lib/teamApi';
import { clearBackendCache, writeActiveTeamId } from '@/services';

const PANEL_SESSION_KEY = 'tdai-panel.session';

interface AuthStore {
  auth: AuthState | null | undefined;
  /** 登录成功后写入（LoginGate 的 onLoggedIn 回调） */
  setAuth: (auth: AuthState) => void;
  /** 退出登录：清本地 localStorage 会话，回到 LoginGate（无后端调用） */
  logout: () => Promise<void>;
  /** App 启动时读取 localStorage 缓存；不管结果如何都会把 auth 从 null 推进到确定态 */
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  auth: null,

  setAuth: (auth) => {
    set({ auth });
  },

  logout: async () => {
    // 新面板无服务端会话，登出即清本地缓存，无需（也没有）后端登出接口。
    // 清模块级后端缓存（teams/agents/tasks），避免新用户登录后短暂看到上一个用户的列表。
    // 用 clearBackendCache 而非 invalidateBackendCache：后者会广播事件触发已挂载页面的
    // refetch listener，此时还在用旧 session Header 发请求，会把旧数据重新拉回来；
    // 这里只清缓存，让新用户登录挂载组件时自然走首次拉取。
    clearBackendCache();
    // activeTeamId 可能指向旧用户才有权限的 team，清掉避免新用户登录后选了一个没权限的 team。
    writeActiveTeamId(null);
    clearAuth();
    set({ auth: undefined });
  },

  checkSession: async () => {
    const cached = readAuth();
    if (cached) {
      set({ auth: cached });
      return;
    }
    const auth = await resumeSession();
    set({ auth: auth ?? undefined });
  },
}));

/**
 * 跨 tab 同步：监听 localStorage 的 storage 事件。
 *
 * storage 事件只在"其他 tab"修改 localStorage 时触发（本 tab 的写入不会触发），
 * 非常适合做跨 tab 状态同步。
 *
 *   - 其他 tab 登录（写入 tdai-panel.session）→ 本 tab 恢复登录态
 *   - 其他 tab 登出 / 401（删除 tdai-panel.session）→ 本 tab 退出到 LoginGate
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== PANEL_SESSION_KEY) return;

    if (e.newValue === null) {
      // 其他 tab 登出了 → 本 tab 同步退出
      clearBackendCache();
      writeActiveTeamId(null);
      clearAuth();
      useAuthStore.setState({ auth: undefined });
    } else {
      // 其他 tab 登录了 → 本 tab 恢复登录态
      void useAuthStore.getState().checkSession();
    }
  });
}

// 任意 meta 请求返回 HTTP 401 时（如 Control 校验错误落在该码），全局清会话回到登录页。
// 新面板下这不是主要的登出触发路径（主动登出走 logout()），仅作兜底。
// 与 logout() 一样清缓存，否则 401 重登后仍会短暂看到上个用户的列表。
// 只需在 store 模块加载时注册一次。
onUnauthorized(() => {
  clearBackendCache();
  writeActiveTeamId(null);
  clearAuth();
  useAuthStore.setState({ auth: undefined });
});
