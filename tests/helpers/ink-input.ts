import { vi } from 'vitest';

type Stdin = { write: (input: string) => void };

/**
 * Ink attaches `useInput` handlers in effects that run after a frame is drawn,
 * and the ink-testing-library stdin drops anything written while no handler is
 * listening. Yield to the event loop so pending effects run before each write.
 */
export async function settleInk(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function press(stdin: Stdin, input: string): Promise<void> {
  await settleInk();
  stdin.write(input);
  await settleInk();
}

export async function waitForFrame(
  lastFrame: () => string | undefined,
  text: string,
  timeout = 10_000,
): Promise<void> {
  await vi.waitFor(
    () => {
      if (!(lastFrame() ?? '').includes(text)) {
        throw new Error(`Frame does not contain ${JSON.stringify(text)}:\n${lastFrame() ?? ''}`);
      }
    },
    { timeout, interval: 10 },
  );
}
