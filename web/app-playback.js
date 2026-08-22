(() => {
const playbackApp = window.SPCBoyApp;
const {
  state,
  refs,
  formatTime,
  currentFadeSeconds,
  targetPlaybackSeconds,
  currentTrack,
  selectedTrack,
  activeTrackInfo
} = playbackApp;

const NATIVE_STATE_POLL_MS = 1000;

let playbackGeneration = 0;
let nativeStatePollTimer = 0;
let nativePlaybackInitialized = false;
let mediaSessionHandlersBound = false;
let finalizePlaybackPromise = null;
const playbackCoordinator = window.SPCBoyPlaybackCoordinator;
const playbackBackends = window.SPCBoyPlaybackBackends;
let queuedSkipRequest = null;
let queuedSkipTimer = 0;
let playbackWindow = null;
const TRANSPORT_DECLICK_MS = 10;

function waitForAudioEnvelope(durationMs) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Math.ceil(durationMs))));
}

async function fadeActiveOutput(durationMs = TRANSPORT_DECLICK_MS) {
  const activeTrack = activeTrackInfo();
  if (nativePlaybackInitialized && activeTrack) {
    try {
      await window.spcBoy.nativePlaybackRampGain?.(0, durationMs);
    } catch {
      // The normal stop path still has to complete if a helper exited between
      // the transition request and its short output envelope.
    }
  }
  await waitForAudioEnvelope(durationMs);
}

function clearQueuedSkipTimer() {
  if (!queuedSkipTimer) return;
  window.clearTimeout(queuedSkipTimer);
  queuedSkipTimer = 0;
}

function setAudioSettings(settings = {}) {
  if (settings.appVolume !== undefined) playbackApp.state.appVolume = playbackApp.normalizeAppVolume(settings.appVolume);
  if (typeof settings.equalizerEnabled === "boolean") playbackApp.state.equalizerEnabled = settings.equalizerEnabled;
  if (Array.isArray(settings.equalizerBandGains)) playbackApp.state.equalizerBandGains = settings.equalizerBandGains.map(playbackApp.normalizeEqualizerGain);
}

function resetNativePlaybackSnapshot() {
  state.nativePlayback = {
    transportState: "stopped",
    outputState: "idle",
    trackLoaded: false,
    decodeError: false,
    reachedEnd: false,
    bufferedFrames: 0,
    ringBufferFrames: 0,
    underrunCount: 0,
    framesRequested: 0,
    framesSupplied: 0,
    positionMs: 0
  };
}

function currentTotalSeconds(track) {
  return currentOutputBasePlaybackSeconds(track) + currentFadeSeconds(track);
}

function effectiveTotalSeconds(track) {
  return playbackWindow?.trackId === track?.id
    ? playbackWindow.totalSeconds
    : currentTotalSeconds(track);
}

function currentBasePlaybackSeconds(track) {
  if (state.longPlayEnabled) {
    return state.manualPlayTimeSeconds;
  }

  if (track?.basePlaybackSeconds > 0) {
    return track.basePlaybackSeconds;
  }

  return state.manualPlayTimeSeconds;
}

function playbackSpeedForTrack(track) {
  const sourceName = track?.archiveEntry || track?.sourceFilename || track?.path || "";
  const backend = playbackBackends.forPath(sourceName);
  const extension = sourceName.slice(sourceName.lastIndexOf(".")).toLowerCase();
  if (backend?.playbackSpeedMode === "native-tempo" && backend.playbackSpeedExtensions?.includes(extension)) {
    if (backend.id === "libgme" && state.playbackSpeedEnabled) return state.playbackSpeed;
    if (backend.id === "libvgm" && state.libvgmPlaybackSpeedEnabled) return state.libvgmPlaybackSpeed;
  }
  return { numerator: 1, denominator: 1 };
}

function currentOutputBasePlaybackSeconds(track) {
  return playbackApp.scalePlaybackMilliseconds(
    Math.round(currentBasePlaybackSeconds(track) * 1000),
    playbackSpeedForTrack(track)
  ) / 1000;
}

function shouldPreserveFieldValue(element) {
  return document.activeElement === element;
}

function clearNativeStatePoll() {
  if (!nativeStatePollTimer) {
    return;
  }

  window.clearTimeout(nativeStatePollTimer);
  nativeStatePollTimer = 0;
}

function clearPlaybackRuntimeState() {
  clearNativeStatePoll();
}

async function stopAllOutput({ declick = true, keepNativeOutput = false } = {}) {
  if (declick) await fadeActiveOutput();
  if (nativePlaybackInitialized) {
    try {
      if (keepNativeOutput) await window.spcBoy.nativePlaybackUnload();
      else await window.spcBoy.nativePlaybackStop();
    } catch {
      // A stopped or not-yet-primed native session is already safe to replace.
    }
  }
}

function updateTimingSummary() {
  const track = activeTrackInfo();
  const totalSeconds = currentTotalSeconds(track);
  state.totalSeconds = totalSeconds;
  refs.songLengthLabel.textContent = formatTime(totalSeconds);
  const playlistTotalSeconds = state.playlist.reduce((sum, entry) => sum + currentOutputBasePlaybackSeconds(entry), 0);
  refs.playlistTotalLabel.textContent = formatTime(playlistTotalSeconds);
  refs.progressSlider.max = String(Math.max(totalSeconds, 1));
  if (!shouldPreserveFieldValue(refs.spcLengthInput)) {
    refs.spcLengthInput.value = formatTime(state.manualPlayTimeSeconds);
  }
  if (!shouldPreserveFieldValue(refs.spcFadeInput)) {
    refs.spcFadeInput.value = formatTime(state.spcFadeSeconds);
  }
  if (!shouldPreserveFieldValue(refs.uiItemSpacingInput)) {
    refs.uiItemSpacingInput.value = String(state.uiItemSpacingRem);
  }
  refs.spcForceLengthCheckbox.checked = state.longPlayEnabled;
  refs.queuedSkipsCheckbox.checked = state.queuedSkipsEnabled;
  refs.spcFadeCheckbox.checked = state.fadeEnabled;
  if (!shouldPreserveFieldValue(refs.sidebarFontSizeInput)) {
    refs.sidebarFontSizeInput.value = String(state.sidebarFontSizePt);
  }
  if (!shouldPreserveFieldValue(refs.playlistFontSizeInput)) {
    refs.playlistFontSizeInput.value = String(state.playlistFontSizePt);
  }
  if (!shouldPreserveFieldValue(refs.sidebarWidthInput)) {
    refs.sidebarWidthInput.value = String(state.sidebarWidthPercent);
  }
}

function bindMediaSessionHandlers() {
  if (mediaSessionHandlersBound || !("mediaSession" in navigator)) {
    return;
  }

  const handlers = {
    previoustrack: () => playAdjacent(-1),
    nexttrack: () => playAdjacent(1),
    play: () => {
      void togglePlayback().catch((error) => {
        console.error(error);
      });
    },
    pause: () => {
      if (!state.isPlaying) {
        return;
      }

      void togglePlayback().catch((error) => {
        console.error(error);
      });
    }
  };

  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Unsupported action handlers are ignored per runtime.
    }
  }

  mediaSessionHandlersBound = true;
}

function syncMediaSessionState() {
  if (!("mediaSession" in navigator)) {
    return;
  }

  bindMediaSessionHandlers();

  const track = activeTrackInfo();
  navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";

  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || track.displayName || track.filename || "SPCBoy",
    artist: track.artist && track.artist !== "—" ? track.artist : "",
    album: track.game || "",
    sourceTitle: track.system || "SPCBoy"
  });
}

function updatePlaybackReadout() {
  refs.elapsedLabel.textContent = formatTime(state.elapsedSeconds);
  refs.songLengthLabel.textContent = formatTime(state.totalSeconds);
  const playlistTotalSeconds = state.playlist.reduce((sum, entry) => sum + currentOutputBasePlaybackSeconds(entry), 0);
  refs.playlistTotalLabel.textContent = formatTime(playlistTotalSeconds);
  const currentValue = Math.min(state.elapsedSeconds, state.totalSeconds || 1);
  refs.progressSlider.value = String(currentValue);
  const percent = state.totalSeconds > 0 ? (currentValue / state.totalSeconds) * 100 : 0;
  refs.progressSliderShell.style.setProperty("--progress-percent", `${Math.max(0, Math.min(percent, 100))}%`);
  refs.playButton.querySelector("use")?.setAttribute("href", state.isPlaying ? "#icon-pause" : "#icon-play");
  syncMediaSessionState();
}

function updateNativeDiagnostics() {
  const snapshot = state.nativePlayback;
  const transportLabel = snapshot.trackLoaded
    ? `${snapshot.transportState} / ${snapshot.outputState}`
    : "native idle";
  const bufferedFrames = Number(snapshot.bufferedFrames) || 0;
  const ringBufferFrames = Number(snapshot.ringBufferFrames) || 0;
  const underrunCount = Number(snapshot.underrunCount) || 0;
  const framesRequested = Number(snapshot.framesRequested) || 0;
  const framesSupplied = Number(snapshot.framesSupplied) || 0;
  const positionSeconds = Math.max(0, (Number(snapshot.positionMs) || 0) / 1000);
  const bufferFill = ringBufferFrames > 0 ? Math.round((bufferedFrames / ringBufferFrames) * 100) : null;
  const decodeError = Boolean(snapshot.decodeError);

  refs.nativeTransportLabel.textContent = transportLabel;
  refs.nativeTrackLabel.textContent = snapshot.trackLoaded ? "Loaded" : "Not loaded";
  refs.nativeOutputLabel.textContent = snapshot.outputState || "idle";
  refs.nativePositionLabel.textContent = formatTime(positionSeconds);
  refs.nativeBufferLabel.textContent = `${bufferedFrames.toLocaleString()} / ${ringBufferFrames ? ringBufferFrames.toLocaleString() : "—"} frames`;
  refs.nativeBufferFillLabel.textContent = bufferFill === null ? "—" : `${bufferFill}%`;
  refs.nativeUnderrunLabel.textContent = String(underrunCount);
  refs.nativeFramesLabel.textContent = `${framesRequested.toLocaleString()} / ${framesSupplied.toLocaleString()}`;
  refs.nativeDecodeLabel.textContent = decodeError ? (snapshot.errorMessage || "Error") : "OK";

  for (const element of [
    refs.nativeTransportLabel,
    refs.nativeTrackLabel,
    refs.nativeOutputLabel,
    refs.nativePositionLabel,
    refs.nativeBufferLabel,
    refs.nativeBufferFillLabel,
    refs.nativeUnderrunLabel,
    refs.nativeFramesLabel,
    refs.nativeDecodeLabel
  ]) {
    element.className = "play-stat-value";
  }

  if (snapshot.transportState === "playing") {
    refs.nativeTransportLabel.classList.add("is-active");
  }

  if (bufferedFrames > 0 && ringBufferFrames > 0 && bufferedFrames < Math.min(2048, ringBufferFrames / 8)) {
    refs.nativeBufferLabel.classList.add("is-warning");
    refs.nativeBufferFillLabel.classList.add("is-warning");
  }

  if (underrunCount > 0) {
    refs.nativeUnderrunLabel.classList.add("is-warning");
  }

  if (decodeError) {
    refs.nativeTransportLabel.classList.add("is-error");
    refs.nativeUnderrunLabel.classList.add("is-error");
    refs.nativeDecodeLabel.classList.add("is-error");
  }
}

function handleNativePlaybackState(snapshot) {
  if (!snapshot) {
    return;
  }

  const track = activeTrackInfo();
  if (!track) {
    state.nativePlayback = {
      transportState: snapshot?.transport_state || "stopped",
      outputState: snapshot?.output_state || "idle",
      trackLoaded: Boolean(snapshot?.track_loaded),
      decodeError: Boolean(snapshot?.decode_error),
      reachedEnd: Boolean(snapshot?.reached_end),
      bufferedFrames: Number(snapshot?.buffered_frames) || 0,
      ringBufferFrames: Number(snapshot?.ring_buffer_frames) || 0,
      underrunCount: Number(snapshot?.underrun_count) || 0,
      framesRequested: Number(snapshot?.frames_requested) || 0,
      framesSupplied: Number(snapshot?.frames_supplied) || 0,
      positionMs: Number(snapshot?.position_ms) || 0,
      errorMessage: snapshot?.error || ""
    };
    updateNativeDiagnostics();
    return;
  }

  applyNativePlaybackSnapshot(track, snapshot, playbackGeneration);
  if (snapshot.transport_state === "ended") {
    void finalizePlaybackEnded();
    return;
  }
}

async function setPlaybackPowerSaveBlocker(enabled) {
  try {
    await window.spcBoy.setPlaybackPowerSaveBlocker(enabled);
  } catch {
    // Power-save blocker is best-effort support around playback.
  }
}

async function ensureNativePlaybackInitialized() {
  if (nativePlaybackInitialized) {
    return;
  }

  await window.spcBoy.nativePlaybackInit();
  await window.spcBoy.nativePlaybackAudioConfig(
    state.appVolume,
    state.equalizerEnabled,
    state.equalizerBandGains
  );
  nativePlaybackInitialized = true;
}

function applyNativePlaybackSnapshot(track, snapshot, generation) {
  if (generation !== playbackGeneration) {
    return;
  }

  const activeTrack = track ?? activeTrackInfo();
  const totalSeconds = effectiveTotalSeconds(activeTrack);
  const elapsedSeconds = playbackCoordinator.clampPosition((Number(snapshot?.position_ms) || 0) / 1000, totalSeconds);
  const transportState = snapshot?.transport_state || "stopped";

  state.nativePlayback = {
    transportState,
    outputState: snapshot?.output_state || "idle",
    trackLoaded: Boolean(snapshot?.track_loaded),
    decodeError: Boolean(snapshot?.decode_error),
    reachedEnd: Boolean(snapshot?.reached_end),
    bufferedFrames: Number(snapshot?.buffered_frames) || 0,
    ringBufferFrames: Number(snapshot?.ring_buffer_frames) || 0,
    underrunCount: Number(snapshot?.underrun_count) || 0,
    framesRequested: Number(snapshot?.frames_requested) || 0,
    framesSupplied: Number(snapshot?.frames_supplied) || 0,
    positionMs: Number(snapshot?.position_ms) || 0,
    errorMessage: snapshot?.error || ""
  };

  state.totalSeconds = totalSeconds;
  state.elapsedSeconds = elapsedSeconds;
  state.isPlaying = transportState === "playing";

  if (transportState === "ended") {
    state.isPlaying = false;
    state.elapsedSeconds = totalSeconds;
  }

  updatePlaybackReadout();
  updateNativeDiagnostics();
}

async function readNativePlaybackState(track, generation) {
  const snapshot = await window.spcBoy.nativePlaybackState();
  applyNativePlaybackSnapshot(track, snapshot, generation);
  return snapshot;
}

function scheduleNativePlaybackStatePoll(track, generation) {
  clearNativeStatePoll();
  if (generation !== playbackGeneration || !state.currentTrackId) {
    return;
  }

  nativeStatePollTimer = window.setTimeout(async () => {
    nativeStatePollTimer = 0;
    if (generation !== playbackGeneration || !state.currentTrackId) {
      return;
    }

    try {
      const snapshot = await readNativePlaybackState(track, generation);
      if (generation !== playbackGeneration) {
        return;
      }

      if (snapshot?.transport_state === "playing") {
        scheduleNativePlaybackStatePoll(track, generation);
        return;
      }

      if (snapshot?.transport_state === "ended") {
        void finalizePlaybackEnded();
        return;
      }

      if (snapshot?.track_loaded) {
        scheduleNativePlaybackStatePoll(track, generation);
      }
    } catch (error) {
      if (generation === playbackGeneration) {
        state.isPlaying = false;
        resetNativePlaybackSnapshot();
        updatePlaybackReadout();
        updateNativeDiagnostics();
      }
    }
  }, NATIVE_STATE_POLL_MS);
}

async function finalizePlaybackEnded() {
  if (finalizePlaybackPromise) {
    return finalizePlaybackPromise;
  }

  finalizePlaybackPromise = (async () => {
    const activeIndex = state.playlist.findIndex((track) => track.id === state.currentTrackId);
    const hasFollowingTrack = activeIndex >= 0 && activeIndex < state.playlist.length - 1;
    clearNativeStatePoll();
    state.isPlaying = false;
    state.elapsedSeconds = state.totalSeconds;
    updatePlaybackReadout();
    updateNativeDiagnostics();

    const completedQueuedSkip = queuedSkipRequest;
    const nextDelta = completedQueuedSkip?.delta || (state.repeatMode === "one" ? 0 : 1);
    const nextTrack = state.repeatMode === "one" && state.currentTrackId
      ? state.playlist.find((track) => track.id === state.currentTrackId)
      : (completedQueuedSkip || state.repeatMode === "all" || hasFollowingTrack)
        ? state.playlist[(activeIndex + nextDelta + state.playlist.length) % state.playlist.length]
        : null;
    queuedSkipRequest = null;
    clearQueuedSkipTimer();
    await stopPlaybackState({ declick: false, keepNativeOutput: Boolean(nextTrack) });

    if (completedQueuedSkip) {
      advanceToAdjacent(completedQueuedSkip.delta);
    } else if (state.repeatMode === "one" && state.currentTrackId) {
      playTrack(state.currentTrackId, 0);
    } else if (state.repeatMode === "all" || hasFollowingTrack) {
      advanceToAdjacent(1);
    }
  })();

  try {
    await finalizePlaybackPromise;
  } finally {
    finalizePlaybackPromise = null;
  }
}

async function stopPlaybackState({ declick = true, keepNativeOutput = false } = {}) {
  clearNativeStatePoll();
  playbackGeneration += 1;
  clearPlaybackRuntimeState();
  await stopAllOutput({ declick, keepNativeOutput });
  // The core owns every output path; release an archive materialization only
  // after the bridge has stopped or unloaded it.
  try { await window.spcBoy.releaseMaterializedTrack?.(); } catch {}

  await setPlaybackPowerSaveBlocker(false);
  state.currentTrackId = null;
  state.currentTrackInfo = null;
  playbackWindow = null;
  state.isPlaying = false;
  state.elapsedSeconds = 0;
  state.totalSeconds = targetPlaybackSeconds();
  resetNativePlaybackSnapshot();
  updatePlaybackReadout();
  updateNativeDiagnostics();
  playbackApp.ui.refreshPlaylistPlaybackState();
}

async function playTrackNow(trackId, startSeconds = 0, playbackOptions = null) {
  let track = state.playlist.find((entry) => entry.id === trackId);
  if (!track) {
    return;
  }

  const generation = playbackCoordinator.begin();
  playbackGeneration = generation;
  // Native-state broadcasts can arrive while the async materialize/load path is in flight.
  // Keep this request's offset immutable so a prior track cannot leak its elapsed position.
  let requestedStartSeconds = Math.max(0, Math.min(startSeconds, currentTotalSeconds(track)));
  const fadeNowSeconds = Math.max(0, Number(playbackOptions?.fadeNowSeconds) || 0);
  const normalBaseSeconds = currentOutputBasePlaybackSeconds(track);
  let playbackTotalSeconds = fadeNowSeconds > 0
    ? requestedStartSeconds + fadeNowSeconds
    : currentTotalSeconds(track);
  let playbackBaseSeconds = fadeNowSeconds > 0
    ? Math.max(0.001, requestedStartSeconds)
    : normalBaseSeconds;
  playbackWindow = fadeNowSeconds > 0
    ? { trackId: track.id, totalSeconds: playbackTotalSeconds, fadeSeconds: fadeNowSeconds }
    : null;
  clearPlaybackRuntimeState();
  await stopAllOutput({ keepNativeOutput: true });

  state.currentTrackId = track.id;
  state.selectedTrackId = track.id;
  state.currentTrackInfo = track;
  state.totalSeconds = playbackTotalSeconds;
  state.elapsedSeconds = requestedStartSeconds;

  if (state.elapsedSeconds >= state.totalSeconds) {
    state.isPlaying = false;
    playbackApp.ui.refreshPlaylistPlaybackState();
    return;
  }

  playbackApp.ui.refreshPlaylistPlaybackState();

  try {
    // Hold the archive materialization while the bridge owns the source path.
    await setPlaybackPowerSaveBlocker(true);
    const playbackPath = track.archivePath
      ? await window.spcBoy.materializeTrack(track.archivePath, track.archiveEntry)
      : track.path;
    if (!track.metadataLoaded && playbackApp.ui?.hydrateTrackMetadata) {
      track = await playbackApp.ui.hydrateTrackMetadata(track.id, playbackPath, track.sourceFilename || track.filename) || track;
      state.currentTrackInfo = track;
    }
    // Recompute the playback timing window once metadata is available so a Long
    // Play-off track uses its decoder-reported natural duration instead of the
    // manual-duration fallback that the provisional values used above.
    const recomputedTotalSeconds = fadeNowSeconds > 0
      ? requestedStartSeconds + fadeNowSeconds
      : currentTotalSeconds(track);
    requestedStartSeconds = Math.max(0, Math.min(requestedStartSeconds, recomputedTotalSeconds));
    const recomputedBaseSeconds = currentOutputBasePlaybackSeconds(track);
    playbackBaseSeconds = fadeNowSeconds > 0
      ? Math.max(0.001, requestedStartSeconds)
      : recomputedBaseSeconds;
    playbackTotalSeconds = recomputedTotalSeconds;
    playbackWindow = fadeNowSeconds > 0
      ? { trackId: track.id, totalSeconds: recomputedTotalSeconds, fadeSeconds: fadeNowSeconds }
      : null;
    state.totalSeconds = recomputedTotalSeconds;
    state.elapsedSeconds = requestedStartSeconds;
    updatePlaybackReadout();
    if (state.elapsedSeconds >= state.totalSeconds) {
      await setPlaybackPowerSaveBlocker(false);
      state.isPlaying = false;
      resetNativePlaybackSnapshot();
      playbackApp.ui.refreshPlaylistPlaybackState();
      return;
    }
    await ensureNativePlaybackInitialized();
    await window.spcBoy.nativePlaybackLoad(
      playbackPath,
      track.trackIndex || 0,
      Math.round(requestedStartSeconds * 1000),
      Math.round(playbackBaseSeconds * 1000),
      Math.round((fadeNowSeconds > 0 ? fadeNowSeconds : currentFadeSeconds(track)) * 1000),
      playbackSpeedForTrack(track)
    );
    if (generation !== playbackGeneration) {
      return;
    }

    await setPlaybackPowerSaveBlocker(true);
    await window.spcBoy.nativePlaybackPlay();
    if (generation !== playbackGeneration) {
      return;
    }

    await readNativePlaybackState(track, generation);
    playbackApp.ui.refreshPlaylistPlaybackState();
  } catch (error) {
    if (generation !== playbackGeneration) {
      return;
    }

    await setPlaybackPowerSaveBlocker(false);
    state.isPlaying = false;
    resetNativePlaybackSnapshot();
    try { await window.spcBoy.nativePlaybackClose(); } catch {}
    nativePlaybackInitialized = false;
    updatePlaybackReadout();
    updateNativeDiagnostics();
    playbackApp.ui.refreshPlaylistPlaybackState();
    throw error;
  }
}

function playTrack(trackId, startSeconds = 0, preserveQueuedSkip = false, playbackOptions = null) {
  if (!preserveQueuedSkip) {
    queuedSkipRequest = null;
    clearQueuedSkipTimer();
  }
  return playbackCoordinator.enqueue(() => playTrackNow(trackId, startSeconds, playbackOptions));
}

function advanceToAdjacent(delta) {
  if (state.playlist.length === 0) {
    return;
  }

  const active = currentTrack() ?? selectedTrack() ?? state.playlist[0];
  const currentIndex = state.playlist.findIndex((track) => track.id === active.id);
  const nextIndex = (currentIndex + delta + state.playlist.length) % state.playlist.length;
  playTrack(state.playlist[nextIndex].id, 0).catch((error) => {
    console.error(error);
  });
}

function playAdjacent(delta) {
  if (!state.queuedSkipsEnabled || !state.isPlaying || !state.currentTrackId) {
    advanceToAdjacent(delta);
    return;
  }

  if (queuedSkipRequest) {
    const request = queuedSkipRequest;
    queuedSkipRequest = null;
    clearQueuedSkipTimer();
    void (async () => {
      await fadeActiveOutput(TRANSPORT_DECLICK_MS);
      await stopPlaybackState({ declick: false });
      advanceToAdjacent(delta || request.delta);
    })().catch((error) => console.error(error));
    return;
  }

  const track = currentTrack();
  const fadeSeconds = currentFadeSeconds(track);
  const remainingSeconds = track ? Math.max(0, currentTotalSeconds(track) - state.elapsedSeconds) : 0;
  if (!track || fadeSeconds <= 0 || state.elapsedSeconds >= currentOutputBasePlaybackSeconds(track) || remainingSeconds <= 0) {
    advanceToAdjacent(delta);
    return;
  }

  const fadeDurationMs = Math.round(Math.min(fadeSeconds, remainingSeconds) * 1000);
  queuedSkipRequest = { delta, generation: playbackGeneration };
  fadeActiveOutput(fadeDurationMs).catch((error) => {
    console.error(error);
  });
  queuedSkipTimer = window.setTimeout(() => {
    const request = queuedSkipRequest;
    if (!request || request.generation !== playbackGeneration) return;
    queuedSkipTimer = 0;
    // Route timer completion through the same single-flight finalizer as a
    // natural end, so an end event arriving on the same callback cannot
    // advance the playlist twice.
    void finalizePlaybackEnded();
  }, fadeDurationMs);
}

async function togglePlayback() {
  const track = activeTrackInfo();
  if (!track) {
    return;
  }

  if (!state.currentTrackId || state.currentTrackId !== track.id) {
    await playTrack(track.id, 0);
    return;
  }

  if (state.isPlaying) {
    if (queuedSkipRequest) {
      queuedSkipRequest = null;
      clearQueuedSkipTimer();
    }
    playbackGeneration += 1;
    clearPlaybackRuntimeState();
    try {
      await fadeActiveOutput(TRANSPORT_DECLICK_MS);
      const snapshot = await window.spcBoy.nativePlaybackPause();
      await setPlaybackPowerSaveBlocker(false);
      applyNativePlaybackSnapshot(track, snapshot, playbackGeneration);
      updatePlaybackReadout();
      return;
    } catch (error) {
      throw error;
    }
  }

  await playTrack(track.id, state.elapsedSeconds);
}

async function restartAt(seconds) {
  const track = activeTrackInfo();
  if (!track) {
    return;
  }

  state.elapsedSeconds = Math.max(0, Math.min(seconds, state.totalSeconds));
  updatePlaybackReadout();

  if (state.currentTrackId === track.id) {
    await playTrack(track.id, state.elapsedSeconds);
  }
}

async function refreshPlaybackForTimingChange() {
  const track = activeTrackInfo();
  if (!track || state.currentTrackId !== track.id) {
    updateTimingSummary();
    updatePlaybackReadout();
    return;
  }

  const resumeAt = Math.max(0, Math.min(state.elapsedSeconds, currentTotalSeconds(track)));
  if (!state.isPlaying) {
    state.elapsedSeconds = resumeAt;
    state.totalSeconds = currentTotalSeconds(track);
    updateTimingSummary();
    updatePlaybackReadout();
    return;
  }

  await playTrack(track.id, resumeAt);
}

async function refreshPlaybackForSpeedChange(backendId) {
  const track = activeTrackInfo();
  const activeBackend = playbackBackends.forPath(track?.archiveEntry || track?.path)?.id;
  if (activeBackend !== backendId) return;
  await refreshPlaybackForTimingChange();
}

function preloadTrackAudio() {
  return Promise.resolve();
}

function preloadPlaylistAudio() {
  return Promise.resolve();
}

playbackApp.playback = {
  updateTimingSummary,
  updatePlaybackReadout,
  updateNativeDiagnostics,
  handleNativePlaybackState,
  stopPlaybackState,
  playTrack,
  finalizePlaybackEnded,
  playAdjacent,
  togglePlayback,
  restartAt,
  refreshPlaybackForTimingChange,
  refreshPlaybackForSpeedChange,
  setAudioSettings,
  preloadTrackAudio,
  preloadPlaylistAudio
};
})();
