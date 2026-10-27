/**
 * Knowledge 抽取任务内存态（本期临时方案，下期持久化）。
 *
 * 背景：KS → Panel 的 status-callback 是 S2S，没有 owner user_key，
 * 无法直接以 owner 身份打内核 /v3/meta/asset/create（ForCaller 路由要求
 * caller.user_id === owner_user_id）。所以 Panel 在 code-graph/create
 * （前端发起、带 user_key）时把 owner key 临时记进内存，等 callback
 * ready 时取出来以 owner 身份注册 meta asset。
 *
 * 进程重启会丢任务——已知 corner，由前端 register-meta 兜底补建，
 * 下期持久化后根治。
 */

export interface KnowledgeTask {
  knowledge_id: string;
  type: 'wiki' | 'code-graph';
  team_id: string;
  owner_user_id: string;
  /** callback S2S 注册 asset 时以 owner 身份打 meta API 用。 */
  owner_user_key: string;
  service_id: string;
  created_at: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h：codegraph 构建通常数分钟，留足余量

export class KnowledgeTaskRegistry {
  private readonly tasks = new Map<string, KnowledgeTask>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  record(task: KnowledgeTask): void {
    this.sweep();
    this.tasks.set(task.knowledge_id, task);
  }

  peek(knowledgeId: string): KnowledgeTask | undefined {
    this.sweep();
    return this.tasks.get(knowledgeId);
  }

  /** 取出并删除——callback 注册成功后调用，清掉已完结任务。 */
  take(knowledgeId: string): KnowledgeTask | undefined {
    const t = this.tasks.get(knowledgeId);
    this.tasks.delete(knowledgeId);
    return t;
  }

  size(): number {
    return this.tasks.size;
  }

  /** 删掉过期任务，防泄漏。record/peek 时顺手调。 */
  sweep(now: number = Date.now()): void {
    for (const [id, t] of this.tasks) {
      if (now - t.created_at > this.ttlMs) this.tasks.delete(id);
    }
  }
}
