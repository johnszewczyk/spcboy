function createAsyncLimiter(limit) {
  let active = 0;
  const waiters = [];

  async function acquire() {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
    active += 1;
  }

  function release() {
    active -= 1;
    waiters.shift()?.();
  }

  return async function run(operation) {
    await acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function cancellationError(signal, fallback) {
  return signal?.reason instanceof Error ? signal.reason : fallback;
}

async function withScanTimeout(operation, milliseconds, description, { signal = null } = {}) {
  const controller = new AbortController();
  const timeoutError = new Error(`Timed out after ${milliseconds / 1000} seconds: ${description}`);
  const abortFromCaller = () => controller.abort(cancellationError(signal, new Error("Library operation cancelled")));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError), milliseconds);
  timer.unref?.();
  try {
    if (controller.signal.aborted) throw cancellationError(controller.signal, new Error("Library operation cancelled"));
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw cancellationError(controller.signal, timeoutError);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw cancellationError(controller.signal, error);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

module.exports = { createAsyncLimiter, withScanTimeout };
