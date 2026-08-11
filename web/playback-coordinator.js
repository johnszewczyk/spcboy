(() => {
  let transition = Promise.resolve();
  let generation = 0;

  function begin() {
    generation += 1;
    return generation;
  }

  function isCurrent(requestGeneration) {
    return requestGeneration === generation;
  }

  function clampPosition(positionSeconds, durationSeconds) {
    const position = Number(positionSeconds) || 0;
    const duration = Math.max(0, Number(durationSeconds) || 0);
    return Math.max(0, Math.min(position, duration));
  }

  function enqueue(work) {
    const result = transition.then(work);
    transition = result.catch(() => {});
    return result;
  }

  window.SPCBoyPlaybackCoordinator = Object.freeze({ begin, isCurrent, enqueue, clampPosition });
})();
