function createAsyncLimiter(limit) {
  const capacity = Math.max(1, Number(limit) || 1);
  let active = 0;
  const waiters = [];

  function drain() {
    while (active < capacity && waiters.length) {
      const waiter = waiters.shift();
      if (waiter.signal?.aborted) {
        waiter.reject(cancellationError(waiter.signal, new Error("Library operation cancelled")));
        continue;
      }
      waiter.signal?.removeEventListener("abort", waiter.abort);
      active += 1;
      waiter.resolve();
    }
  }

  async function acquire(signal) {
    if (signal?.aborted) throw cancellationError(signal, new Error("Library operation cancelled"));
    if (active < capacity) {
      active += 1;
      return;
    }
    await new Promise((resolve, reject) => {
      const waiter = { signal, resolve, reject, abort: null };
      waiter.abort = () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(cancellationError(signal, new Error("Library operation cancelled")));
      };
      waiters.push(waiter);
      signal?.addEventListener("abort", waiter.abort, { once: true });
    });
  }

  function release() {
    active = Math.max(0, active - 1);
    drain();
  }

  return async function run(operation, { signal = null } = {}) {
    await acquire(signal);
    try {
      if (signal?.aborted) throw cancellationError(signal, new Error("Library operation cancelled"));
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
