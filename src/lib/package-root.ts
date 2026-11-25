import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@ai-agent-manager/cli';

/**
 * Directory containing this package's package.json, assets/ and schemas/.
 *
 * The published CLI is an esbuild bundle whose shared code lands in chunks at
 * varying depths under dist/, so module-relative paths like '../../assets' are
 * not stable. Walking up to our own package.json works from src/ (tsx), from
 * the bundle, and from an installed copy in node_modules.
 */
export function findPackageRoot(from: string): string {
  let dir = from;
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === PACKAGE_NAME) return dir;
      } catch { /* Unreadable manifest: keep walking. */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate the ${PACKAGE_NAME} package root from ${from}`);
    dir = parent;
  }
}

let cached: string | undefined;

export function packageRoot(): string {
  return cached ??= findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
}

export function packagePath(...segments: string[]): string {
  return path.join(packageRoot(), ...segments);
}
