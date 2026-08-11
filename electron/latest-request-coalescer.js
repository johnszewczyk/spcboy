function createLatestRequestCoalescer(run, supersededValue) {
  let running = false;
  let pending = null;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const request = pending;
        pending = null;
        try {
          request.resolve(await run(...request.args));
        } catch (error) {
          request.reject(error);
        }
      }
    } finally {
      running = false;
      if (pending) void drain();
    }
  }

  return (...args) => new Promise((resolve, reject) => {
    if (pending) pending.resolve(supersededValue);
    pending = { args, resolve, reject };
    void drain();
  });
}

module.exports = { createLatestRequestCoalescer };
