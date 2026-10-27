/**
 * Git URL 归一化 — 将 SSH/HTTPS/裸路径统一为 host/namespace/project 形式。
 *
 * 示例：
 *   git@gitlab.example.com:namespace/project/repo.git      → gitlab.example.com/namespace/project/repo
 *   https://gitlab.example.com/namespace/project/repo.git  → gitlab.example.com/namespace/project/repo
 *   gitlab.example.com/namespace/project/repo              → gitlab.example.com/namespace/project/repo (pass-through)
 */

/**
 * 归一化 Git URL 为 `host/path` 形式（不含 .git 后缀）。
 */
export function normalizeRepoUrl(input: string): string {
  let host: string;
  let path: string;

  // SSH: git@host:path.git
  const sshMatch = input.match(/^(?:ssh:\/\/)?(?:\w+@)([^:/]+)[:/](.+?)(?:\.git)?$/);
  if (sshMatch) {
    host = sshMatch[1];
    path = sshMatch[2];
    return `${host}/${path.replace(/\.git$/, "")}`;
  }

  // HTTPS: https://host/path.git
  const httpsMatch = input.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    host = httpsMatch[1];
    path = httpsMatch[2];
    return `${host}/${path.replace(/\.git$/, "")}`;
  }

  // 已经是归一化形式（host/namespace/project）
  return input.replace(/\.git$/, "");
}

/**
 * 生成数据源唯一键：normalized_url + ":" + branch
 */
export function sourceKey(repo: string, branch: string): string {
  return `${normalizeRepoUrl(repo)}:${branch || "main"}`;
}

/**
 * 从唯一键中解出 repo 和 branch
 */
export function parseSourceKey(key: string): { repo: string; branch: string } {
  const lastColon = key.lastIndexOf(":");
  return {
    repo: key.slice(0, lastColon),
    branch: key.slice(lastColon + 1),
  };
}
