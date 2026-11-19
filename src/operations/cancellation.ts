import { AuthCancelledError } from '../auth/flow.js';

/** Cancellation at the operation boundary is independent of its current phase. */
export class OperationCancelledError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'OperationCancelledError';
  }
}

export function checkOperationCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationCancelledError();
}

export function rethrowOperationError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted || error instanceof AuthCancelledError) throw new OperationCancelledError();
  throw error;
}

export async function withOperationCancellation<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  checkOperationCancelled(signal);
  try {
    const result = await run();
    checkOperationCancelled(signal);
    return result;
  } catch (error) {
    rethrowOperationError(error, signal);
  }
}
