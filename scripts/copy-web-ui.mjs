import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../web-ui/dist/', import.meta.url));
const destination = fileURLToPath(new URL('../assets/web-ui/', import.meta.url));
// Validate the build before deleting the previous generated assets.
await stat(new URL('../web-ui/dist/index.html', import.meta.url));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log('Copied web UI build into assets/web-ui.');
