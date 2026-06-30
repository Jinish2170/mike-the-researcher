export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  shouldRetry?: (err: Error) => boolean;
  onRetry?: (attempt: number, err: Error) => void;
}

export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 1000, shouldRetry, onRetry } = opts;

  let lastError: Error;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) break;
      if (shouldRetry && !shouldRetry(lastError)) break;

      onRetry?.(attempt + 1, lastError);
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
