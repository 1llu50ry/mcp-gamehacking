#!/usr/bin/env bash
# install-git-hooks.sh — 在本仓库启用 secret-scan pre-commit hook
#
# 用法：bash scripts/install-git-hooks.sh
#
# 效果：每次 `git commit` 前自动跑 scripts/secret-scan.sh，命中即拒绝提交。
# 卸载：rm .git/hooks/pre-commit
set -eu

repo_root=$(git rev-parse --show-toplevel)
hook_path="$repo_root/.git/hooks/pre-commit"

cat > "$hook_path" <<'EOF'
#!/usr/bin/env bash
# 自动安装的 pre-commit hook —— 见 scripts/install-git-hooks.sh
repo_root=$(git rev-parse --show-toplevel)
exec bash "$repo_root/scripts/secret-scan.sh"
EOF

chmod +x "$hook_path"
echo "✓ pre-commit hook 已安装到 $hook_path"
echo "  每次 git commit 前会跑 secret-scan.sh；命中敏感信息即拒绝提交。"
echo "  临时跳过：git commit --no-verify"
