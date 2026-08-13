const MEDIA_OPERATION_STAGES = Object.freeze([
  "discovery",
  "archiveListing",
  "materialization",
  "routing",
  "metadata",
  "playback",
  "persistence"
]);

const MEDIA_OPERATION_STATES = Object.freeze([
  "successful",
  "unsupported",
  "failed",
  "cancelled",
  "incomplete",
  "archiveCompleted"
]);

function createMediaOutcome({
  identity,
  route = null,
  stage,
  state,
  durationMs = 0,
  message = ""
}) {
  if (!MEDIA_OPERATION_STAGES.includes(stage)) throw new Error(`Unknown media-operation stage: ${stage}`);
  if (!MEDIA_OPERATION_STATES.includes(state)) throw new Error(`Unknown media-operation state: ${state}`);
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

function formatMediaOutcome(outcome) {
  const identity = outcome.identity.archiveEntry
    ? `${outcome.identity.sourcePath}#${outcome.identity.archiveEntry}`
    : outcome.identity.sourcePath;
  const backend = outcome.route?.backendId ? ` [${outcome.route.backendId}]` : "";
  const detail = outcome.message ? `: ${outcome.message}` : "";
  return `${identity}${backend}: ${outcome.stage}${detail}`;
}

function summarizeMediaOutcomes(outcomes) {
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
  MEDIA_OPERATION_STAGES,
  MEDIA_OPERATION_STATES,
  createMediaOutcome,
  formatMediaOutcome,
  summarizeMediaOutcomes
};
