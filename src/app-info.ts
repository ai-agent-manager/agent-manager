import { readFileSync } from 'node:fs';

interface PackageJson {
  name?: string;
  version?: string;
}

const packageJsonPath = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;

export const APP_NAME = packageJson.name ?? '@ai-agent-manager/cli';
export const APP_VERSION = packageJson.version ?? '0.0.0';
