/** The fixed OAuth callback port is shared by every front door in this process.
 * Callers acquire once around token resolution, never around downloads/installs.
 */
let tail = Promise.resolve();

export async function withAuthCoordinator<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const previous = tail;
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  tail = previous.then(() => turn);
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal?.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
    signal?.throwIfAborted();
    return await run();
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    release();
  }
}
