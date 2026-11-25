import { readFileSync } from 'node:fs';
import { packagePath } from './lib/package-root.js';

interface PackageJson {
  name?: string;
  version?: string;
}

const packageJsonPath = packagePath('package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;

export const APP_NAME = packageJson.name ?? '@ai-agent-manager/cli';
export const APP_VERSION = packageJson.version ?? '0.0.0';
