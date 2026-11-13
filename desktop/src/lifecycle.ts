/** Close requests share one drain. Initialization is included so a quit during
 * startup cannot orphan the server once it finishes listening. */
export function shutdownOnce<T extends { stop(): Promise<void> }>(started: Promise<T>, closed: () => void) {
  let pending: Promise<void> | undefined;
  return () => pending ??= (async () => {
    const handle = await started;
    await handle.stop();
    closed();
  })();
}
