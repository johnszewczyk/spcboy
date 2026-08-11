const SCAN_STAGES = Object.freeze([
  "discovery",
  "archiveListing",
  "materialization",
  "routing",
  "metadata",
  "playback",
  "persistence"
]);

const SCAN_STATES = Object.freeze([
  "successful",
  "unsupported",
  "failed",
  "cancelled",
  "incomplete",
  "archiveCompleted"
]);

function createScanOutcome({
  identity,
  route = null,
  stage,
  state,
  durationMs = 0,
  message = ""
}) {
  if (!SCAN_STAGES.includes(stage)) throw new Error(`Unknown scan stage: ${stage}`);
  if (!SCAN_STATES.includes(state)) throw new Error(`Unknown scan state: ${state}`);
  return Object.freeze({
    identity: Object.freeze({
      rootPath: identity?.rootPath || "",
      sourcePath: identity?.sourcePath || "",
      archiveEntry: identity?.archiveEntry || null
    }),
    route: route ? Object.freeze({ ...route }) : null,
    stage,
    state,
    durationMs: Math.max(0, Number(durationMs) || 0),
    message: String(message || "")
  });
}

function formatScanOutcome(outcome) {
  const identity = outcome.identity.archiveEntry
    ? `${outcome.identity.sourcePath}#${outcome.identity.archiveEntry}`
    : outcome.identity.sourcePath;
  const backend = outcome.route?.backendId ? ` [${outcome.route.backendId}]` : "";
  const detail = outcome.message ? `: ${outcome.message}` : "";
  return `${identity}${backend}: ${outcome.stage}${detail}`;
}

function summarizeScanOutcomes(outcomes) {
  return outcomes.reduce((summary, outcome) => {
    summary.total += 1;
    summary.byStage[outcome.stage] = (summary.byStage[outcome.stage] || 0) + 1;
    summary.byState[outcome.state] = (summary.byState[outcome.state] || 0) + 1;
    if (outcome.route?.backendId) {
      summary.byBackend[outcome.route.backendId] = (summary.byBackend[outcome.route.backendId] || 0) + 1;
    }
    return summary;
  }, {
    total: 0,
    byStage: {},
    byState: {},
    byBackend: {}
  });
}

module.exports = {
  SCAN_STAGES,
  SCAN_STATES,
  createScanOutcome,
  formatScanOutcome,
  summarizeScanOutcomes
};
