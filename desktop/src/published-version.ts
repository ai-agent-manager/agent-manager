import { fileURLToPath } from 'node:url';

/** Public npm can briefly return 404 immediately after a successful publish. */
export async function waitForPublishedVersion(version: string, {
  timeoutMs = 180_000, intervalMs = 5_000, fetchImpl = fetch,
}: { timeoutMs?: number; intervalMs?: number; fetchImpl?: typeof fetch } = {}): Promise<void> {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Pass an exact release version.');
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetchImpl(`https://registry.npmjs.org/@ai-agent-manager%2fcli/${version}`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, end - Date.now()))), cache: 'no-store',
      });
      if (response.ok && (await response.json() as { version?: string }).version === version) return;
      await response.body?.cancel();
    } catch { /* Retry transient propagation/network failures until the deadline. */ }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(intervalMs, end - Date.now()))));
  }
  throw new Error(`CLI ${version} is not available from the public npm registry after ${timeoutMs / 1000}s. Retry the desktop release job.`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await waitForPublishedVersion(process.argv[2] ?? '');
  console.log(`CLI ${process.argv[2]} is available from the public npm registry.`);
}
