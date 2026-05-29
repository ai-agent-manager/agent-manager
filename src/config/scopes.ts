/**
 * Where skills are installed to.
 *
 * - `system`  — the user's home directory (e.g. ~/.claude/skills/)
 * - `repo`    — the current git repository (e.g. <repo>/.claude/skills/)
 */
export type InstallScope = 'system' | 'repo';
