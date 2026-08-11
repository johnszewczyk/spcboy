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

async function withScanTimeout(operation, milliseconds, description) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${milliseconds / 1000} seconds: ${description}`)), milliseconds);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { createAsyncLimiter, withScanTimeout };
