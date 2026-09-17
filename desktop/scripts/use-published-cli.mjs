// Release CI uses the exact CLI version published before the desktop job starts.
import { readFile, writeFile } from 'node:fs/promises';
const file = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(await readFile(file, 'utf8'));
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Pass an exact release version.');
pkg.version = version;
pkg.dependencies['@ai-agent-manager/cli'] = version;
await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
