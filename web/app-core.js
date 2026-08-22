const DEFAULT_PLAY_FADE_SECONDS = 6;
const SAMPLE_RATE = 44_100;
const STORAGE_KEY = "spcboy-electron-settings";
const DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const ARCHIVE_CACHE_LIMIT_CHOICES = Object.freeze([512, 1024, 2048, 4096].map((megabytes) => megabytes * 1024 * 1024));
const COLUMN_DEFS = [
  { id: "index", label: "#", className: "mono col-index", sortable: false },
  { id: "filename", label: "File" },
  { id: "title", label: "Title" },
  { id: "game", label: "Game" },
  { id: "artist", label: "Artist" },
  { id: "system", label: "System" },
  { id: "path", label: "Path" },
  { id: "lengthLabel", label: "Length", className: "mono col-length" }
];
const DEFAULT_COLUMN_ORDER = COLUMN_DEFS.map((column) => column.id);
const DEFAULT_COLUMN_WIDTHS = Object.freeze({
  index: 6,
  filename: 24,
  title: 18,
  game: 18,
  artist: 16,
  system: 10,
  path: 28,
  lengthLabel: 8
});
const DEFAULT_COLUMN_VISIBILITY = Object.freeze(Object.fromEntries(COLUMN_DEFS.map((column) => [column.id, true])));
const EQUALIZER_BAND_FREQUENCIES = Object.freeze([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
const playbackSpeed = window.SPCBoyPlaybackSpeed;

const state = {
  rootPath: null,
  tree: [],
  sidebarQuery: "",
  sidebarMode: "consoles",
  databaseGames: [],
  databaseFiles: [],
  databaseFileTree: [],
  databaseSearchGames: null,
  databaseSearchGeneration: 0,
  databaseSidebarError: "",
  collapsedConsoleNames: [],
  selectedDatabaseGameKey: null,
  selectedDatabaseConsoleName: null,
  selectedFolderPath: null,
  selectedBrowserPath: null,
  playlist: [],
  selectedTrackId: null,
  lastSelectedTrackId: null,
  currentTrackId: null,
  currentTrackInfo: null,
  isPlaying: false,
  elapsedSeconds: 0,
  totalSeconds: DEFAULT_PLAY_FADE_SECONDS,
  manualPlayTimeSeconds: 150,
  spcFadeSeconds: DEFAULT_PLAY_FADE_SECONDS,
  uiItemSpacingRem: 0.2,
  uiFontSizePt: 10,
  sidebarFontSizePt: 10,
  sidebarTextColor: "#a9a9a9",
  sidebarMonospace: false,
  sidebarPathCounts: true,
  playlistFontSizePt: 10,
  playlistTextColor: "#a9a9a9",
  playlistMonospace: false,
  applicationMonospace: false,
  playlistHeaderBold: false,
  sidebarWidthPercent: 20,
  accentColor: "lightskyblue",
  routingPreferences: {},
  archiveCacheEnabled: true,
  archiveCacheLimitBytes: DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES,
  playbackSpeed: { ...playbackSpeed.DEFAULT },
  playbackSpeedEnabled: false,
  libvgmPlaybackSpeed: { ...playbackSpeed.DEFAULT },
  libvgmPlaybackSpeedEnabled: false,
  longPlayEnabled: false,
  repeatMode: "off",
  queuedSkipsEnabled: false,
  fadeEnabled: true,
  equalizerEnabled: false,
  equalizerBandGains: EQUALIZER_BAND_FREQUENCIES.map(() => 0),
  appVolume: 1,
  columnOrder: [...DEFAULT_COLUMN_ORDER],
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY },
  columnAutoSize: true,
  sortColumn: "filename",
  sortDirection: "ascending",
  optionsOpen: false,
  optionsSection: "database",
  libraryRoots: [],
  archiveCacheSummary: null,
  databaseLocation: null,
  databaseLocationStatus: "",
  metadataToken: 0,
  nativePlayback: {
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
    positionMs: 0,
    errorMessage: ""
  }
};

const audioEngine = {
  context: null,
  gain: null
};

const refs = {
  sidebarSearchInput: document.getElementById("sidebar-search-input"),
  sidebarViewMenuButton: document.getElementById("sidebar-view-menu-button"),
  databaseCollapseAllButton: document.getElementById("database-collapse-all-button"),
  databaseExpandAllButton: document.getElementById("database-expand-all-button"),
  treeRoot: document.getElementById("tree-root"),
  sidebarResizeHandle: document.getElementById("sidebar-resize-handle"),
  workspace: document.querySelector(".workspace"),
  sidebarContextMenu: document.getElementById("sidebar-context-menu"),
  playlistScrollWrap: document.querySelector(".playlist-scroll-wrap"),
  playlistBodyWrap: document.querySelector(".playlist-body-wrap"),
  playlistSelectionIndicator: document.getElementById("playlist-selection-indicator"),
  playlistHeaderRow: document.querySelector(".playlist-header-table thead tr"),
  playlistBodyTable: document.querySelector(".playlist-body-table"),
  playlistBody: document.getElementById("playlist-body"),
  optionsOverlay: document.getElementById("options-overlay"),
  optionsCloseButton: document.getElementById("options-close-button"),
  optionsDatabaseTab: document.getElementById("options-database-tab"),
  optionsRoutingTab: document.getElementById("options-routing-tab"),
  optionsPlaybackTab: document.getElementById("options-playback-tab"),
  optionsThemeTab: document.getElementById("options-theme-tab"),
  optionsThemeSection: document.getElementById("options-theme-section"),
  optionsDatabaseSection: document.getElementById("options-database-section"),
  optionsRoutingSection: document.getElementById("options-routing-section"),
  optionsPlaybackSection: document.getElementById("options-playback-section"),
  routingConflictsList: document.getElementById("routing-conflicts-list"),
  libraryClearCacheButton: document.getElementById("library-clear-cache-button"),
  archiveCacheEnabledCheckbox: document.getElementById("archive-cache-enabled-checkbox"),
  archiveCacheLimitSelect: document.getElementById("archive-cache-limit-select"),
  databaseCacheSummary: document.getElementById("database-cache-summary"),
  libraryDatabasePath: document.getElementById("library-database-path"),
  libraryDatabaseLocationStatus: document.getElementById("library-database-location-status"),
  libraryDatabaseBrowseButton: document.getElementById("library-database-browse-button"),
  libraryDatabaseDefaultButton: document.getElementById("library-database-default-button"),
  libraryDatabaseReloadButton: document.getElementById("library-database-reload-button"),
  sidebarFontSizeInput: document.getElementById("sidebar-font-size-input"),
  sidebarTextColorInput: document.getElementById("sidebar-text-color-input"),
  sidebarMonospaceCheckbox: document.getElementById("sidebar-monospace-checkbox"),
  sidebarPathCountsCheckbox: document.getElementById("sidebar-path-counts-checkbox"),
  playlistFontSizeInput: document.getElementById("playlist-font-size-input"),
  playlistTextColorInput: document.getElementById("playlist-text-color-input"),
  playlistMonospaceCheckbox: document.getElementById("playlist-monospace-checkbox"),
  applicationMonospaceCheckbox: document.getElementById("application-monospace-checkbox"),
  playlistHeaderBoldCheckbox: document.getElementById("playlist-header-bold-checkbox"),
  columnAutoSizeCheckbox: document.getElementById("column-auto-size-checkbox"),
  sidebarWidthInput: document.getElementById("sidebar-width-input"),
  accentColorInput: document.getElementById("accent-color-input"),
  uiItemSpacingInput: document.getElementById("ui-item-spacing-input"),
  spcForceLengthCheckbox: document.getElementById("spc-force-length-checkbox"),
  queuedSkipsCheckbox: document.getElementById("queued-skips-checkbox"),
  spcFadeCheckbox: document.getElementById("spc-fade-checkbox"),
  spcLengthInput: document.getElementById("spc-length-input"),
  spcFadeInput: document.getElementById("spc-fade-input"),
  playbackSpeedInput: document.getElementById("libgme-playback-speed-input"),
  playbackSpeedEnabledCheckbox: document.getElementById("libgme-playback-speed-enabled-checkbox"),
  libvgmPlaybackSpeedInput: document.getElementById("libvgm-playback-speed-input"),
  libvgmPlaybackSpeedEnabledCheckbox: document.getElementById("libvgm-playback-speed-enabled-checkbox"),
  equalizerEnabledCheckbox: document.getElementById("equalizer-enabled-checkbox"),
  equalizerResetButton: document.getElementById("equalizer-reset-button"),
  equalizerBandInputs: [...document.querySelectorAll("[data-equalizer-band]")],
  equalizerBandValues: [...document.querySelectorAll("[data-equalizer-value]")],
  appVolumeInput: document.getElementById("app-volume-input"),
  appVolumeValue: document.getElementById("app-volume-value"),
  previousButton: document.getElementById("previous-button"),
  playButton: document.getElementById("play-button"),
  nextButton: document.getElementById("next-button"),
  equalizerToolbarButton: document.getElementById("equalizer-toolbar-button"),
  nativeDiagnostics: document.getElementById("native-diagnostics"),
  nativeTransportLabel: document.getElementById("native-transport-label"),
  nativeTrackLabel: document.getElementById("native-track-label"),
  nativeOutputLabel: document.getElementById("native-output-label"),
  nativePositionLabel: document.getElementById("native-position-label"),
  nativeBufferLabel: document.getElementById("native-buffer-label"),
  nativeBufferFillLabel: document.getElementById("native-buffer-fill-label"),
  nativeUnderrunLabel: document.getElementById("native-underrun-label"),
  nativeFramesLabel: document.getElementById("native-frames-label"),
  nativeDecodeLabel: document.getElementById("native-decode-label"),
  elapsedLabel: document.getElementById("elapsed-label"),
  progressSliderShell: document.getElementById("progress-slider-shell"),
  progressSlider: document.getElementById("progress-slider"),
  songLengthLabel: document.getElementById("song-length-label"),
  playlistTotalLabel: document.getElementById("playlist-total-label"),
  longPlayButton: document.getElementById("long-play-button"),
  repeatButton: document.getElementById("repeat-button")
};

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    state.manualPlayTimeSeconds = normalizePlayTime(parsed.manualPlayTimeSeconds);
    state.longPlayEnabled = Boolean(parsed.longPlayEnabled);
    state.repeatMode = ["off", "all", "one"].includes(parsed.repeatMode) ? parsed.repeatMode : "off";
    state.queuedSkipsEnabled = Boolean(parsed.queuedSkipsEnabled);
    state.fadeEnabled = parsed.fadeEnabled ?? (parsed.spcFadeEnabled !== false);
    state.spcFadeSeconds = normalizeFadeTime(parsed.spcFadeSeconds);
    state.playbackSpeed = playbackSpeed.normalize(parsed.playbackSpeed);
    state.playbackSpeedEnabled = Boolean(parsed.playbackSpeedEnabled);
    state.libvgmPlaybackSpeed = playbackSpeed.normalize(parsed.libvgmPlaybackSpeed);
    state.libvgmPlaybackSpeedEnabled = Boolean(parsed.libvgmPlaybackSpeedEnabled);
    state.equalizerEnabled = Boolean(parsed.equalizerEnabled);
    state.equalizerBandGains = EQUALIZER_BAND_FREQUENCIES.map((_, index) => normalizeEqualizerGain(parsed.equalizerBandGains?.[index]));
    state.appVolume = normalizeAppVolume(parsed.appVolume);
    state.uiItemSpacingRem = normalizeItemSpacing(parsed.uiItemSpacingRem);
    state.rootPath = parsed.rootPath || null;
    state.selectedFolderPath = parsed.selectedFolderPath || null;
    state.selectedBrowserPath = parsed.selectedBrowserPath || state.selectedFolderPath;
    state.sidebarMode = ["paths", "consoles", "diskPath"].includes(parsed.sidebarMode)
      ? parsed.sidebarMode
      : "consoles";
    state.selectedDatabaseGameKey = parsed.selectedDatabaseGameKey || null;
    state.collapsedConsoleNames = Array.isArray(parsed.collapsedConsoleNames)
      ? parsed.collapsedConsoleNames.filter((name) => typeof name === "string")
      : [];
    state.lastSelectedTrackId = parsed.lastSelectedTrackId || null;
    state.uiFontSizePt = normalizeFontSize(parsed.uiFontSizePt);
    state.sidebarFontSizePt = normalizeFontSize(parsed.sidebarFontSizePt ?? parsed.uiFontSizePt);
    state.sidebarTextColor = normalizeFontColor(parsed.sidebarTextColor);
    state.sidebarMonospace = Boolean(parsed.sidebarMonospace);
    state.sidebarPathCounts = parsed.sidebarPathCounts !== false;
    state.playlistFontSizePt = normalizeFontSize(parsed.playlistFontSizePt ?? parsed.uiFontSizePt);
    state.playlistTextColor = normalizeFontColor(parsed.playlistTextColor);
    state.playlistMonospace = Boolean(parsed.playlistMonospace);
    state.applicationMonospace = Boolean(parsed.applicationMonospace);
    state.playlistHeaderBold = Boolean(parsed.playlistHeaderBold);
    state.sidebarWidthPercent = normalizeSidebarWidth(parsed.sidebarWidthPercent);
    state.accentColor = normalizeAccentColor(parsed.accentColor);
    state.routingPreferences = parsed.routingPreferences && typeof parsed.routingPreferences === "object" ? { ...parsed.routingPreferences } : {};
    state.archiveCacheEnabled = parsed.archiveCacheEnabled !== false;
    state.archiveCacheLimitBytes = normalizeArchiveCacheLimit(parsed.archiveCacheLimitBytes);
    state.columnOrder = normalizeColumnOrder(parsed.columnOrder);
    state.columnWidths = normalizeColumnWidths(parsed.columnWidths);
    state.columnVisibility = normalizeColumnVisibility(parsed.columnVisibility);
    state.columnAutoSize = parsed.columnAutoSize !== false;
    state.sortColumn = normalizeSortColumn(parsed.sortColumn);
    state.sortDirection = normalizeSortDirection(parsed.sortDirection);
  } catch {
    return;
  }
}

function persistSettings() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    manualPlayTimeSeconds: state.manualPlayTimeSeconds,
    longPlayEnabled: state.longPlayEnabled,
    repeatMode: state.repeatMode,
    queuedSkipsEnabled: state.queuedSkipsEnabled,
    fadeEnabled: state.fadeEnabled,
    equalizerEnabled: state.equalizerEnabled,
    equalizerBandGains: state.equalizerBandGains,
    appVolume: state.appVolume,
    spcFadeSeconds: state.spcFadeSeconds,
    playbackSpeed: state.playbackSpeed,
    playbackSpeedEnabled: state.playbackSpeedEnabled,
    libvgmPlaybackSpeed: state.libvgmPlaybackSpeed,
    libvgmPlaybackSpeedEnabled: state.libvgmPlaybackSpeedEnabled,
    uiItemSpacingRem: state.uiItemSpacingRem,
    rootPath: state.rootPath,
    selectedFolderPath: state.selectedFolderPath,
    selectedBrowserPath: state.selectedBrowserPath,
    sidebarMode: state.sidebarMode,
    selectedDatabaseGameKey: state.selectedDatabaseGameKey,
    collapsedConsoleNames: state.collapsedConsoleNames,
    lastSelectedTrackId: state.lastSelectedTrackId,
    uiFontSizePt: state.uiFontSizePt,
    sidebarFontSizePt: state.sidebarFontSizePt,
    sidebarTextColor: state.sidebarTextColor,
    sidebarMonospace: state.sidebarMonospace,
    sidebarPathCounts: state.sidebarPathCounts,
    playlistFontSizePt: state.playlistFontSizePt,
    playlistTextColor: state.playlistTextColor,
    playlistMonospace: state.playlistMonospace,
    applicationMonospace: state.applicationMonospace,
    playlistHeaderBold: state.playlistHeaderBold,
    sidebarWidthPercent: state.sidebarWidthPercent,
    accentColor: state.accentColor,
    routingPreferences: state.routingPreferences,
    archiveCacheEnabled: state.archiveCacheEnabled,
    archiveCacheLimitBytes: state.archiveCacheLimitBytes,
    columnOrder: state.columnOrder,
    columnWidths: state.columnWidths,
    columnVisibility: state.columnVisibility,
    columnAutoSize: state.columnAutoSize,
    sortColumn: state.sortColumn,
    sortDirection: state.sortDirection
  }));
}

function formatTime(totalSeconds) {
  const whole = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizePlayTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(30, Math.min(900, Math.round(numeric)))
    : 150;
}

function normalizeFadeTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(30, Math.round(numeric)))
    : DEFAULT_PLAY_FADE_SECONDS;
}

function normalizeEqualizerGain(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(-12, Math.min(12, Math.round(numeric * 2) / 2)) : 0;
}

function normalizeAppVolume(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
}

function normalizeArchiveCacheLimit(value) {
  const numeric = Number(value);
  return ARCHIVE_CACHE_LIMIT_CHOICES.includes(numeric) ? numeric : DEFAULT_ARCHIVE_CACHE_LIMIT_BYTES;
}

function parseDurationSeconds(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  if (text.includes(":")) {
    const parts = text.split(":").map((part) => part.trim());
    if (parts.length !== 2) {
      return null;
    }

    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return null;
    }

    return Math.max(0, Math.round(minutes * 60 + seconds));
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.round(numeric));
}

function normalizeItemSpacing(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(2, Math.round(numeric * 100) / 100))
    : 0.2;
}

function normalizeFontSize(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(8, Math.min(18, Math.round(numeric)))
    : 10;
}

function normalizeFontColor(value) {
  const text = String(value || "").trim();
  if (!text) return "#a9a9a9";
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", text)) {
    return text;
  }
  return /^#[0-9a-f]{3,4}$/i.test(text) || /^#[0-9a-f]{6,8}$/i.test(text)
    ? text.toLowerCase()
    : "#a9a9a9";
}

function normalizeAccentColor(value) {
  const text = String(value || "").trim();
  if (!text) return "lightskyblue";
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", text)) return text;
  return /^#[0-9a-f]{3,4}$/i.test(text) || /^#[0-9a-f]{6,8}$/i.test(text)
    ? text.toLowerCase()
    : "lightskyblue";
}

function normalizeSidebarWidth(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(12, Math.min(50, Math.round(numeric)))
    : 20;
}

function parseNumericInput(value) {
  const numeric = Number(String(value || "").trim().replace(/[^0-9.\\-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeColumnOrder(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_COLUMN_ORDER];
  }

  const validIds = new Set(DEFAULT_COLUMN_ORDER);
  const deduped = value.filter((columnId, index) => (
    validIds.has(columnId) &&
    value.indexOf(columnId) === index
  ));
  const missing = DEFAULT_COLUMN_ORDER.filter((columnId) => !deduped.includes(columnId));
  return [...deduped, ...missing];
}

function normalizeColumnWidths(value) {
  const widths = { ...DEFAULT_COLUMN_WIDTHS };
  if (!value || typeof value !== "object") return widths;
  for (const column of COLUMN_DEFS) {
    const numeric = Number(value[column.id]);
    if (Number.isFinite(numeric)) widths[column.id] = Math.max(4, Math.min(80, numeric));
  }
  return widths;
}

function normalizeColumnVisibility(value) {
  const visibility = { ...DEFAULT_COLUMN_VISIBILITY };
  if (!value || typeof value !== "object") return visibility;
  for (const column of COLUMN_DEFS) {
    if (typeof value[column.id] === "boolean") visibility[column.id] = value[column.id];
  }
  if (!Object.values(visibility).some(Boolean)) visibility.filename = true;
  return visibility;
}

function normalizeSortColumn(value) {
  return DEFAULT_COLUMN_ORDER.includes(value) && value !== "index" ? value : "filename";
}

function normalizeSortDirection(value) {
  return value === "descending" ? "descending" : "ascending";
}

function currentTrack() {
  return state.playlist.find((track) => track.id === state.currentTrackId) ?? null;
}

function selectedTrack() {
  return state.playlist.find((track) => track.id === state.selectedTrackId) ?? null;
}

function activeTrackInfo() {
  return currentTrack() ?? state.currentTrackInfo ?? selectedTrack();
}

function playbackBaseSeconds() {
  return state.manualPlayTimeSeconds;
}

function currentFadeSeconds(track = null) {
  if (!state.fadeEnabled) {
    return 0;
  }

  return state.spcFadeSeconds;
}

function targetPlaybackSeconds() {
  return playbackBaseSeconds() + currentFadeSeconds();
}

window.SPCBoyApp = {
  DEFAULT_PLAY_FADE_SECONDS,
  SAMPLE_RATE,
  STORAGE_KEY,
  COLUMN_DEFS,
  DEFAULT_COLUMN_ORDER,
  state,
  audioEngine,
  refs,
  loadSettings,
  persistSettings,
  formatTime,
  normalizePlayTime,
  normalizeFadeTime,
  normalizePlaybackSpeed: playbackSpeed.normalize,
  parsePlaybackSpeed: playbackSpeed.parse,
  formatPlaybackSpeed: playbackSpeed.format,
  scalePlaybackMilliseconds: playbackSpeed.scaleMilliseconds,
  parseDurationSeconds,
  parseNumericInput,
  normalizeItemSpacing,
  normalizeFontSize,
  normalizeFontColor,
  normalizeAccentColor,
  EQUALIZER_BAND_FREQUENCIES,
  normalizeEqualizerGain,
  normalizeAppVolume,
  normalizeArchiveCacheLimit,
  normalizeSidebarWidth,
  normalizeColumnOrder,
  normalizeColumnWidths,
  normalizeColumnVisibility,
  normalizeSortColumn,
  normalizeSortDirection,
  currentTrack,
  selectedTrack,
  activeTrackInfo,
  playbackBaseSeconds,
  currentFadeSeconds,
  targetPlaybackSeconds
};
