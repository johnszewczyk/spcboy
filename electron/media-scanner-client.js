const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const MEDIA_SCANNER_CONTRACT = "media-scanner-jsonl";
const MEDIA_SCANNER_VERSION = 1;

function defaultExecutablePath() {
  return process.env.SPCBOY_MEDIA_SCANNER
    || path.join(__dirname, "..", "native", "media-scan");
}

function validateEvent(event) {
  if (!event || typeof event !== "object") throw new Error("Media scanner emitted a non-object event");
  if (event.contract !== MEDIA_SCANNER_CONTRACT) {
    throw new Error(`Media scanner contract mismatch: expected ${MEDIA_SCANNER_CONTRACT}`);
  }
  if (Number(event.version) !== MEDIA_SCANNER_VERSION) {
    throw new Error(`Media scanner protocol version mismatch: expected ${MEDIA_SCANNER_VERSION}, received ${event.version}`);
  }
  if (!event.kind || !Number.isInteger(event.sequence)) {
    throw new Error("Media scanner event is missing kind or sequence");
  }
  return event;
}

async function runMediaScanner({
  command,
  args = [],
  executablePath = defaultExecutablePath(),
  signal,
  onEvent = () => {},
  terminationGraceMs = 1_000
} = {}) {
  if (!command) throw new Error("Media scanner command is required");
  if (signal?.aborted) throw signal.reason || new Error("Media scanner operation cancelled");

  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [command, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const events = [];
    const standardError = [];
    let protocolError = null;
    let aborted = false;
    let expectedSequence = 0;
    let forceKillTimer = null;

    const stopProcess = () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (!child.killed) child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, Math.max(0, Number(terminationGraceMs) || 0));
      forceKillTimer.unref?.();
    };

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!line || protocolError) return;
      try {
        const event = validateEvent(JSON.parse(line));
        if (event.sequence !== expectedSequence) {
          throw new Error(`Media scanner event sequence mismatch: expected ${expectedSequence}, received ${event.sequence}`);
        }
        expectedSequence += 1;
        events.push(event);
        onEvent(event);
      } catch (error) {
        protocolError = error;
        stopProcess();
      }
    });
    child.stderr.on("data", (chunk) => standardError.push(chunk));

    const abort = () => {
      aborted = true;
      stopProcess();
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.once("error", (error) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
      reject(new Error(`Could not start media scanner: ${error.message}`));
    });
    child.once("close", (code, closeSignal) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
      lines.close();
      if (protocolError) {
        reject(protocolError);
        return;
      }
      if (aborted) {
        reject(signal?.reason || new Error("Media scanner operation cancelled"));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(standardError).toString("utf8").trim();
        const error = new Error(`Media scanner failed${code === null ? ` from ${closeSignal || "unknown signal"}` : ` with exit code ${code}`}${detail ? `: ${detail}` : ""}`);
        error.events = events;
        reject(error);
        return;
      }
      resolve(events);
    });
  });
}

module.exports = {
  MEDIA_SCANNER_CONTRACT,
  MEDIA_SCANNER_VERSION,
  defaultExecutablePath,
  runMediaScanner,
  validateEvent
};
