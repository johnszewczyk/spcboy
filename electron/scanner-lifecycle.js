const SCAN_LIFECYCLE_PHASES = Object.freeze([
  "preparing",
  "discovery",
  "planning",
  "archiveListing",
  "materialization",
  "inspection",
  "persistence",
  "publication",
  "cleanup"
]);

const scanLifecyclePhaseSet = new Set(SCAN_LIFECYCLE_PHASES);

function scanProgressPhase(phase, progress = {}) {
  if (!scanLifecyclePhaseSet.has(phase)) throw new Error(`Unknown scanner lifecycle phase: ${phase}`);
  return { ...progress, phase };
}

function createScannerPhaseTimeline(now = () => Number(process.hrtime.bigint()) / 1_000_000) {
  const startedAt = now();
  let currentPhase = null;
  let phaseStartedAt = startedAt;
  const phaseDurationsMs = Object.fromEntries(SCAN_LIFECYCLE_PHASES.map((phase) => [phase, 0]));
  return {
    enter(phase, progress = {}) {
      if (!scanLifecyclePhaseSet.has(phase)) throw new Error(`Unknown scanner lifecycle phase: ${phase}`);
      const timestamp = now();
      if (currentPhase && currentPhase !== phase) {
        phaseDurationsMs[currentPhase] += Math.max(0, timestamp - phaseStartedAt);
        phaseStartedAt = timestamp;
      } else if (!currentPhase) {
        phaseStartedAt = timestamp;
      }
      currentPhase = phase;
      return scanProgressPhase(phase, {
        ...progress,
        elapsedMs: Math.max(0, timestamp - startedAt),
        phaseElapsedMs: Math.max(0, timestamp - phaseStartedAt),
        phaseDurationsMs: { ...phaseDurationsMs }
      });
    },
    snapshot() {
      const timestamp = now();
      const durations = { ...phaseDurationsMs };
      if (currentPhase) durations[currentPhase] += Math.max(0, timestamp - phaseStartedAt);
      return { elapsedMs: Math.max(0, timestamp - startedAt), phaseDurationsMs: durations };
    }
  };
}

module.exports = { SCAN_LIFECYCLE_PHASES, scanProgressPhase, createScannerPhaseTimeline };
