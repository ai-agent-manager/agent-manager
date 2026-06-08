#!/usr/bin/env bash
#
# Creates a temporary git repository that mimics a Claude Code plugin
# in the marketplace layout (skills/<name>/SKILL.md).
#
# Usage:
#   ./create-test-plugin.sh [target-dir]
#
# Default target: /tmp/test-plugin

set -euo pipefail

TARGET="${1:-/tmp/test-plugin}"

if [ -d "$TARGET" ]; then
  echo "Removing existing $TARGET"
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET"
cd "$TARGET"
git init
git config user.email "test@example.com"
git config user.name "Test User"

# ── Multi-skill layout: skills/<name>/SKILL.md ──────────────────────

mkdir -p skills/code-review
cat > skills/code-review/SKILL.md << 'EOF'
---
description: Review code for quality issues
---

Review the code and report findings.
EOF

mkdir -p skills/refactor
cat > skills/refactor/SKILL.md << 'EOF'
---
description: Refactor code for clarity
---

Refactor the selected code.
EOF

# ── Commit so the repo is cloneable ─────────────────────────────────

git add -A
git commit -m "init: test plugin with two skills"

echo ""
echo "Test plugin repo created at: $TARGET"
echo "Skills:"
echo "  - skills/code-review/SKILL.md"
echo "  - skills/refactor/SKILL.md"
