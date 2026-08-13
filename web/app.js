(() => {
const app = window.SPCBoyApp;
const sidebarViewState = window.SPCBoySidebarViewState;
const { state, refs } = app;

let resizingSidebar = false;
let resizePointerId = null;
refs.sidebarResizeHandle?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  resizingSidebar = true;
  resizePointerId = event.pointerId;
  refs.sidebarResizeHandle.setPointerCapture?.(event.pointerId);
  document.body.classList.add("is-sidebar-resizing");
});

function updateSidebarResize(event) {
  if (!resizingSidebar) return;
  const bounds = refs.workspace?.getBoundingClientRect?.();
  if (!bounds?.width) return;
  const nextPercent = ((event.clientX - bounds.left) / bounds.width) * 100;
  state.sidebarWidthPercent = app.normalizeSidebarWidth(nextPercent);
  document.documentElement.style.setProperty("--sidebar-width-percent", String(state.sidebarWidthPercent));
  refs.sidebarWidthInput && (refs.sidebarWidthInput.value = String(state.sidebarWidthPercent));
}

refs.sidebarResizeHandle?.addEventListener("pointermove", updateSidebarResize);

function finishSidebarResize(event) {
  if (!resizingSidebar) return;
  resizingSidebar = false;
  refs.sidebarResizeHandle?.releasePointerCapture?.(resizePointerId);
  resizePointerId = null;
  document.body.classList.remove("is-sidebar-resizing");
  app.persistSettings();
}

refs.sidebarResizeHandle?.addEventListener("pointerup", finishSidebarResize);
refs.sidebarResizeHandle?.addEventListener("pointercancel", finishSidebarResize);
refs.sidebarResizeHandle?.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "ArrowLeft"
    ? state.sidebarWidthPercent - 1
    : event.key === "ArrowRight"
      ? state.sidebarWidthPercent + 1
      : event.key === "Home" ? 12 : 50;
  state.sidebarWidthPercent = app.normalizeSidebarWidth(next);
  document.documentElement.style.setProperty("--sidebar-width-percent", String(state.sidebarWidthPercent));
  app.persistSettings();
});

refs.playButton.addEventListener("click", () => {
  app.playback.togglePlayback().catch((error) => {
    console.error(error);
  });
});

refs.longPlayButton.addEventListener("click", () => {
  app.ui.setSpcForceManualTime(!state.longPlayEnabled);
});

refs.repeatButton.addEventListener("click", () => {
  app.ui.cycleRepeatMode();
});

refs.previousButton.addEventListener("click", () => {
  app.playback.playAdjacent(-1);
});

refs.databaseCollapseAllButton.addEventListener("click", () => {
  app.ui.setAllSidebarNodesCollapsed(true).catch((error) => console.error(error));
});

refs.databaseExpandAllButton.addEventListener("click", () => {
  app.ui.setAllSidebarNodesCollapsed(false).catch((error) => console.error(error));
});

refs.nextButton.addEventListener("click", () => {
  app.playback.playAdjacent(1);
});

refs.equalizerToolbarButton.addEventListener("click", () => {
  app.ui.setEqualizerEnabled(!state.equalizerEnabled);
});

refs.progressSlider.addEventListener("input", (event) => {
  const nextValue = Number(event.target.value);
  state.elapsedSeconds = nextValue;
  app.playback.updatePlaybackReadout();
});

refs.progressSlider.addEventListener("change", (event) => {
  const nextValue = Number(event.target.value);
  app.playback.restartAt(nextValue).catch((error) => {
    console.error(error);
  });
});

refs.spcForceLengthCheckbox.addEventListener("change", (event) => {
  app.ui.setSpcForceManualTime(event.target.checked);
});

refs.spcLengthInput.addEventListener("change", (event) => {
  app.ui.commitSpcLengthInput(event.target.value);
});

refs.spcLengthInput.addEventListener("input", (event) => {
  app.ui.commitSpcLengthInput(event.target.value);
});

refs.spcLengthInput.addEventListener("blur", (event) => {
  app.ui.commitSpcLengthInput(event.target.value);
});

refs.spcFadeInput.addEventListener("change", (event) => {
  app.ui.commitSpcFadeInput(event.target.value);
});

refs.spcFadeCheckbox.addEventListener("change", (event) => {
  app.ui.setSpcFadeEnabled(event.target.checked);
});

refs.queuedSkipsCheckbox.addEventListener("change", (event) => {
  app.ui.setQueuedSkipsEnabled(event.target.checked);
});

refs.spcFadeInput.addEventListener("input", (event) => {
  app.ui.commitSpcFadeInput(event.target.value);
});

refs.spcFadeInput.addEventListener("blur", (event) => {
  app.ui.commitSpcFadeInput(event.target.value);
});

refs.playbackSpeedInput.addEventListener("change", (event) => {
  app.ui.commitPlaybackSpeedInput("libgme", event.target.value);
});

refs.playbackSpeedInput.addEventListener("blur", (event) => {
  app.ui.commitPlaybackSpeedInput("libgme", event.target.value);
});

refs.playbackSpeedEnabledCheckbox.addEventListener("change", (event) => {
  app.ui.setPlaybackSpeedEnabled("libgme", event.target.checked);
});

refs.libvgmPlaybackSpeedInput.addEventListener("change", (event) => app.ui.commitPlaybackSpeedInput("libvgm", event.target.value));
refs.libvgmPlaybackSpeedInput.addEventListener("blur", (event) => app.ui.commitPlaybackSpeedInput("libvgm", event.target.value));
refs.libvgmPlaybackSpeedEnabledCheckbox.addEventListener("change", (event) => app.ui.setPlaybackSpeedEnabled("libvgm", event.target.checked));

refs.equalizerEnabledCheckbox.addEventListener("change", (event) => {
  app.ui.setEqualizerEnabled(event.target.checked);
});
refs.equalizerBandInputs.forEach((input, index) => {
  input.addEventListener("input", (event) => app.ui.setEqualizerBandGain(index, event.target.value));
});
refs.equalizerResetButton.addEventListener("click", () => app.ui.resetEqualizer());
refs.appVolumeInput.addEventListener("input", (event) => app.ui.setAppVolume(event.target.value));

refs.uiItemSpacingInput.addEventListener("change", (event) => {
  app.ui.setUiItemSpacing(event.target.value);
});

refs.uiItemSpacingInput.addEventListener("input", (event) => {
  app.ui.setUiItemSpacing(event.target.value);
});

refs.uiItemSpacingInput.addEventListener("blur", (event) => {
  app.ui.setUiItemSpacing(event.target.value);
});

refs.sidebarFontSizeInput.addEventListener("change", (event) => {
  app.ui.commitSidebarFontSizeInput(event.target.value);
});

refs.sidebarFontSizeInput.addEventListener("input", (event) => {
  app.ui.commitSidebarFontSizeInput(event.target.value);
});

refs.sidebarFontSizeInput.addEventListener("blur", (event) => {
  app.ui.commitSidebarFontSizeInput(event.target.value);
});

refs.sidebarTextColorInput.addEventListener("change", (event) => {
  app.ui.setSidebarTextColor(event.target.value);
});
refs.sidebarTextColorInput.addEventListener("blur", (event) => {
  app.ui.setSidebarTextColor(event.target.value);
});

refs.sidebarMonospaceCheckbox.addEventListener("change", (event) => {
  app.ui.setSidebarMonospace(event.target.checked);
});

refs.sidebarPathCountsCheckbox.addEventListener("change", (event) => {
  app.ui.setSidebarPathCounts(event.target.checked);
});

refs.playlistFontSizeInput.addEventListener("change", (event) => {
  app.ui.commitPlaylistFontSizeInput(event.target.value);
});

refs.playlistFontSizeInput.addEventListener("input", (event) => {
  app.ui.commitPlaylistFontSizeInput(event.target.value);
});

refs.playlistFontSizeInput.addEventListener("blur", (event) => {
  app.ui.commitPlaylistFontSizeInput(event.target.value);
});

refs.playlistTextColorInput.addEventListener("change", (event) => {
  app.ui.setPlaylistTextColor(event.target.value);
});
refs.playlistTextColorInput.addEventListener("blur", (event) => {
  app.ui.setPlaylistTextColor(event.target.value);
});

refs.playlistMonospaceCheckbox.addEventListener("change", (event) => {
  app.ui.setPlaylistMonospace(event.target.checked);
});
refs.applicationMonospaceCheckbox.addEventListener("change", (event) => {
  app.ui.setApplicationMonospace(event.target.checked);
});
refs.playlistHeaderBoldCheckbox.addEventListener("change", (event) => {
  app.ui.setPlaylistHeaderBold(event.target.checked);
});

refs.columnAutoSizeCheckbox.addEventListener("change", (event) => {
  app.ui.setColumnAutoSize(event.target.checked);
});

refs.sidebarWidthInput.addEventListener("change", (event) => {
  app.ui.commitSidebarWidthInput(event.target.value);
});

refs.sidebarWidthInput.addEventListener("input", (event) => {
  app.ui.commitSidebarWidthInput(event.target.value);
});

refs.sidebarWidthInput.addEventListener("blur", (event) => {
  app.ui.commitSidebarWidthInput(event.target.value);
});

refs.accentColorInput.addEventListener("change", (event) => {
  app.ui.setAccentColor(event.target.value);
});
refs.accentColorInput.addEventListener("blur", (event) => {
  app.ui.setAccentColor(event.target.value);
});

refs.consoleViewCheckbox.addEventListener("change", (event) => {
  app.ui.setConsoleViewEnabled(event.target.checked);
});

refs.preferEmbeddedConsoleTagsCheckbox.addEventListener("change", (event) => {
  app.ui.setPreferEmbeddedConsoleTags(event.target.checked).catch((error) => console.error("[SPCBoy] console-tag preference failed", error));
});

if (window.spcBoy?.onConsoleViewChanged) {
  window.spcBoy.onConsoleViewChanged((enabled) => {
    app.ui.setConsoleViewEnabled(enabled, false);
  });
}

if (window.spcBoy?.onPlaybackSettingsChanged) {
  window.spcBoy.onPlaybackSettingsChanged((settings) => {
    if (typeof settings.longPlayEnabled === "boolean") {
      state.longPlayEnabled = settings.longPlayEnabled;
      app.playback.refreshPlaybackForTimingChange().catch((error) => console.error(error));
    }
    if (typeof settings.queuedSkipsEnabled === "boolean") {
      state.queuedSkipsEnabled = settings.queuedSkipsEnabled;
      app.ui.renderAll();
    }
    if (typeof settings.archiveCacheEnabled === "boolean") {
      state.archiveCacheEnabled = settings.archiveCacheEnabled;
      app.persistSettings();
      app.ui.renderAll();
    }
    if (settings.archiveCacheLimitBytes !== undefined) {
      state.archiveCacheLimitBytes = app.normalizeArchiveCacheLimit(settings.archiveCacheLimitBytes);
      app.persistSettings();
      app.ui.renderAll();
    }
    if (settings.playbackSpeed !== undefined) {
      state.playbackSpeed = app.normalizePlaybackSpeed(settings.playbackSpeed);
      if (state.playbackSpeedEnabled) app.playback.refreshPlaybackForSpeedChange("libgme").catch((error) => console.error(error));
      app.ui.renderAll();
    }
    if (typeof settings.playbackSpeedEnabled === "boolean") {
      state.playbackSpeedEnabled = settings.playbackSpeedEnabled;
      app.playback.refreshPlaybackForSpeedChange("libgme").catch((error) => console.error(error));
      app.ui.renderAll();
    }
    if (settings.libvgmPlaybackSpeed !== undefined) {
      state.libvgmPlaybackSpeed = app.normalizePlaybackSpeed(settings.libvgmPlaybackSpeed);
      if (state.libvgmPlaybackSpeedEnabled) app.playback.refreshPlaybackForSpeedChange("libvgm").catch((error) => console.error(error));
      app.ui.renderAll();
    }
    if (typeof settings.libvgmPlaybackSpeedEnabled === "boolean") {
      state.libvgmPlaybackSpeedEnabled = settings.libvgmPlaybackSpeedEnabled;
      app.playback.refreshPlaybackForSpeedChange("libvgm").catch((error) => console.error(error));
      app.ui.renderAll();
    }
    if (typeof settings.equalizerEnabled === "boolean") state.equalizerEnabled = settings.equalizerEnabled;
    if (Array.isArray(settings.equalizerBandGains)) state.equalizerBandGains = settings.equalizerBandGains.map(app.normalizeEqualizerGain);
    if (settings.appVolume !== undefined) state.appVolume = app.normalizeAppVolume(settings.appVolume);
    if (settings.equalizerEnabled !== undefined || settings.equalizerBandGains || settings.appVolume !== undefined) {
      app.playback.setAudioSettings(settings);
      app.ui.renderAll();
    }
  });
}

if (window.spcBoy?.onAppearanceSettingsChanged) {
  window.spcBoy.onAppearanceSettingsChanged((settings) => {
    app.ui.applyAppearanceSettings(settings);
  });
}

if (window.spcBoy?.onRoutingPreferencesChanged) {
  window.spcBoy.onRoutingPreferencesChanged((preferences) => {
    app.ui.applyRoutingPreferences(preferences);
  });
}

refs.optionsCloseButton.addEventListener("click", () => {
  app.ui.setOptionsOpen(false);
});

refs.optionsThemeTab.addEventListener("click", () => {
  state.optionsSection = "theme";
  app.ui.renderAll();
});

refs.optionsLibraryTab.addEventListener("click", () => {
  state.optionsSection = "library";
  app.ui.refreshLibraryRoots().catch((error) => console.error(error));
  app.ui.renderAll();
});

refs.optionsDatabaseTab.addEventListener("click", () => {
  state.optionsSection = "database";
  app.ui.refreshDatabaseMaintenanceSummary().catch((error) => console.error(error));
  app.ui.refreshDatabaseLocation().catch((error) => console.error(error));
  app.ui.renderAll();
});

refs.libraryDatabaseBrowseButton.addEventListener("click", () => {
  app.ui.chooseDatabaseLocation().catch((error) => {
    state.databaseLocationStatus = `Database not selected • ${error.message}`;
    app.ui.renderAll();
  });
});

refs.libraryDatabaseDefaultButton.addEventListener("click", () => {
  app.ui.useDefaultDatabaseLocation().catch((error) => {
    state.databaseLocationStatus = `Could not select default database • ${error.message}`;
    app.ui.renderAll();
  });
});

refs.optionsRoutingTab.addEventListener("click", () => {
  state.optionsSection = "routing";
  app.ui.renderAll();
});

refs.optionsPlaybackTab.addEventListener("click", () => {
  state.optionsSection = "playback";
  app.ui.renderAll();
});

refs.libraryAddRootButton.addEventListener("click", () => {
  app.ui.addLibraryRoot().catch((error) => console.error(error));
});

refs.libraryToggleRootsButton.addEventListener("click", () => {
  app.ui.selectAllLibraryRoots().catch((error) => console.error(error));
});

refs.libraryScanAllButton.addEventListener("click", () => {
  app.ui.scanSelectedLibraries(state.libraryDeepScanEnabled).catch((error) => console.error(error));
});

refs.libraryDeepScanCheckbox.addEventListener("change", (event) => {
  state.libraryDeepScanEnabled = event.target.checked;
  app.persistSettings();
  app.ui.renderAll();
});

refs.libraryTrimMissingButton.addEventListener("click", () => {
  app.ui.trimMissingLibrary().catch((error) => console.error(error));
});

refs.libraryPurgeUnlinkedButton.addEventListener("click", () => {
  app.ui.purgeUnlinkedLibrary().catch((error) => console.error(error));
});

refs.libraryClearDatabaseButton.addEventListener("click", () => {
  app.ui.clearLibraryDatabase().catch((error) => console.error(error));
});

refs.libraryClearCacheButton.addEventListener("click", () => {
  app.ui.clearLibraryArchiveCache().catch((error) => console.error(error));
});

refs.archiveCacheEnabledCheckbox.addEventListener("change", (event) => {
  app.ui.setArchiveCacheEnabled(event.target.checked);
});

refs.archiveCacheLimitSelect.addEventListener("change", (event) => {
  app.ui.setArchiveCacheLimit(event.target.value);
});

refs.libraryCancelButton.addEventListener("click", () => {
  app.ui.cancelLibraryOperation().catch((error) => console.error(error));
});

if (window.spcBoy?.onLibraryScanProgress) {
  window.spcBoy.onLibraryScanProgress((progress) => {
    app.ui.applyLibraryProgress(progress);
  });
}

window.spcBoy?.onLibraryOperationState?.((operationState) => {
  app.ui.applyLibraryOperationState(operationState);
});

window.spcBoy?.onLibraryRootsChanged?.((roots) => {
  app.ui.handleLibraryRootsChanged(roots).catch((error) => console.error("[SPCBoy] library roots update failed", error));
});

window.spcBoy?.onLibraryDatabaseChanged?.((change) => {
  app.ui.handleLibraryDatabaseChanged(change).catch((error) => console.error("[SPCBoy] library database update failed", error));
});

refs.optionsOverlay.addEventListener("click", (event) => {
  if (event.target === refs.optionsOverlay) {
    app.ui.setOptionsOpen(false);
  }
});

let dragDepth = 0;

function droppedPath(event) {
  const file = [...(event.dataTransfer?.files || [])][0];
  return file?.path || null;
}

function hasDroppedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

document.addEventListener("dragenter", (event) => {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add("is-file-drag-over");
});

document.addEventListener("dragleave", (event) => {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("is-file-drag-over");
});

document.addEventListener("dragover", (event) => {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

document.addEventListener("drop", (event) => {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("is-file-drag-over");
  const inputPath = droppedPath(event);
  if (!inputPath) return;
  window.spcBoy.openPath(inputPath)
    .then((snapshot) => app.ui.applyLibrarySnapshot(snapshot))
    .catch((error) => console.error("[SPCBoy] dropped path failed", error));
});

refs.sidebarSearchInput.addEventListener("input", (event) => {
  app.ui.updateSidebarSearch(event.target.value);
});

refs.sidebarViewToggleButton.addEventListener("click", () => {
  state.sidebarMode = state.sidebarMode === "database" ? "folders" : "database";
  if (state.sidebarMode === "folders") state.selectedDatabaseGameKey = null;
  else state.consoleViewEnabled = true;
  app.persistSettings();
  if (state.sidebarMode === "folders" || state.databaseGames.length || state.sidebarQuery.trim()) {
    app.ui.updateSidebarSearch(state.sidebarQuery);
    return;
  }
  app.ui.loadDatabaseGames()
    .then(() => app.ui.updateSidebarSearch(state.sidebarQuery))
    .catch((error) => console.error(error));
});

if (window.spcBoy?.onTransportShortcut) {
  window.spcBoy.onTransportShortcut((action) => {
    if (action === "settings") {
      window.spcBoy.openOptionsWindow().catch((error) => console.error(error));
      return;
    }

    if (action === "toggle") {
      app.playback.togglePlayback().catch((error) => {
        console.error(error);
      });
      return;
    }

    if (action === "previous") {
      app.playback.playAdjacent(-1);
      return;
    }

    if (action === "next") {
      app.playback.playAdjacent(1);
    }
  });
}

if (window.spcBoy?.onLibrarySnapshot) {
  window.spcBoy.onLibrarySnapshot((snapshot) => {
    if (!snapshot) {
      return;
    }

    app.ui.applyLibrarySnapshot(snapshot);
  });
}

if (window.spcBoy?.onLibraryCommand) {
  window.spcBoy.onLibraryCommand((command) => {
    if (command?.type !== "open-root") {
      return;
    }

    app.ui.openLibraryRoot().catch((error) => {
      console.error(error);
    });
  });
}

if (window.spcBoy?.onNativePlaybackState) {
  window.spcBoy.onNativePlaybackState((snapshot) => {
    app.playback.handleNativePlaybackState(snapshot);
  });
}

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const isRangeInput = target instanceof HTMLInputElement && target.type === "range";
  if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "-" || event.key === "=" || event.key === "Subtract" || event.key === "Equal") && (!target || !target.isContentEditable) && (!target.tagName || target.tagName !== "TEXTAREA") && (!target.tagName || target.tagName !== "INPUT" || isRangeInput)) {
    event.preventDefault();
    app.ui.adjustAppVolume(event.key === "-" || event.key === "Subtract" ? -0.05 : 0.05);
    return;
  }
  const isTextEntry = target instanceof HTMLElement && (
    (target.tagName === "INPUT" && target.type !== "range") ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );

  if (isTextEntry) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.select();
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      const input = target;
      input.blur();
      event.preventDefault();
      return;
    }

    if (event.key === "Escape" && state.optionsOpen) {
      event.preventDefault();
      app.ui.setOptionsOpen(false);
    }
    return;
  }

  if (event.key === "F7") {
    event.preventDefault();
    app.playback.playAdjacent(-1);
    return;
  }

  if (event.key === "F8") {
    event.preventDefault();
    app.playback.togglePlayback().catch((error) => {
      console.error(error);
    });
    return;
  }

  if (event.key === "F9") {
    event.preventDefault();
    app.playback.playAdjacent(1);
    return;
  }

  if (event.metaKey && !event.ctrlKey && !event.altKey && !state.optionsOpen && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    if (app.ui.jumpFocusedListToEdge(event.key === "ArrowDown", event.target)) {
      event.preventDefault();
      return;
    }
  }

  if (event.key === "ArrowDown" && !state.optionsOpen) {
    event.preventDefault();
    app.ui.moveSelection(1);
    return;
  }

  if (event.key === "ArrowUp" && !state.optionsOpen) {
    event.preventDefault();
    app.ui.moveSelection(-1);
    return;
  }

  if (event.key === "Enter" && !state.optionsOpen) {
    event.preventDefault();
    app.ui.activateFocusedItem(event.target).then((handled) => {
      if (handled) return;
      if (sidebarViewState.resolve(state.sidebarMode, state.sidebarQuery).contentMode === "database") {
        app.ui.activateDatabaseSelection();
        return;
      }
      app.ui.playSelectedTrack();
    }).catch((error) => console.error("[SPCBoy] Enter activation failed", error));
    return;
  }

  if (event.key === "Escape" && state.optionsOpen) {
    event.preventDefault();
    app.ui.setOptionsOpen(false);
  }
});

app.ui.bootstrap().catch((error) => {
  console.error(error);
});
})();
