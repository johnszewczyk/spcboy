(() => {
const uiApp = window.SPCBoyApp;
const { state, refs, persistSettings, loadSettings, targetPlaybackSeconds, COLUMN_DEFS } = uiApp;
const sidebarViewState = window.SPCBoySidebarViewState;
const expandedFolders = new Set();
let draggedColumnId = null;
let metadataRefreshFrame = 0;
const metadataRefreshTrackIds = new Set();
let columnMenu = null;
let autoSizedPlaylistSignature = null;
let textMeasureContext = null;
let renderedDatabaseGames = null;
let databaseGameButtons = [];
let databaseEmptyState = null;
let databaseConsoleGroups = [];
let collapsedDatabaseConsoles = new Set();
let browserClickTimer = 0;
let databaseClickTimer = 0;
let sidebarSearchTimer = 0;

function syncCollapsedConsolePersistence() {
  state.collapsedConsoleNames = [...collapsedDatabaseConsoles];
  persistSettings();
}

function currentSidebarView() {
  return sidebarViewState.resolve(state.sidebarMode, state.sidebarQuery);
}
let browserSelectionGeneration = 0;
let playlistLoadGeneration = 0;
let selectedBrowserButton = null;
let selectedDatabaseGameButton = null;
const playlistRowsByTrackId = new Map();
let selectedPlaylistRow = null;
let currentPlaylistRow = null;
let selectionIndicatorFrame = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

function ensureSidebarSelectionIndicator() {
  let indicator = refs.treeRoot.querySelector(".list-selection-indicator");
  if (indicator) return indicator;
  indicator = document.createElement("div");
  indicator.className = "list-selection-indicator";
  indicator.setAttribute("aria-hidden", "true");
  refs.treeRoot.prepend(indicator);
  return indicator;
}

function resetSidebarContent() {
  // Keep the single selection surface alive across sidebar renders. Recreating
  // it on every click resets its transform, producing both flicker and stale
  // looking bars instead of one continuous 100 ms movement.
  const indicator = ensureSidebarSelectionIndicator();
  refs.treeRoot.replaceChildren(indicator);
  return indicator;
}

function positionSelectionIndicator(container, indicator, target) {
  if (!container || !indicator || !target) {
    if (indicator) indicator.style.opacity = "0";
    return;
  }
  const containerBounds = container.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  if (!targetBounds.width || !targetBounds.height) {
    indicator.style.opacity = "0";
    return;
  }
  const left = targetBounds.left - containerBounds.left + container.scrollLeft;
  const top = targetBounds.top - containerBounds.top + container.scrollTop;
  indicator.style.width = `${targetBounds.width}px`;
  indicator.style.height = `${targetBounds.height}px`;
  indicator.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  indicator.style.opacity = "1";
}

function syncSelectionIndicators() {
  selectionIndicatorFrame = 0;
  const sidebarTarget = refs.treeRoot.querySelector(".tree-node.is-selected, .database-game-row.is-selected, .database-console-row.is-selected");
  positionSelectionIndicator(refs.treeRoot, ensureSidebarSelectionIndicator(), sidebarTarget);
  positionSelectionIndicator(refs.playlistBodyWrap, refs.playlistSelectionIndicator, selectedPlaylistRow);
}

function scheduleSelectionIndicators() {
  if (selectionIndicatorFrame) return;
  selectionIndicatorFrame = window.requestAnimationFrame(syncSelectionIndicators);
}

function findBrowserNode(nodes, targetPath) {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    const child = findBrowserNode(node.children || [], targetPath);
    if (child) return child;
  }
  return null;
}

function resolveSelectedTrackId(playlist, preferredTrackId = state.lastSelectedTrackId) {
  if (!Array.isArray(playlist) || playlist.length === 0) {
    return null;
  }

  if (preferredTrackId && playlist.some((track) => track.id === preferredTrackId)) {
    return preferredTrackId;
  }

  return playlist[0].id;
}

function showStartupFailure(message) {
  refs.treeRoot.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty sidebar-empty";
  empty.textContent = message;
  refs.treeRoot.appendChild(empty);

  refs.playlistBody.innerHTML = "";
  const row = document.createElement("tr");
  row.innerHTML = `<td colspan="7" class="empty-row">${message}</td>`;
  refs.playlistBody.appendChild(row);
}

function pathToNode(nodes, targetPath, lineage = []) {
  for (const node of nodes) {
    const nextLineage = [...lineage, node.path];
    if (node.path === targetPath) {
      return nextLineage;
    }

    const nested = pathToNode(node.children, targetPath, nextLineage);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function ensureExpandedToSelection(tree = state.tree, selectedPath = state.selectedBrowserPath) {
  if (!selectedPath) {
    return;
  }

  const lineage = pathToNode(tree, selectedPath) ?? [];
  // Expand ancestors only. The selected folder itself must remain foldable.
  lineage.slice(0, -1).forEach((folderPath) => expandedFolders.add(folderPath));
}

function isNodeExpanded(node) {
  // The active filesystem root is the Folder View anchor. It must remain
  // expanded so folding descendants can never make the browser disappear.
  if (node.path === state.rootPath || node.alwaysExpanded) return true;
  if (state.sidebarQuery.trim()) {
    return true;
  }

  if (!node.children.length) {
    return false;
  }

  return expandedFolders.has(node.path);
}

function scrollSelectedBrowserItemIntoView() {
  if (!state.selectedBrowserPath) return;
  const button = refs.treeRoot.querySelector(`[data-browser-path="${CSS.escape(state.selectedBrowserPath)}"]`);
  button?.scrollIntoView({ block: "nearest" });
}

async function loadBrowserChildren(node) {
  if (node.kind !== "folder" || node.childrenLoaded) return;
  node.children = await window.spcBoy.listFolder(node.path);
  node.childrenLoaded = true;
}

function catalogPlaylistSelection(rows, selectedPath) {
  return {
    selectedFolderPath: selectedPath,
    selectedBrowserPath: state.selectedBrowserPath,
    playlist: databaseRowsToPlaylistTracks(rows, [])
  };
}

async function loadBrowserSelection(node) {
  if (node.catalogFile) {
    return catalogPlaylistSelection(
      await window.spcBoy.databaseFileTracks([node.catalogFile]),
      node.catalogFile.path
    );
  }
  if (node.catalogFolder) {
    return catalogPlaylistSelection(
      await window.spcBoy.databaseFolderTracks([node.catalogFolder]),
      node.catalogFolder.folderPath
    );
  }
  return node.kind === "folder"
    ? window.spcBoy.selectFolder(node.path)
    : window.spcBoy.selectFile(node.path);
}

function hideSidebarContextMenu() {
  refs.sidebarContextMenu?.classList.add("is-hidden");
  if (refs.sidebarContextMenu) refs.sidebarContextMenu.innerHTML = "";
}

function showContextMenu(event, actions) {
  const menu = refs.sidebarContextMenu;
  if (!menu) return;
  event.preventDefault();
  event.stopPropagation();
  menu.innerHTML = "";
  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = label;
    button.addEventListener("click", () => {
      hideSidebarContextMenu();
      Promise.resolve(action()).catch((error) => console.error("[SPCBoy] sidebar context action failed", error));
    });
    menu.appendChild(button);
  }
  menu.classList.remove("is-hidden");
  const margin = 6;
  const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - margin);
  const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - margin);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
}

function showSidebarContextMenu(node, event) {
  state.selectedBrowserPath = node.path;
  persistSettings();
  syncTreeSelection();
  const finderPath = node.catalogFile?.path || node.catalogFolder?.folderPath || node.path;
  showContextMenu(event, [
    ["Show in Finder", async () => window.spcBoy.showInFinder(finderPath)],
    ["Play Now", async () => activateBrowserNode(node)],
    ["Queue", async () => queueBrowserNode(node)]
  ]);
}

async function activateBrowserNode(node, { playNow = true } = {}) {
  try {
    state.selectedBrowserPath = node.path;
    persistSettings();
    if (node.kind === "folder") {
      expandedFolders.add(node.path);
      await loadBrowserChildren(node);
    }
    const selection = await loadBrowserSelection(node);
    applyFolderSelection(selection);
    const target = selection.playlist?.[0];
    if (playNow && target) await uiApp.playback.playTrack(target.id, 0);
  } catch (error) {
    console.error(error);
  }
}

async function previewBrowserLeaf(node) {
  const generation = ++browserSelectionGeneration;
  try {
    const selection = await loadBrowserSelection(node);
    if (generation !== browserSelectionGeneration || state.selectedBrowserPath !== node.path) return;
    applyFolderSelection(selection);
  } catch (error) {
    console.error(error);
  }
}

async function handleBrowserPrimaryClick(node) {
  if (node.kind === "file") {
    await previewBrowserLeaf(node);
    return;
  }
  // A folder is always a dropdown on a primary click. Its contents may be
  // sent to the playlist only by explicit activation (double-click/Enter).
  await toggleBrowserNode(node);
}

function selectBrowserNode(node, { focus = false, previewLeaf = true } = {}) {
  state.selectedBrowserPath = node.path;
  persistSettings();
  syncTreeSelection();
  if (focus) refs.treeRoot.querySelector(`[data-browser-path="${CSS.escape(node.path)}"]`)?.focus();
  if (previewLeaf && node.kind === "file") void previewBrowserLeaf(node);
}

function visibleBrowserNodes() {
  return [...refs.treeRoot.querySelectorAll(".tree-node")]
    .map((button) => findBrowserNode(filteredTree(), button.dataset.browserPath))
    .filter(Boolean);
}

function moveBrowserSelection(delta) {
  const nodes = visibleBrowserNodes();
  if (!nodes.length) return;
  const currentIndex = nodes.findIndex((node) => node.path === state.selectedBrowserPath);
  const nextIndex = currentIndex < 0
    ? (delta >= 0 ? 0 : nodes.length - 1)
    : Math.max(0, Math.min(nodes.length - 1, currentIndex + delta));
  selectBrowserNode(nodes[nextIndex], { focus: true });
}

function jumpFocusedListToEdge(toEnd, focused = document.activeElement) {
  if (refs.treeRoot.contains(focused)) {
    if (currentSidebarView().contentMode === "tree") {
      const nodes = visibleBrowserNodes();
      if (nodes.length) selectBrowserNode(nodes[toEnd ? nodes.length - 1 : 0], { focus: true });
      return true;
    }
    const games = [...refs.treeRoot.querySelectorAll(".database-console-games:not(.is-hidden) .database-game-row")];
    const target = games[toEnd ? games.length - 1 : 0];
    target?.focus();
    return Boolean(target);
  }
  if (refs.playlistBody.contains(focused) && state.playlist.length) {
    const track = state.playlist[toEnd ? state.playlist.length - 1 : 0];
    selectPlaylistTrack(track.id, { focus: true });
    uiApp.playback.updateTimingSummary();
    uiApp.playback.preloadTrackAudio(track);
    return true;
  }
  return false;
}

function appendPlaylistTracks(additions, selectedBrowserPath = state.selectedBrowserPath) {
  if (!additions.length) return;
  const existingIds = new Set(state.playlist.map((track) => track.id));
  const uniqueAdditions = additions.filter((track) => !existingIds.has(track.id));
  if (!uniqueAdditions.length) return;
  playlistLoadGeneration += 1;
  state.selectedBrowserPath = selectedBrowserPath;
  state.playlist = [...state.playlist, ...uniqueAdditions];
  state.selectedTrackId = uniqueAdditions[0].id;
  state.lastSelectedTrackId = state.selectedTrackId;
  persistSettings();
  renderTree();
  syncTreeSelection();
  renderPlaylist();
  uiApp.playback.updateTimingSummary();
  uiApp.playback.preloadPlaylistAudio(state.playlist, state.selectedTrackId);
  void hydratePlaylistMetadata();
}

async function queueBrowserNode(node) {
  const selection = await loadBrowserSelection(node);
  appendPlaylistTracks(Array.isArray(selection.playlist) ? selection.playlist : [], node.path);
}

async function toggleBrowserNode(node) {
  if (node.kind !== "folder") return;
  if (node.path === state.rootPath) return;
  if (expandedFolders.has(node.path)) expandedFolders.delete(node.path);
  else {
    expandedFolders.add(node.path);
    await loadBrowserChildren(node);
  }
  renderTree();
  syncTreeSelection();
  refs.treeRoot.querySelector(`[data-browser-path="${CSS.escape(node.path)}"]`)?.focus();
}

function renderTreeNode(node, container) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-item";
  const button = document.createElement("button");
  const expanded = isNodeExpanded(node);
  button.dataset.browserPath = node.path;
  button.className = `tree-node${state.selectedBrowserPath === node.path ? " is-selected" : ""}`;
  if (state.selectedBrowserPath === node.path) selectedBrowserButton = button;
  button.classList.toggle("tree-file", node.kind === "file");
  button.setAttribute("aria-expanded", node.kind === "folder" ? String(expanded) : "false");
  button.innerHTML = `
    <span class="tree-disclosure">${node.kind === "folder" ? (expanded ? "▾" : "▸") : "·"}</span><span class="tree-label">${escapeHtml(node.name)}</span>
  `;
  button.addEventListener("click", (event) => {
    window.clearTimeout(browserClickTimer);
    selectBrowserNode(node, { focus: true, previewLeaf: false });
    if (event.detail > 1) return;
    browserClickTimer = window.setTimeout(() => void handleBrowserPrimaryClick(node), 220);
  });
  button.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(browserClickTimer);
    void activateBrowserNode(node);
  });
  button.addEventListener("contextmenu", (event) => showSidebarContextMenu(node, event));
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveBrowserSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") void activateBrowserNode(node);
    else if (node.kind === "folder") void toggleBrowserNode(node);
  });

  wrapper.appendChild(button);

  if (node.kind === "folder" && node.children.length && expanded) {
    const group = document.createElement("div");
    group.className = "tree-group";
    node.children.forEach((child) => renderTreeNode(child, group));
    wrapper.appendChild(group);
  }

  container.appendChild(wrapper);
}

document.addEventListener("pointerdown", (event) => {
  if (!refs.sidebarContextMenu?.contains(event.target)) hideSidebarContextMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideSidebarContextMenu();
});

function filteredTree() {
  const query = state.sidebarQuery.trim().toLowerCase();
  if (!query) {
    return currentSidebarView().view === "paths" ? state.databaseFileTree : state.tree;
  }

  function filterNode(node) {
    const filteredChildren = node.children.map(filterNode).filter(Boolean);
    if (node.name.toLowerCase().includes(query) || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren
      };
    }
    return null;
  }

  const sourceTree = currentSidebarView().view === "paths" ? state.databaseFileTree : state.tree;
  const localMatches = sourceTree.map(filterNode).filter(Boolean);
  return localMatches;
}

const sidebarNaturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function buildCatalogFileTree(files) {
  const roots = new Map();
  const nodeFor = (parent, key, makeNode) => {
    let child = parent.childrenByKey.get(key);
    if (!child) {
      child = makeNode();
      parent.childrenByKey.set(key, child);
      parent.children.push(child);
    }
    return child;
  };

  for (const file of files) {
    const rootKey = `${file.rootId}\u0000${file.rootPath}`;
    let root = roots.get(rootKey);
    if (!root) {
      root = {
        kind: "folder", path: `catalog-root:${rootKey}`, name: file.rootName || file.rootPath,
        alwaysExpanded: true, childrenLoaded: true, children: [], childrenByKey: new Map(),
        catalogFolder: { rootId: file.rootId, folderPath: file.rootPath }
      };
      roots.set(rootKey, root);
    }
    const relativeFolder = String(file.folderPath || "").startsWith(file.rootPath)
      ? String(file.folderPath).slice(file.rootPath.length).replace(/^\/+/, "")
      : "";
    let parent = root;
    let absoluteFolder = file.rootPath;
    for (const segment of relativeFolder.split("/").filter(Boolean)) {
      absoluteFolder = `${absoluteFolder.replace(/\/$/, "")}/${segment}`;
      const parentPath = absoluteFolder;
      parent = nodeFor(parent, `folder:${parentPath}`, () => ({
        kind: "folder", path: `catalog-folder:${file.rootId}:${parentPath}`, name: segment,
        childrenLoaded: true, children: [], childrenByKey: new Map(),
        catalogFolder: { rootId: file.rootId, folderPath: parentPath }
      }));
    }
    const filename = String(file.path || "").split("/").pop() || file.path;
    nodeFor(parent, `file:${file.path}`, () => ({
      kind: "file", path: `catalog-file:${file.rootId}:${file.path}`, name: filename,
      childrenLoaded: true, children: [], catalogFile: file
    }));
  }

  const sortNode = (node) => {
    node.children.sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "folder" ? -1 : 1)
      || sidebarNaturalCollator.compare(left.name, right.name));
    node.children.forEach(sortNode);
    delete node.childrenByKey;
  };
  const tree = [...roots.values()];
  tree.sort((left, right) => sidebarNaturalCollator.compare(left.name, right.name));
  tree.forEach(sortNode);
  return tree;
}

function renderTree() {
  renderedDatabaseGames = null;
  databaseGameButtons = [];
  databaseEmptyState = null;
  databaseConsoleGroups = [];
  selectedBrowserButton = null;
  resetSidebarContent();
  const visibleTree = filteredTree();
  if (visibleTree.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty sidebar-empty";
    empty.textContent = currentSidebarView().view === "paths"
      ? "No catalog paths match this view."
      : state.rootPath
        ? "No subfolders match this view."
        : "Choose Open Path to browse a local folder.";
    refs.treeRoot.appendChild(empty);
    scheduleSelectionIndicators();
    return;
  }

  ensureExpandedToSelection(visibleTree);
  visibleTree.forEach((node) => renderTreeNode(node, refs.treeRoot));
  scheduleSelectionIndicators();
}

function databaseGameKey(game) {
  return `${game.rootId}\u0000${game.name}\u0000${game.system}`;
}

function databaseConsoleName(game) {
  return game.system || "Unknown Console";
}

function visibleDatabaseGames() {
  return Array.isArray(state.databaseSearchGames) ? state.databaseSearchGames : state.databaseGames;
}

function immediateDatabaseSearch(query) {
  const terms = String(query || "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  return state.databaseGames.filter((game) => {
    const text = `${game.name || ""} ${game.system || ""} ${game.rootName || ""}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

function makeDatabaseGameButton(game) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "database-game-row";
  button.dataset.databaseGameKey = databaseGameKey(game);
  button.dataset.searchText = `${game.name} ${game.rootName || ""}`.toLowerCase();
  button.innerHTML = `<span class="database-disclosure">·</span><span class="database-game-name">${escapeHtml(game.displayName || game.name)}</span>${state.sidebarPathCounts ? `<span class="database-game-meta">${game.trackCount}</span>` : ""}`;
  button.addEventListener("click", () => {
    state.selectedDatabaseGameKey = databaseGameKey(game);
    state.selectedDatabaseConsoleName = databaseConsoleName(game);
    persistSettings();
    refs.treeRoot.querySelectorAll(".database-console-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
    selectedDatabaseGameButton?.classList.remove("is-selected");
    selectedDatabaseGameButton = button;
    selectedDatabaseGameButton.classList.add("is-selected");
    scheduleSelectionIndicators();
    button.focus();
    // Database game rows are final sidebar leaves. Selecting one previews its
    // indexed tracks in the playlist; activation is still reserved for
    // double-click or Enter.
    window.clearTimeout(databaseClickTimer);
    databaseClickTimer = window.setTimeout(() => {
      loadDatabaseGame(game).catch((error) => reportDatabaseSidebarError("preview the selected game", error));
    }, 220);
  });
  button.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(databaseClickTimer);
    state.selectedDatabaseGameKey = databaseGameKey(game);
    state.selectedDatabaseConsoleName = databaseConsoleName(game);
    persistSettings();
    loadDatabaseGame(game).then(() => {
      if (state.playlist[0]) return uiApp.playback.playTrack(state.playlist[0].id, 0);
      return undefined;
    }).catch((error) => reportDatabaseSidebarError("play the selected game", error));
  });
  button.addEventListener("contextmenu", (event) => {
    state.selectedDatabaseGameKey = databaseGameKey(game);
    state.selectedDatabaseConsoleName = databaseConsoleName(game);
    persistSettings();
    showContextMenu(event, [
      ["Show in Finder", async () => {
        const rows = await window.spcBoy.databaseGameTracks([game]);
        const row = rows[0];
        if (row) await window.spcBoy.showInFinder(row.archivePath || row.path);
      }],
      ["Play Now", async () => {
        await loadDatabaseGame(game);
        if (state.playlist[0]) await uiApp.playback.playTrack(state.playlist[0].id, 0);
      }],
      ["Queue", async () => appendPlaylistTracks(databaseRowsToPlaylistTracks(await window.spcBoy.databaseGameTracks([game]), [game]))]
    ]);
  });
  return button;
}

function renderDatabaseGames() {
  const gamesForView = visibleDatabaseGames();
  if (renderedDatabaseGames !== gamesForView) {
    resetSidebarContent();
    selectedDatabaseGameButton = null;
    databaseConsoleGroups = [];
    const groupedGames = new Map();
    for (const game of gamesForView) {
      const consoleName = databaseConsoleName(game);
      const games = groupedGames.get(consoleName) || [];
      games.push(game);
      groupedGames.set(consoleName, games);
    }
    databaseGameButtons = [];
    [...groupedGames.keys()].sort((left, right) => sidebarNaturalCollator.compare(left, right)).forEach((consoleName) => {
      const group = document.createElement("div");
      group.className = "database-console-group";
      const heading = document.createElement("button");
      heading.type = "button";
      heading.className = `database-console-row${state.selectedDatabaseConsoleName === consoleName && !state.selectedDatabaseGameKey ? " is-selected" : ""}`;
      heading.dataset.databaseConsoleName = consoleName;
      heading.tabIndex = 0;
      const expanded = !collapsedDatabaseConsoles.has(consoleName);
      heading.innerHTML = `<span class="database-disclosure">${expanded ? "▾" : "▸"}</span><span class="database-console-label">${escapeHtml(consoleName)}</span>`;
      const games = document.createElement("div");
      games.className = "database-console-games";
      games.classList.toggle("is-hidden", !expanded);
      heading.addEventListener("click", () => {
        state.selectedDatabaseConsoleName = consoleName;
        state.selectedDatabaseGameKey = null;
        persistSettings();
        // Derive disclosure state from the model, not from the currently
        // filtered DOM. A search can temporarily force a group open and
        // otherwise made a group such as NEC PC-98 appear impossible to
        // close until Fold All was used.
        const nextExpanded = collapsedDatabaseConsoles.has(consoleName);
        if (nextExpanded) collapsedDatabaseConsoles.delete(consoleName);
        else collapsedDatabaseConsoles.add(consoleName);
        syncCollapsedConsolePersistence();
        heading.innerHTML = `<span class="database-disclosure">${nextExpanded ? "▾" : "▸"}</span><span class="database-console-label">${escapeHtml(consoleName)}</span>`;
        refs.treeRoot.querySelectorAll(".database-game-row.is-selected, .database-console-row.is-selected").forEach((row) => row.classList.remove("is-selected"));
        heading.classList.add("is-selected");
        scheduleSelectionIndicators();
        games.classList.toggle("is-hidden", !nextExpanded);
      });
      heading.addEventListener("keydown", (event) => {
        if (event.key !== " ") return;
        event.preventDefault();
        heading.click();
      });
      heading.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.selectedDatabaseConsoleName = consoleName;
        state.selectedDatabaseGameKey = null;
        activateDatabaseSelection().catch((error) => reportDatabaseSidebarError("play the selected console", error));
      });
      groupedGames.get(consoleName).forEach((game) => {
        const button = makeDatabaseGameButton(game);
        games.appendChild(button);
        databaseGameButtons.push(button);
      });
      group.append(heading, games);
      refs.treeRoot.appendChild(group);
      databaseConsoleGroups.push({ group, games, consoleName });
    });

    databaseEmptyState = document.createElement("div");
    databaseEmptyState.className = "empty sidebar-empty";
    refs.treeRoot.appendChild(databaseEmptyState);
    renderedDatabaseGames = gamesForView;
  }

  const query = state.sidebarQuery.trim();
  for (const button of databaseGameButtons) {
    button.classList.remove("is-hidden");
    button.classList.toggle("is-selected", state.selectedDatabaseGameKey === button.dataset.databaseGameKey);
    if (state.selectedDatabaseGameKey === button.dataset.databaseGameKey) selectedDatabaseGameButton = button;
  }

  for (const { group, games, consoleName } of databaseConsoleGroups) {
    if (query) {
      games.classList.remove("is-hidden");
    } else {
      games.classList.toggle("is-hidden", collapsedDatabaseConsoles.has(consoleName));
    }
    const disclosure = group.querySelector(".database-console-row .database-disclosure");
    if (disclosure) disclosure.textContent = games.classList.contains("is-hidden") ? "▸" : "▾";
  }

  databaseEmptyState.classList.toggle("is-hidden", !state.databaseSidebarError && gamesForView.length > 0);
  databaseEmptyState.textContent = state.databaseSidebarError || (state.databaseGames.length
    ? "No database games match this search."
    : "Use MediaScanner to populate the selected database.");
  scheduleSelectionIndicators();
}

function setAllDatabaseConsolesCollapsed(collapsed) {
  for (const { consoleName } of databaseConsoleGroups) {
    if (collapsed) collapsedDatabaseConsoles.add(consoleName);
    else collapsedDatabaseConsoles.delete(consoleName);
  }
  syncCollapsedConsolePersistence();
  renderDatabaseGames();
}

async function setAllSidebarNodesCollapsed(collapsed) {
  if (currentSidebarView().contentMode === "database") {
    setAllDatabaseConsolesCollapsed(collapsed);
    return;
  }

  if (collapsed) {
    expandedFolders.clear();
    state.selectedBrowserPath = currentSidebarView().view === "paths"
      ? state.databaseFileTree[0]?.path || null
      : state.rootPath;
    persistSettings();
    renderTree();
    syncTreeSelection();
    return;
  }

  async function expandFolder(node) {
    if (node.kind !== "folder") return;
    expandedFolders.add(node.path);
    if (currentSidebarView().view !== "paths") await loadBrowserChildren(node);
    await Promise.all(node.children.filter((child) => child.kind === "folder").map(expandFolder));
  }
  await Promise.all(state.tree.map(expandFolder));
  renderTree();
  syncTreeSelection();
}

async function loadDatabaseGames() {
  await refreshDatabaseGamesForVisibleRoots();
  renderAll();
}

async function loadDatabaseFiles() {
  try {
    state.databaseFiles = await window.spcBoy.databaseFiles();
    state.databaseFileTree = buildCatalogFileTree(state.databaseFiles);
    state.databaseSidebarError = "";
  } catch (error) {
    reportDatabaseSidebarError("read the catalog paths", error);
    throw error;
  }
}

async function setSidebarMode(mode) {
  if (!["paths", "consoles", "diskPath"].includes(mode)) return;
  state.sidebarMode = mode;
  state.sidebarQuery = "";
  refs.sidebarSearchInput.value = "";
  state.databaseSearchGames = null;
  if (mode === "paths" && !state.databaseFiles.length) await loadDatabaseFiles();
  if (mode === "consoles" && !state.databaseGames.length) await loadDatabaseGames();
  persistSettings();
  renderAll();
  syncTreeSelection();
}

async function refreshDatabaseGamesForVisibleRoots() {
  const previousSelection = state.selectedDatabaseGameKey;
  try {
    state.databaseGames = await window.spcBoy.databaseGames();
  } catch (error) {
    reportDatabaseSidebarError("read the database sidebar", error);
    throw error;
  }
  state.databaseSidebarError = "";
  state.databaseSearchGames = null;
  if (previousSelection && !state.databaseGames.some((game) => databaseGameKey(game) === previousSelection)) {
    state.selectedDatabaseGameKey = null;
    state.playlist = [];
    state.selectedTrackId = null;
    state.lastSelectedTrackId = null;
    persistSettings();
  }
}

function updateSidebarSearch(query) {
  state.sidebarQuery = String(query || "");
  const databaseGeneration = ++state.databaseSearchGeneration;
  state.databaseSearchGames = state.sidebarQuery.trim() ? immediateDatabaseSearch(state.sidebarQuery) : null;
  window.clearTimeout(sidebarSearchTimer);
  renderSidebar();
  const requestedQuery = state.sidebarQuery.trim();
  if (!requestedQuery) return;
  if (window.spcBoy?.databaseSearchGames) {
    sidebarSearchTimer = window.setTimeout(() => {
      window.spcBoy.databaseSearchGames(requestedQuery)
        .then((games) => {
          if (databaseGeneration !== state.databaseSearchGeneration || state.sidebarQuery.trim() !== requestedQuery) return;
          state.databaseSidebarError = "";
          state.databaseSearchGames = Array.isArray(games) ? games : [];
          renderSidebar();
        })
        .catch((error) => {
          if (databaseGeneration !== state.databaseSearchGeneration) return;
          reportDatabaseSidebarError("search the database", error);
        });
    }, 120);
    return;
  }
}

async function loadDatabaseGame(game) {
  await loadDatabaseGamesIntoPlaylist([game]);
}

function reportDatabaseSidebarError(action, error) {
  const detail = String(error?.message || error || "Unknown database error");
  state.databaseSidebarError = `Could not ${action}: ${detail}`;
  console.error(`[SPCBoy] could not ${action}`, error);
  if (currentSidebarView().contentMode === "database") renderDatabaseGames();
}

function databaseRowsToPlaylistTracks(rows, games) {
  const fallbackGame = games[0] || {};
  return rows.map((row, index) => ({
    id: row.playlistId,
    index: index + 1,
    path: row.path,
    rootPath: row.rootPath || fallbackGame.rootPath || state.rootPath,
    sourceFilename: row.filename,
    trackIndex: Number(row.trackIndex) || 0,
    trackCount: Math.max(1, Number(row.trackCount) || 1),
    archivePath: row.archivePath || null,
    archiveEntry: row.archiveEntry || null,
    fileSize: Number(row.fileSize) || 0,
    modifiedAt: Number(row.modifiedAt) || 0,
    sourceSignature: row.sourceSignature || null,
    scanVersion: Number(row.scanVersion) || 0,
    filename: `${row.filename}${Number(row.trackCount) > 1 ? ` [${Number(row.trackIndex) + 1}]` : ""}`,
    displayName: `${row.filename.replace(/\.[^.]+$/i, "")}${Number(row.trackCount) > 1 ? ` [${Number(row.trackIndex) + 1}]` : ""}`,
    title: row.title || row.filename.replace(/\.[^.]+$/i, ""),
    game: row.game || fallbackGame.name || "—",
    artist: row.artist || "—",
    system: row.system || fallbackGame.system || "—",
    lengthLabel: row.playLengthMs > 0 ? uiApp.formatTime(Math.round(row.playLengthMs / 1000)) : "—",
    basePlaybackSeconds: row.playLengthMs > 0 ? row.playLengthMs / 1000 : 0,
    metadataLoaded: Number(row.metadataTrackId) > 0
  }));
}

async function loadDatabaseGamesIntoPlaylist(games) {
  const loadGeneration = ++playlistLoadGeneration;
  const rows = await window.spcBoy.databaseGameTracks(games);
  if (loadGeneration !== playlistLoadGeneration) return;
  state.databaseSidebarError = "";
  state.selectedDatabaseGameKey = games.length === 1 ? databaseGameKey(games[0]) : null;
  state.playlist = databaseRowsToPlaylistTracks(rows, games);
  state.selectedTrackId = state.playlist[0]?.id || null;
  state.lastSelectedTrackId = state.selectedTrackId;
  persistSettings();
  renderAll();
  uiApp.playback.preloadPlaylistAudio(state.playlist, state.selectedTrackId);
  void hydratePlaylistMetadata();
}

async function activateDatabaseSelection() {
  const gamesForView = visibleDatabaseGames();
  if (state.selectedDatabaseConsoleName) {
    const games = gamesForView.filter((game) => databaseConsoleName(game) === state.selectedDatabaseConsoleName);
    if (games.length) {
      await loadDatabaseGamesIntoPlaylist(games);
      if (state.playlist[0]) await uiApp.playback.playTrack(state.playlist[0].id, 0);
      return;
    }
  }
  const game = gamesForView.find((entry) => databaseGameKey(entry) === state.selectedDatabaseGameKey);
  if (game) {
    await loadDatabaseGame(game);
    if (state.playlist[0]) await uiApp.playback.playTrack(state.playlist[0].id, 0);
  }
}

async function activateFocusedItem(focusTarget = document.activeElement) {
  const focused = focusTarget?.closest?.(".playlist-row, .tree-node, .database-game-row, .database-console-row") || document.activeElement;
  const playlistRow = focused?.closest?.(".playlist-row");
  if (playlistRow?.dataset.trackId) {
    // The visual selection is the activation target. Focus can legitimately
    // lag while arrow navigation advances the selected row.
    const track = selectPlaylistTrack(state.selectedTrackId || playlistRow.dataset.trackId);
    if (!track) return false;
    await uiApp.playback.playTrack(track.id, 0);
    return true;
  }

  const browserButton = focused?.closest?.(".tree-node");
  if (browserButton?.dataset.browserPath) {
    const node = findBrowserNode(filteredTree(), browserButton.dataset.browserPath);
    if (node) {
      await activateBrowserNode(node);
      return true;
    }
  }

  const databaseGameButton = focused?.closest?.(".database-game-row");
  if (databaseGameButton?.dataset.databaseGameKey) {
    const game = visibleDatabaseGames().find((entry) => databaseGameKey(entry) === databaseGameButton.dataset.databaseGameKey);
    if (game) {
      state.selectedDatabaseGameKey = databaseGameButton.dataset.databaseGameKey;
      state.selectedDatabaseConsoleName = databaseConsoleName(game);
      persistSettings();
      await loadDatabaseGame(game);
      if (state.playlist[0]) await uiApp.playback.playTrack(state.playlist[0].id, 0);
      return true;
    }
  }

  const databaseConsoleButton = focused?.closest?.(".database-console-row");
  if (databaseConsoleButton?.dataset.databaseConsoleName) {
    state.selectedDatabaseConsoleName = databaseConsoleButton.dataset.databaseConsoleName;
    await activateDatabaseSelection();
    return true;
  }

  return false;
}

function renderSidebar() {
  const view = currentSidebarView();
  const title = view.view === "paths" ? "Catalog Paths" : view.view === "diskPath" ? "Disk Path" : "Catalog Consoles";
  refs.sidebarViewMenuButton.title = `Choose sidebar view (currently ${title})`;
  refs.sidebarViewMenuButton.setAttribute("aria-label", refs.sidebarViewMenuButton.title);
  refs.sidebarViewMenuButton.classList.toggle("is-selected", true);
  if (view.contentMode === "database") renderDatabaseGames();
  else renderTree();
}

function syncAnimatedRanges() {
  document.querySelectorAll(".animated-range").forEach((input) => {
    const minimum = Number(input.min || 0);
    const maximum = Number(input.max || 100);
    const value = Number(input.value || 0);
    const percent = maximum > minimum
      ? ((value - minimum) / (maximum - minimum)) * 100
      : 0;
    input.parentElement?.style.setProperty("--range-percent", `${Math.max(0, Math.min(100, percent))}%`);
  });
}

function syncTreeSelection() {
  if (selectedBrowserButton?.dataset.browserPath !== state.selectedBrowserPath) {
    selectedBrowserButton?.classList.remove("is-selected");
    selectedBrowserButton = state.selectedBrowserPath
      ? refs.treeRoot.querySelector(`[data-browser-path="${CSS.escape(state.selectedBrowserPath)}"]`)
      : null;
    selectedBrowserButton?.classList.add("is-selected");
  }
  scrollSelectedBrowserItemIntoView();
  scheduleSelectionIndicators();
}

function allColumns() {
  return state.columnOrder
    .map((columnId) => COLUMN_DEFS.find((column) => column.id === columnId))
    .filter(Boolean);
}

function orderedColumns() {
  return allColumns().filter((column) => state.columnVisibility[column.id]);
}

function playlistSortValue(track, column) {
  if (column.id === "lengthLabel") {
    return Number(track.basePlaybackSeconds) || 0;
  }
  return String(playlistColumnValue(track, column)).toLocaleLowerCase();
}

function playlistDisplayPath(track) {
  const sourcePath = String(track.path || "");
  const rootPath = String(track.rootPath || state.rootPath || "");
  if (!sourcePath || !rootPath) return sourcePath;
  const hashIndex = sourcePath.indexOf("#");
  const physicalPath = hashIndex === -1 ? sourcePath : sourcePath.slice(0, hashIndex);
  const archiveSuffix = hashIndex === -1 ? "" : sourcePath.slice(hashIndex);
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  const normalizedPhysical = physicalPath.replace(/\\/g, "/");
  const normalizedRootForMatch = normalizedRoot.replace(/\\/g, "/");
  const rootPrefix = `${normalizedRootForMatch}/`;
  const rootLabel = normalizedRootForMatch.split("/").at(-1);
  const sourceForMatch = normalizedPhysical.toLocaleLowerCase();
  const rootForMatch = normalizedRootForMatch.toLocaleLowerCase();
  if (sourceForMatch === rootForMatch) return `${rootLabel}${archiveSuffix}`;
  if (sourceForMatch.startsWith(rootPrefix.toLocaleLowerCase())) return `${rootLabel}/${normalizedPhysical.slice(rootPrefix.length)}${archiveSuffix}`;
  return sourcePath;
}

function playlistColumnValue(track, column, rowIndex = null) {
  if (column.id === "index") return rowIndex === null ? "" : rowIndex + 1;
  return column.id === "path" ? playlistDisplayPath(track) : (track[column.id] ?? "");
}

function sortPlaylist() {
  const column = COLUMN_DEFS.find((candidate) => candidate.id === state.sortColumn) || COLUMN_DEFS.find((candidate) => candidate.id === "filename");
  const direction = state.sortDirection === "descending" ? -1 : 1;
  state.playlist.sort((left, right) => {
    const leftValue = playlistSortValue(left, column);
    const rightValue = playlistSortValue(right, column);
    if (leftValue < rightValue) return -1 * direction;
    if (leftValue > rightValue) return 1 * direction;
    return String(left.id).localeCompare(String(right.id));
  });
}

function closeColumnMenu() {
  columnMenu?.remove();
  columnMenu = null;
}

function showColumnMenu(event) {
  closeColumnMenu();
  columnMenu = document.createElement("div");
  columnMenu.className = "column-menu";
  columnMenu.addEventListener("click", (menuEvent) => menuEvent.stopPropagation());

  for (const column of allColumns()) {
    const label = document.createElement("label");
    label.className = "column-menu-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.columnVisibility[column.id];
    checkbox.disabled = column.id === "filename" && checkbox.checked;
    checkbox.addEventListener("change", () => {
      state.columnVisibility[column.id] = checkbox.checked;
      if (!Object.values(state.columnVisibility).some(Boolean)) {
        state.columnVisibility.filename = true;
      }
      persistSettings();
      // Visibility changes must be immediate. Full content measurement belongs
      // to playlist population or an explicit header-seam auto-size action.
      autoSizedPlaylistSignature = playlistAutoSizeSignature();
      closeColumnMenu();
      renderPlaylistHeader();
      renderPlaylist();
    });
    label.append(checkbox, document.createTextNode(column.label));
    columnMenu.appendChild(label);
  }

  document.body.appendChild(columnMenu);
  document.addEventListener("click", closeColumnMenu, { once: true });
  const left = Math.min(event.clientX, window.innerWidth - columnMenu.offsetWidth - 8);
  const top = Math.min(event.clientY, window.innerHeight - columnMenu.offsetHeight - 8);
  columnMenu.style.left = `${Math.max(8, left)}px`;
  columnMenu.style.top = `${Math.max(8, top)}px`;
}

function beginColumnResize(event, columnId, header) {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const tableWidth = refs.playlistHeaderRow.closest("table").getBoundingClientRect().width;
  const startWidth = state.columnWidths[columnId];
  const onMove = (moveEvent) => {
    const nextWidth = Math.max(4, Math.min(80, startWidth + ((moveEvent.clientX - startX) / tableWidth) * 100));
    state.columnWidths[columnId] = nextWidth;
    header.style.width = `${nextWidth}%`;
    for (const row of playlistRowsByTrackId.values()) {
      const cell = row.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`);
      if (cell) cell.style.width = `${nextWidth}%`;
    }
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    const columns = orderedColumns();
    const otherColumns = columns.filter((column) => column.id !== columnId);
    const draggedWidth = state.columnWidths[columnId];
    const targetOtherTotal = Math.max(4 * otherColumns.length, 100 - draggedWidth);
    const otherTotal = otherColumns.reduce((sum, column) => sum + state.columnWidths[column.id], 0);
    if (otherTotal > 0) {
      for (const column of otherColumns) {
        state.columnWidths[column.id] = Math.max(4, state.columnWidths[column.id] * targetOtherTotal / otherTotal);
      }
    } else {
      const fallback = targetOtherTotal / Math.max(1, otherColumns.length);
      for (const column of otherColumns) state.columnWidths[column.id] = fallback;
    }
    persistSettings();
    renderPlaylistHeader();
    syncPlaylistColumnWidths();
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp, { once: true });
}

function columnContentWidth(columnId) {
  const header = refs.playlistHeaderRow.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`);
  const column = COLUMN_DEFS.find((candidate) => candidate.id === columnId);
  if (!column) return 0;
  textMeasureContext ||= document.createElement("canvas").getContext("2d");
  const styleSource = header?.querySelector(".playlist-header-label") || header || refs.playlistBody;
  const style = getComputedStyle(styleSource);
  textMeasureContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const values = [column.label, ...state.playlist.map((track, rowIndex) => String(playlistColumnValue(track, column, rowIndex)))];
  return Math.max(...values.map((value) => textMeasureContext.measureText(value).width), 0) + 24;
}

function autoSizeColumns() {
  const columns = orderedColumns();
  if (!columns.length || !state.playlist.length) return;
  const preferredWidths = columns.map((column) => columnContentWidth(column.id));
  const totalWidth = preferredWidths.reduce((sum, width) => sum + width, 0);
  if (!totalWidth) return;
  const table = refs.playlistHeaderRow.closest("table");
  const availableWidth = refs.playlistScrollWrap?.clientWidth || table.clientWidth || totalWidth;
  const width = `${Math.max(availableWidth, totalWidth)}px`;
  table.style.width = width;
  refs.playlistBodyTable.style.width = width;
  columns.forEach((column, index) => {
    state.columnWidths[column.id] = (preferredWidths[index] / totalWidth) * 100;
  });
  persistSettings();
}

function autoSizeColumn(columnId) {
  if (!state.playlist.length || !state.columnVisibility[columnId]) return;
  const columns = orderedColumns();
  const tableWidth = refs.playlistHeaderRow.closest("table").getBoundingClientRect().width;
  const nextWidth = Math.max(4, Math.min(80, (columnContentWidth(columnId) / tableWidth) * 100));
  const previousWidth = state.columnWidths[columnId];
  const otherColumns = columns.filter((column) => column.id !== columnId);
  const otherTotal = otherColumns.reduce((sum, column) => sum + state.columnWidths[column.id], 0);
  const targetOtherTotal = Math.max(4 * otherColumns.length, 100 - nextWidth);
  state.columnWidths[columnId] = nextWidth;
  if (otherTotal > 0) {
    for (const column of otherColumns) {
      state.columnWidths[column.id] = Math.max(4, state.columnWidths[column.id] * targetOtherTotal / otherTotal);
    }
  } else {
    const fallback = targetOtherTotal / Math.max(1, otherColumns.length);
    for (const column of otherColumns) state.columnWidths[column.id] = fallback;
  }
  if (!Number.isFinite(previousWidth)) state.columnWidths[columnId] = nextWidth;
  persistSettings();
  renderPlaylistHeader();
  syncPlaylistColumnWidths();
}

function renderPlaylistHeader() {
  refs.playlistHeaderRow.innerHTML = "";

  for (const column of orderedColumns()) {
    const th = document.createElement("th");
    th.dataset.columnId = column.id;
    th.draggable = true;
    th.className = column.className || "";
    th.style.width = `${state.columnWidths[column.id]}%`;
    th.title = column.sortable === false ? "Line number" : `Sort by ${column.label}`;

    const label = document.createElement("span");
    label.className = "playlist-header-label";
    label.textContent = column.label;
    if (state.sortColumn === column.id) {
      label.textContent += state.sortDirection === "ascending" ? " ▲" : " ▼";
    }
    th.appendChild(label);

    const resizeHandle = document.createElement("span");
    resizeHandle.className = "column-resize-handle";
    resizeHandle.addEventListener("pointerdown", (event) => beginColumnResize(event, column.id, th));
    resizeHandle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      autoSizeColumn(column.id);
    });
    th.appendChild(resizeHandle);

    if (column.sortable !== false) th.addEventListener("click", (event) => {
      if (event.target === resizeHandle) return;
      if (state.sortColumn === column.id) {
        state.sortDirection = state.sortDirection === "ascending" ? "descending" : "ascending";
      } else {
        state.sortColumn = column.id;
        state.sortDirection = "ascending";
      }
      persistSettings();
      sortPlaylist();
      renderPlaylistHeader();
      renderPlaylist();
    });

    th.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showColumnMenu(event);
    });

    th.addEventListener("dragstart", (event) => {
      draggedColumnId = column.id;
      th.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", column.id);
    });

    th.addEventListener("dragend", () => {
      draggedColumnId = null;
      refs.playlistHeaderRow.querySelectorAll("th").forEach((cell) => {
        cell.classList.remove("is-dragging", "is-drop-target");
      });
    });

    th.addEventListener("dragover", (event) => {
      if (!draggedColumnId || draggedColumnId === column.id) {
        return;
      }

      event.preventDefault();
      th.classList.add("is-drop-target");
    });

    th.addEventListener("dragleave", () => {
      th.classList.remove("is-drop-target");
    });

    th.addEventListener("drop", (event) => {
      if (!draggedColumnId || draggedColumnId === column.id) {
        return;
      }

      event.preventDefault();
      const nextOrder = [...state.columnOrder];
      const fromIndex = nextOrder.indexOf(draggedColumnId);
      const toIndex = nextOrder.indexOf(column.id);
      if (fromIndex < 0 || toIndex < 0) {
        return;
      }

      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);
      state.columnOrder = uiApp.normalizeColumnOrder(nextOrder);
      persistSettings();
      renderPlaylistHeader();
      renderPlaylist();
    });

    refs.playlistHeaderRow.appendChild(th);
  }
}

function renderPlaylistCell(track, column, rowIndex) {
  const td = document.createElement("td");
  td.className = column.className || "";
  td.dataset.columnId = column.id;
  td.style.width = `${state.columnWidths[column.id]}%`;
  td.textContent = String(playlistColumnValue(track, column, rowIndex));
  return td;
}

function playlistAutoSizeSignature() {
  const columns = orderedColumns();
  return columns.map((column) => column.id).join("\u0001") + "\u0002" + state.playlist
    .map((track, rowIndex) => columns.map((column) => String(playlistColumnValue(track, column, rowIndex))).join("\u0001"))
    .join("\u0002");
}

function updatePlaylistRowState(row, trackId) {
  if (!row) return;
  row.classList.toggle("is-selected", state.selectedTrackId === trackId);
  row.classList.toggle("is-current", state.currentTrackId === trackId);
}

function selectPlaylistTrack(trackId, { focus = false } = {}) {
  const track = state.playlist.find((entry) => entry.id === trackId);
  if (!track) return null;

  const previousRow = selectedPlaylistRow;
  const selectionChanged = state.selectedTrackId !== track.id;
  state.selectedTrackId = track.id;
  state.lastSelectedTrackId = track.id;
  if (selectionChanged) persistSettings();

  const nextRow = playlistRowsByTrackId.get(track.id) || null;
  previousRow?.classList.remove("is-selected");
  nextRow?.classList.add("is-selected");
  selectedPlaylistRow = nextRow;
  scheduleSelectionIndicators();
  if (focus) nextRow?.focus({ preventScroll: true });
  return track;
}

function refreshPlaylistPlaybackState() {
  selectedPlaylistRow?.classList.toggle("is-selected", selectedPlaylistRow.dataset.trackId === state.selectedTrackId);
  const nextSelectedRow = state.selectedTrackId ? playlistRowsByTrackId.get(state.selectedTrackId) || null : null;
  nextSelectedRow?.classList.add("is-selected");
  selectedPlaylistRow = nextSelectedRow;

  currentPlaylistRow?.classList.remove("is-current");
  const nextCurrentRow = state.currentTrackId ? playlistRowsByTrackId.get(state.currentTrackId) || null : null;
  nextCurrentRow?.classList.add("is-current");
  currentPlaylistRow = nextCurrentRow;
  scheduleSelectionIndicators();
}

function refreshPlaylistRow(trackId) {
  const track = state.playlist.find((entry) => entry.id === trackId);
  const rowIndex = state.playlist.findIndex((entry) => entry.id === trackId);
  const row = playlistRowsByTrackId.get(trackId);
  if (!track || !row) return false;

  row.setAttribute("aria-label", `${track.title || track.filename || "Track"}`);
  for (const column of orderedColumns()) {
    const cell = row.querySelector(`[data-column-id="${CSS.escape(column.id)}"]`);
    if (!cell) return false;
    cell.textContent = String(playlistColumnValue(track, column, rowIndex));
    cell.style.width = `${state.columnWidths[column.id]}%`;
  }
  updatePlaylistRowState(row, trackId);
  return true;
}

function playlistSortDependsOnMetadata() {
  return ["title", "game", "artist", "system", "lengthLabel"].includes(state.sortColumn);
}

function syncPlaylistColumnWidths() {
  for (const row of playlistRowsByTrackId.values()) {
    for (const column of orderedColumns()) {
      const cell = row.querySelector(`[data-column-id="${CSS.escape(column.id)}"]`);
      if (cell) cell.style.width = `${state.columnWidths[column.id]}%`;
    }
  }
}

function renderPlaylist() {
  refs.playlistBody.innerHTML = "";
  playlistRowsByTrackId.clear();
  selectedPlaylistRow = null;
  currentPlaylistRow = null;
  sortPlaylist();
  const playlistSignature = playlistAutoSizeSignature();
  const shouldAutoSize = state.columnAutoSize && playlistSignature !== autoSizedPlaylistSignature;

  if (state.playlist.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="${Math.max(1, orderedColumns().length)}" class="empty-row"></td>`;
    refs.playlistBody.appendChild(row);
    scheduleSelectionIndicators();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const [rowIndex, track] of state.playlist.entries()) {
    const row = document.createElement("tr");
    row.dataset.trackId = track.id;
    row.tabIndex = 0;
    row.setAttribute("aria-label", `${track.title || track.filename || "Track"}`);
    row.className = `playlist-row${state.selectedTrackId === track.id ? " is-selected" : ""}${state.currentTrackId === track.id ? " is-current" : ""}`;
    playlistRowsByTrackId.set(track.id, row);
    if (state.selectedTrackId === track.id) selectedPlaylistRow = row;
    if (state.currentTrackId === track.id) currentPlaylistRow = row;

    for (const column of orderedColumns()) {
      row.appendChild(renderPlaylistCell(track, column, rowIndex));
    }

    row.addEventListener("click", () => {
      const selectedTrack = selectPlaylistTrack(track.id, { focus: true });
      uiApp.playback.updateTimingSummary();
      uiApp.playback.preloadTrackAudio(selectedTrack);
    });

    row.addEventListener("mousedown", () => {
      selectPlaylistTrack(track.id);
    });

    row.addEventListener("dblclick", () => {
      uiApp.playback.playTrack(track.id, 0).catch((error) => {
        console.error(error);
      });
    });

    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      const selectedTrack = selectPlaylistTrack(state.selectedTrackId || track.id);
      if (!selectedTrack) return;
      uiApp.playback.playTrack(selectedTrack.id, 0).catch((error) => {
        console.error(error);
      });
    });

    fragment.appendChild(row);
  }
  refs.playlistBody.appendChild(fragment);
  if (shouldAutoSize) {
    autoSizedPlaylistSignature = playlistSignature;
    autoSizeColumns();
    renderPlaylistHeader();
    syncPlaylistColumnWidths();
  }
  scheduleSelectionIndicators();
}

function scheduleMetadataRefresh(trackId) {
  if (trackId) metadataRefreshTrackIds.add(trackId);
  if (metadataRefreshFrame) {
    return;
  }

  metadataRefreshFrame = window.requestAnimationFrame(() => {
    metadataRefreshFrame = 0;
    const trackIds = [...metadataRefreshTrackIds];
    metadataRefreshTrackIds.clear();
    const mustReorder = playlistSortDependsOnMetadata();
    if (mustReorder || trackIds.some((id) => !refreshPlaylistRow(id))) {
      renderPlaylist();
    } else if (state.columnAutoSize && trackIds.length) {
      autoSizedPlaylistSignature = playlistAutoSizeSignature();
      autoSizeColumns();
      renderPlaylistHeader();
      syncPlaylistColumnWidths();
    }
    uiApp.playback.updateTimingSummary();
  });
}

function applyUISettings() {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--ui-font-size-pt", String(state.uiFontSizePt));
  rootStyle.setProperty("--app-font-family", state.applicationMonospace ? "var(--mono-font-family)" : "var(--ui-font-family)");
  rootStyle.setProperty("--sidebar-font-size-pt", String(state.sidebarFontSizePt));
  rootStyle.setProperty("--sidebar-text-color", state.sidebarTextColor);
  rootStyle.setProperty("--sidebar-font-family", state.sidebarMonospace || state.applicationMonospace ? "var(--mono-font-family)" : "var(--ui-font-family)");
  rootStyle.setProperty("--playlist-font-size-pt", String(state.playlistFontSizePt));
  rootStyle.setProperty("--playlist-text-color", state.playlistTextColor);
  rootStyle.setProperty("--playlist-font-family", state.playlistMonospace || state.applicationMonospace ? "var(--mono-font-family)" : "var(--ui-font-family)");
  rootStyle.setProperty("--playlist-header-font-weight", state.playlistHeaderBold ? "700" : "400");
  rootStyle.setProperty("--sidebar-width-percent", String(state.sidebarWidthPercent));
  rootStyle.setProperty("--accent", state.accentColor);
  rootStyle.setProperty("--item-spacing-rem", String(state.uiItemSpacingRem));
}

function appearanceSettings() {
  return {
    uiItemSpacingRem: state.uiItemSpacingRem,
    sidebarWidthPercent: state.sidebarWidthPercent,
    sidebarFontSizePt: state.sidebarFontSizePt,
    sidebarTextColor: state.sidebarTextColor,
    sidebarMonospace: state.sidebarMonospace,
    sidebarPathCounts: state.sidebarPathCounts,
    playlistFontSizePt: state.playlistFontSizePt,
    playlistTextColor: state.playlistTextColor,
    playlistMonospace: state.playlistMonospace,
    applicationMonospace: state.applicationMonospace,
    playlistHeaderBold: state.playlistHeaderBold,
    accentColor: state.accentColor
  };
}

function broadcastAppearanceSettings() {
  window.spcBoy?.setAppearanceSettings?.(appearanceSettings());
}

function formatArchiveCacheSummary(summary) {
  const size = `${(Number(summary?.byteCount || 0) / (1024 * 1024)).toFixed(1)} MB`;
  const limit = Number(summary?.limitBytes || state.archiveCacheLimitBytes || 0);
  const limitLabel = limit >= 1024 * 1024 * 1024
    ? `${(limit / (1024 * 1024 * 1024)).toFixed(limit % (1024 * 1024 * 1024) ? 1 : 0)} GB limit`
    : `${Math.round(limit / (1024 * 1024))} MB limit`;
  return `${size} • ${summary?.fileCount || 0} files • ${limitLabel}${summary?.partialCount ? ` • ${summary.partialCount} partial` : ""}${summary?.legacyFileCount ? ` • ${summary.legacyFileCount} legacy` : ""}`;
}

function renderRoutingConflicts() {
  const conflicts = window.SPCBoyPlaybackBackends?.conflicts || [];
  if (!conflicts.length) {
    refs.routingConflictsList.innerHTML = '<div class="options-help-text">No overlapping decoder extensions are registered. New plugins that overlap an existing format will appear here before their routing policy is applied.</div>';
    return;
  }
  refs.routingConflictsList.innerHTML = conflicts.map(({ extension, candidates }) => {
    const candidateNames = candidates.map((backend) => escapeHtml(backend.displayName || backend.id)).join(" → ");
    const preferredBackendId = state.routingPreferences[extension] || candidates[0]?.id;
    return `<label class="routing-conflict"><span><strong>${escapeHtml(extension)}</strong><small>${candidateNames}</small></span><select class="options-input" data-routing-extension="${escapeHtml(extension)}" aria-label="Decoder for ${escapeHtml(extension)}">${candidates.map((backend) => `<option value="${escapeHtml(backend.id)}" ${backend.id === preferredBackendId ? "selected" : ""}>${escapeHtml(backend.displayName || backend.id)}</option>`).join("")}</select></label>`;
  }).join("");
  refs.routingConflictsList.querySelectorAll("[data-routing-extension]").forEach((input) => {
    input.addEventListener("change", () => setRoutingPreference(input.dataset.routingExtension, input.value));
  });
}

function setRoutingPreference(extension, backendId) {
  const candidates = window.SPCBoyPlaybackBackends?.candidatesForPath?.(`route${extension}`) || [];
  if (!candidates.some((backend) => backend.id === backendId)) return;
  const nextPreferences = { ...state.routingPreferences };
  if (backendId === candidates[0]?.id) delete nextPreferences[extension];
  else nextPreferences[extension] = backendId;
  state.routingPreferences = nextPreferences;
  persistSettings();
  window.spcBoy?.setRoutingPreferences?.(nextPreferences).then((normalizedPreferences) => {
    state.routingPreferences = { ...normalizedPreferences };
    persistSettings();
    renderAll();
  }).catch((error) => console.error("[SPCBoy] routing preference update failed", error));
  renderAll();
}

function applyRoutingPreferences(preferences) {
  state.routingPreferences = preferences && typeof preferences === "object" ? { ...preferences } : {};
  persistSettings();
  renderAll();
}

function renderAll() {
  applyUISettings();
  refs.optionsOverlay.classList.toggle("is-hidden", !state.optionsOpen);
  refs.optionsOverlay.setAttribute("aria-hidden", state.optionsOpen ? "false" : "true");
  const databaseSelected = state.optionsSection === "database";
  const routingSelected = state.optionsSection === "routing";
  const playbackSelected = state.optionsSection === "playback";
  const themeSelected = state.optionsSection === "theme";
  refs.optionsDatabaseTab.classList.toggle("is-selected", databaseSelected);
  refs.optionsRoutingTab.classList.toggle("is-selected", routingSelected);
  refs.optionsPlaybackTab.classList.toggle("is-selected", playbackSelected);
  refs.optionsThemeTab.classList.toggle("is-selected", themeSelected);
  refs.optionsThemeSection.classList.toggle("is-hidden", !themeSelected);
  refs.optionsDatabaseSection.classList.toggle("is-hidden", !databaseSelected);
  refs.optionsRoutingSection.classList.toggle("is-hidden", !routingSelected);
  refs.optionsPlaybackSection.classList.toggle("is-hidden", !playbackSelected);
  renderRoutingConflicts();
  refs.sidebarFontSizeInput.value = String(state.sidebarFontSizePt);
  refs.sidebarTextColorInput.value = state.sidebarTextColor;
  refs.sidebarMonospaceCheckbox.checked = state.sidebarMonospace;
  refs.sidebarPathCountsCheckbox.checked = state.sidebarPathCounts;
  refs.playlistFontSizeInput.value = String(state.playlistFontSizePt);
  refs.playlistTextColorInput.value = state.playlistTextColor;
  if (document.activeElement !== refs.accentColorInput) refs.accentColorInput.value = state.accentColor;
  refs.playlistMonospaceCheckbox.checked = state.playlistMonospace;
  refs.applicationMonospaceCheckbox.checked = state.applicationMonospace;
  refs.playlistHeaderBoldCheckbox.checked = state.playlistHeaderBold;
  refs.columnAutoSizeCheckbox.checked = state.columnAutoSize;
  refs.archiveCacheEnabledCheckbox.checked = state.archiveCacheEnabled;
  refs.archiveCacheLimitSelect.value = String(state.archiveCacheLimitBytes);
  refs.archiveCacheLimitSelect.disabled = !state.archiveCacheEnabled;
  refs.playbackSpeedEnabledCheckbox.checked = state.playbackSpeedEnabled;
  if (document.activeElement !== refs.playbackSpeedInput) refs.playbackSpeedInput.value = uiApp.formatPlaybackSpeed(state.playbackSpeed);
  refs.libvgmPlaybackSpeedEnabledCheckbox.checked = state.libvgmPlaybackSpeedEnabled;
  if (document.activeElement !== refs.libvgmPlaybackSpeedInput) refs.libvgmPlaybackSpeedInput.value = uiApp.formatPlaybackSpeed(state.libvgmPlaybackSpeed);
  refs.longPlayButton.classList.toggle("is-selected", state.longPlayEnabled);
  refs.longPlayButton.setAttribute("aria-pressed", state.longPlayEnabled ? "true" : "false");
  refs.longPlayButton.title = state.longPlayEnabled ? "Long Play enabled" : "Long Play disabled";
  refs.longPlayButton.setAttribute("aria-label", refs.longPlayButton.title);
  const repeatTitles = { off: "Repeat off", all: "Repeat all", one: "Repeat one" };
  refs.repeatButton.dataset.repeatMode = state.repeatMode;
  refs.repeatButton.classList.toggle("is-selected", state.repeatMode !== "off");
  refs.repeatButton.setAttribute("aria-pressed", state.repeatMode === "off" ? "false" : "true");
  refs.repeatButton.title = repeatTitles[state.repeatMode];
  refs.repeatButton.setAttribute("aria-label", repeatTitles[state.repeatMode]);
  refs.libraryDatabasePath.value = state.databaseLocation?.configuredPath || "";
  refs.libraryDatabaseLocationStatus.textContent = state.databaseLocationStatus || "SPCBoy reads this schema-23 catalog. MediaScanner owns scan paths, scanning, link checks, and cleanup.";
  refs.libraryDatabaseReloadButton.disabled = Boolean(state.databaseLocation?.requiresRestart);
  refs.libraryClearCacheButton.disabled = false;
  refs.databaseCacheSummary.textContent = state.archiveCacheSummary ? formatArchiveCacheSummary(state.archiveCacheSummary) : "—";
  refs.equalizerEnabledCheckbox.checked = state.equalizerEnabled;
  refs.equalizerToolbarButton.classList.toggle("is-selected", state.equalizerEnabled);
  refs.equalizerToolbarButton.setAttribute("aria-pressed", state.equalizerEnabled ? "true" : "false");
  refs.equalizerToolbarButton.title = state.equalizerEnabled ? "Disable Equalizer" : "Enable Equalizer";
  refs.equalizerToolbarButton.setAttribute("aria-label", refs.equalizerToolbarButton.title);
  refs.appVolumeInput.value = String(state.appVolume);
  refs.appVolumeValue.textContent = `${Math.round(state.appVolume * 100)}%`;
  refs.equalizerBandInputs.forEach((input, index) => {
    input.value = String(state.equalizerBandGains[index] || 0);
    refs.equalizerBandValues[index].textContent = `${(state.equalizerBandGains[index] || 0) >= 0 ? "+" : ""}${(state.equalizerBandGains[index] || 0).toFixed(1)} dB`;
  });
  syncAnimatedRanges();
  renderSidebar();
  renderPlaylistHeader();
  renderPlaylist();
  uiApp.playback.updateTimingSummary();
  uiApp.playback.updatePlaybackReadout();
  uiApp.playback.updateNativeDiagnostics();
}

function selectedTrackIndex() {
  return state.playlist.findIndex((track) => track.id === state.selectedTrackId);
}

function scrollSelectedTrackIntoView() {
  if (!state.selectedTrackId) {
    return;
  }

  const row = refs.playlistBody.querySelector(`[data-track-id="${CSS.escape(state.selectedTrackId)}"]`);
  row?.scrollIntoView({ block: "nearest" });
}

function moveSelection(delta) {
  if (state.playlist.length === 0) {
    return;
  }

  const currentIndex = selectedTrackIndex();
  const nextIndex = currentIndex >= 0
    ? Math.max(0, Math.min(state.playlist.length - 1, currentIndex + delta))
    : (delta >= 0 ? 0 : state.playlist.length - 1);

  // Keep DOM focus and the visual selection together. Without this, Enter
  // can be routed through an old sidebar/focused row after arrow navigation.
  selectPlaylistTrack(state.playlist[nextIndex].id, { focus: true });
  uiApp.playback.updateTimingSummary();
  scrollSelectedTrackIntoView();
  uiApp.playback.preloadTrackAudio(uiApp.selectedTrack());
}

function playSelectedTrack() {
  const active = uiApp.selectedTrack() ?? uiApp.currentTrack();
  if (!active) {
    return;
  }

  uiApp.playback.playTrack(active.id, 0).catch((error) => {
    console.error(error);
  });
}

async function hydratePlaylistMetadata() {
  const metadataToken = ++state.metadataToken;
  const rawTrackIds = state.playlist
    .filter((track) => !track.metadataLoaded && !track.archivePath)
    .map((track) => track.id);
  const archiveTracks = state.playlist.filter((track) => !track.metadataLoaded && track.archivePath && track.archiveEntry);
  let nextIndex = 0;
  const worker = async () => {
    while (metadataToken === state.metadataToken && nextIndex < rawTrackIds.length) {
      const trackId = rawTrackIds[nextIndex];
      nextIndex += 1;
      await hydrateTrackMetadata(trackId);
    }
  };
  const hydrateRaw = Promise.all(Array.from({ length: Math.min(4, rawTrackIds.length) }, worker));
  const hydrateArchives = window.spcBoy?.hydrateArchiveMetadata && archiveTracks.length
    ? window.spcBoy.hydrateArchiveMetadata(archiveTracks.map((track) => ({
      id: track.id,
      path: track.path,
      archivePath: track.archivePath,
      archiveEntry: track.archiveEntry,
      sourceFilename: track.sourceFilename,
      trackIndex: track.trackIndex,
      fileSize: track.fileSize,
      modifiedAt: track.modifiedAt,
      sourceSignature: track.sourceSignature,
      scanVersion: track.scanVersion
    }))).then((updates) => {
      if (metadataToken !== state.metadataToken) return;
      for (const update of updates || []) {
        const target = state.playlist.find((track) => track.id === update.id);
        if (!target) continue;
        applyTrackInspection(target, update.inspection);
      }
    }).catch(() => {})
    : Promise.resolve();
  await Promise.all([hydrateRaw, hydrateArchives]);
}

function applyTrackInspection(target, inspection) {
  target.title = inspection.metadata.song || target.title;
  target.game = inspection.metadata.game || target.game;
  target.artist = inspection.metadata.author || target.artist;
  target.system = inspection.metadata.system || target.system;
  target.lengthLabel = inspection.lengthLabel;
  target.basePlaybackSeconds = inspection.basePlaybackSeconds;
  target.metadataLoaded = true;
  scheduleMetadataRefresh(target.id);
  return target;
}

async function hydrateTrackMetadata(trackId, inspectionPath = null, sourceName = null) {
  const track = state.playlist.find((entry) => entry.id === trackId);
  if (!track || track.metadataLoaded) return track;

  try {
    const hydrateLoose = window.spcBoy.hydrateLooseMetadata
      ? (payload) => window.spcBoy.hydrateLooseMetadata(payload)
      : (payload) => window.spcBoy.inspectTrack(payload.inspectionPath, payload.sourceFilename);
    const inspection = await hydrateLoose({
      path: track.path,
      trackIndex: track.trackIndex,
      sourceFilename: sourceName || track.sourceFilename || track.filename,
      inspectionPath: inspectionPath || track.path,
      fileSize: track.fileSize,
      modifiedAt: track.modifiedAt,
      sourceSignature: track.sourceSignature,
      scanVersion: track.scanVersion
    });
    const target = state.playlist.find((entry) => entry.id === trackId);
    if (!target) return null;
    return applyTrackInspection(target, inspection);
  } catch {
    return track;
  }
}

function setPlayTime(nextSeconds) {
  state.manualPlayTimeSeconds = uiApp.normalizePlayTime(nextSeconds);
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({ manualPlayTimeSeconds: state.manualPlayTimeSeconds });
  uiApp.playback.refreshPlaybackForTimingChange().catch((error) => {
    console.error(error);
  });
}

function setSpcForceManualTime(nextEnabled) {
  state.longPlayEnabled = Boolean(nextEnabled);
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({ longPlayEnabled: state.longPlayEnabled });
  uiApp.playback.refreshPlaybackForTimingChange().catch((error) => {
    console.error(error);
  });
}

function cycleRepeatMode() {
  const modes = ["off", "all", "one"];
  state.repeatMode = modes[(modes.indexOf(state.repeatMode) + 1) % modes.length];
  persistSettings();
  renderAll();
}

function setSpcFadeTime(nextSeconds) {
  state.spcFadeSeconds = uiApp.normalizeFadeTime(nextSeconds);
  persistSettings();
  uiApp.playback.refreshPlaybackForTimingChange().catch((error) => {
    console.error(error);
  });
}

function setSpcFadeEnabled(nextEnabled) {
  state.fadeEnabled = Boolean(nextEnabled);
  persistSettings();
  uiApp.playback.refreshPlaybackForTimingChange().catch((error) => {
    console.error(error);
  });
}

function setQueuedSkipsEnabled(nextEnabled) {
  state.queuedSkipsEnabled = Boolean(nextEnabled);
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({ queuedSkipsEnabled: state.queuedSkipsEnabled });
  renderAll();
}

async function applyArchiveCacheSettings() {
  const settings = {
    enabled: state.archiveCacheEnabled,
    limitBytes: state.archiveCacheLimitBytes
  };
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({
    archiveCacheEnabled: settings.enabled,
    archiveCacheLimitBytes: settings.limitBytes
  });
  const configured = await window.spcBoy?.configureArchiveCache?.(settings);
  if (configured?.summary) {
    state.archiveCacheSummary = { ...configured.summary, enabled: configured.enabled, limitBytes: configured.limitBytes };
  }
  renderAll();
}

function setArchiveCacheEnabled(enabled) {
  state.archiveCacheEnabled = Boolean(enabled);
  applyArchiveCacheSettings().catch((error) => {
    console.error("[SPCBoy] archive cache setting update failed", error);
  });
  renderAll();
}

function setArchiveCacheLimit(value) {
  state.archiveCacheLimitBytes = uiApp.normalizeArchiveCacheLimit(value);
  applyArchiveCacheSettings().catch((error) => {
    console.error("[SPCBoy] archive cache limit update failed", error);
  });
  renderAll();
}

function audioSettingsPayload() {
  return {
    equalizerEnabled: state.equalizerEnabled,
    equalizerBandGains: [...state.equalizerBandGains],
    appVolume: state.appVolume
  };
}

function broadcastAudioSettings() {
  const settings = audioSettingsPayload();
  window.spcBoy?.setPlaybackSettings?.(settings);
  window.spcBoy?.nativePlaybackAudioConfig?.(state.appVolume, state.equalizerEnabled, state.equalizerBandGains).catch?.(() => {});
  uiApp.playback.setAudioSettings?.(settings);
}

function setEqualizerEnabled(enabled) {
  state.equalizerEnabled = Boolean(enabled);
  persistSettings();
  broadcastAudioSettings();
  renderAll();
}

function setEqualizerBandGain(index, gain) {
  if (!state.equalizerBandGains[index]) state.equalizerBandGains[index] = 0;
  state.equalizerBandGains[index] = uiApp.normalizeEqualizerGain(gain);
  persistSettings();
  broadcastAudioSettings();
  renderAll();
}

function resetEqualizer() {
  state.equalizerBandGains = state.equalizerBandGains.map(() => 0);
  persistSettings();
  broadcastAudioSettings();
  renderAll();
}

function setAppVolume(volume) {
  state.appVolume = uiApp.normalizeAppVolume(volume);
  persistSettings();
  broadcastAudioSettings();
  renderAll();
}

function adjustAppVolume(delta) {
  setAppVolume(state.appVolume + Number(delta || 0));
}

function commitSpcLengthInput(rawValue) {
  const parsedSeconds = uiApp.parseDurationSeconds(rawValue);
  state.manualPlayTimeSeconds = uiApp.normalizePlayTime(parsedSeconds ?? state.manualPlayTimeSeconds);
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({ manualPlayTimeSeconds: state.manualPlayTimeSeconds });
  uiApp.playback.refreshPlaybackForTimingChange().catch((error) => {
    console.error(error);
  });
}

function commitSpcFadeInput(rawValue) {
  const parsedSeconds = uiApp.parseDurationSeconds(rawValue);
  state.spcFadeSeconds = uiApp.normalizeFadeTime(parsedSeconds ?? state.spcFadeSeconds);
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({ spcFadeSeconds: state.spcFadeSeconds });
  uiApp.playback.refreshPlaybackForTimingChange().catch((error) => {
    console.error(error);
  });
}

function commitPlaybackSpeedInput(backendId, rawValue) {
  const speedKey = backendId === "libvgm" ? "libvgmPlaybackSpeed" : "playbackSpeed";
  const enabledKey = backendId === "libvgm" ? "libvgmPlaybackSpeedEnabled" : "playbackSpeedEnabled";
  const input = backendId === "libvgm" ? refs.libvgmPlaybackSpeedInput : refs.playbackSpeedInput;
  const parsedSpeed = uiApp.parsePlaybackSpeed(rawValue);
  if (!parsedSpeed) {
    input.value = uiApp.formatPlaybackSpeed(state[speedKey]);
    return;
  }
  if (parsedSpeed.numerator === state[speedKey].numerator && parsedSpeed.denominator === state[speedKey].denominator) {
    input.value = uiApp.formatPlaybackSpeed(parsedSpeed);
    return;
  }
  state[speedKey] = parsedSpeed;
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({ [speedKey]: state[speedKey] });
  if (state[enabledKey]) uiApp.playback.refreshPlaybackForSpeedChange(backendId).catch((error) => console.error(error));
  renderAll();
}

function setPlaybackSpeedEnabled(backendId, enabled) {
  const enabledKey = backendId === "libvgm" ? "libvgmPlaybackSpeedEnabled" : "playbackSpeedEnabled";
  state[enabledKey] = Boolean(enabled);
  persistSettings();
  window.spcBoy?.setPlaybackSettings?.({ [enabledKey]: state[enabledKey] });
  uiApp.playback.refreshPlaybackForSpeedChange(backendId).catch((error) => console.error(error));
  renderAll();
}

function setUiItemSpacing(nextSpacingRem) {
  state.uiItemSpacingRem = uiApp.normalizeItemSpacing(nextSpacingRem);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setFontSize(nextSize) {
  state.uiFontSizePt = uiApp.normalizeFontSize(nextSize);
  persistSettings();
  renderAll();
}

function setSidebarWidth(nextWidth) {
  state.sidebarWidthPercent = uiApp.normalizeSidebarWidth(nextWidth);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function commitFontSizeInput(rawValue) {
  const parsedValue = uiApp.parseNumericInput(rawValue);
  state.uiFontSizePt = uiApp.normalizeFontSize(parsedValue ?? state.uiFontSizePt);
  persistSettings();
  renderAll();
}

function commitSidebarFontSizeInput(rawValue) {
  const parsedValue = uiApp.parseNumericInput(rawValue);
  state.sidebarFontSizePt = uiApp.normalizeFontSize(parsedValue ?? state.sidebarFontSizePt);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setSidebarTextColor(color) {
  state.sidebarTextColor = uiApp.normalizeFontColor(color);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setSidebarMonospace(enabled) {
  state.sidebarMonospace = Boolean(enabled);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setSidebarPathCounts(enabled) {
  state.sidebarPathCounts = Boolean(enabled);
  persistSettings();
  broadcastAppearanceSettings();
  renderedDatabaseGames = null;
  renderSidebar();
}

function commitPlaylistFontSizeInput(rawValue) {
  const parsedValue = uiApp.parseNumericInput(rawValue);
  state.playlistFontSizePt = uiApp.normalizeFontSize(parsedValue ?? state.playlistFontSizePt);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setPlaylistTextColor(color) {
  state.playlistTextColor = uiApp.normalizeFontColor(color);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setPlaylistMonospace(enabled) {
  state.playlistMonospace = Boolean(enabled);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setApplicationMonospace(enabled) {
  state.applicationMonospace = Boolean(enabled);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setPlaylistHeaderBold(enabled) {
  state.playlistHeaderBold = Boolean(enabled);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setColumnAutoSize(enabled) {
  state.columnAutoSize = Boolean(enabled);
  persistSettings();
  renderPlaylist();
}

function applyAppearanceSettings(settings) {
  if (settings.uiItemSpacingRem !== undefined) state.uiItemSpacingRem = uiApp.normalizeItemSpacing(settings.uiItemSpacingRem);
  if (settings.sidebarWidthPercent !== undefined) state.sidebarWidthPercent = uiApp.normalizeSidebarWidth(settings.sidebarWidthPercent);
  if (settings.sidebarFontSizePt !== undefined) state.sidebarFontSizePt = uiApp.normalizeFontSize(settings.sidebarFontSizePt);
  if (settings.sidebarTextColor !== undefined) state.sidebarTextColor = uiApp.normalizeFontColor(settings.sidebarTextColor);
  if (settings.sidebarMonospace !== undefined) state.sidebarMonospace = Boolean(settings.sidebarMonospace);
  if (settings.sidebarPathCounts !== undefined) state.sidebarPathCounts = Boolean(settings.sidebarPathCounts);
  if (settings.playlistFontSizePt !== undefined) state.playlistFontSizePt = uiApp.normalizeFontSize(settings.playlistFontSizePt);
  if (settings.playlistTextColor !== undefined) state.playlistTextColor = uiApp.normalizeFontColor(settings.playlistTextColor);
  if (settings.playlistMonospace !== undefined) state.playlistMonospace = Boolean(settings.playlistMonospace);
  if (settings.applicationMonospace !== undefined) state.applicationMonospace = Boolean(settings.applicationMonospace);
  if (settings.playlistHeaderBold !== undefined) state.playlistHeaderBold = Boolean(settings.playlistHeaderBold);
  if (settings.accentColor !== undefined) state.accentColor = uiApp.normalizeAccentColor(settings.accentColor);
  persistSettings();
  renderAll();
}

function setAccentColor(color) {
  state.accentColor = uiApp.normalizeAccentColor(color);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function commitSidebarWidthInput(rawValue) {
  const parsedValue = uiApp.parseNumericInput(rawValue);
  state.sidebarWidthPercent = uiApp.normalizeSidebarWidth(parsedValue ?? state.sidebarWidthPercent);
  persistSettings();
  broadcastAppearanceSettings();
  renderAll();
}

function setOptionsOpen(nextOpen) {
  if (nextOpen && !window.spcBoy?.isOptionsWindow) {
    window.spcBoy.openOptionsWindow().catch((error) => console.error("[SPCBoy] open options failed", error));
    return;
  }
  if (!nextOpen && window.spcBoy?.isOptionsWindow) {
    window.spcBoy.closeOptionsWindow();
    return;
  }
  state.optionsOpen = nextOpen;
  if (nextOpen) {
    state.optionsSection = "database";
    uiApp.ui.refreshDatabaseLocation().catch((error) => console.error("[SPCBoy] database location refresh failed", error));
    uiApp.ui.refreshArchiveCacheSummary().catch((error) => console.error("[SPCBoy] archive cache refresh failed", error));
  }
  renderAll();
}

async function bootstrap() {
  if (window.spcBoy?.isOptionsWindow) {
    document.body.classList.add("options-window");
    state.optionsOpen = true;
  } else {
    refs.optionsOverlay.remove();
  }
  if (!window.spcBoy?.bootstrap || !window.spcBoy?.refreshTree) {
    const message = "Renderer bridge missing. File loading is unavailable.";
    showStartupFailure(message);
    throw new Error(message);
  }

  loadSettings();
  collapsedDatabaseConsoles = new Set(state.collapsedConsoleNames);
  state.databaseLocation = await window.spcBoy?.databaseLocation?.() || null;
  state.databaseLocationStatus = state.databaseLocation?.requiresRestart
    ? "Restart SPCBoy to use the selected database."
    : "The shared MediaScanner catalog is active and opened read-only.";
  if (window.spcBoy?.isOptionsWindow) renderAll();
  await window.spcBoy?.configureArchiveCache?.({
    enabled: state.archiveCacheEnabled,
    limitBytes: state.archiveCacheLimitBytes
  });
  await uiApp.ui.refreshArchiveCacheSummary();
  if (window.spcBoy?.setRoutingPreferences) {
    state.routingPreferences = { ...(await window.spcBoy.setRoutingPreferences(state.routingPreferences)) };
    persistSettings();
  }
  let snapshot;
  if (window.spcBoy?.isOptionsWindow) {
    // Options owns settings/library controls, not the raw browser. Do not
    // enumerate the persisted JoshW root just to paint this window.
    snapshot = {
      rootPath: state.rootPath,
      tree: [],
      selectedFolderPath: state.selectedFolderPath,
      selectedBrowserPath: state.selectedBrowserPath,
      playlist: []
    };
  } else if (state.rootPath) {
    try {
      snapshot = await window.spcBoy.refreshTree(state.rootPath, state.selectedFolderPath);
    } catch {
      snapshot = await window.spcBoy.bootstrap();
    }
  } else {
    snapshot = await window.spcBoy.bootstrap();
  }

  Object.assign(state, snapshot);
  await uiApp.playback.stopPlaybackState();
  state.selectedTrackId = resolveSelectedTrackId(snapshot.playlist);
  state.lastSelectedTrackId = state.selectedTrackId;
  state.totalSeconds = targetPlaybackSeconds();
  persistSettings();
  if (!window.spcBoy?.isOptionsWindow && window.spcBoy?.databaseRoots) {
    state.libraryRoots = await window.spcBoy.databaseRoots();
    await uiApp.ui.handleLibraryRootsChanged(state.libraryRoots);
  }
  renderAll();
  if (state.sidebarMode === "consoles") {
    const selectedGame = state.databaseGames.find((game) => databaseGameKey(game) === state.selectedDatabaseGameKey);
    if (selectedGame) {
      await loadDatabaseGame(selectedGame);
    }
  }
  syncTreeSelection();
  scrollSelectedTrackIntoView();
  uiApp.playback.preloadPlaylistAudio(state.playlist, state.selectedTrackId);
  void hydratePlaylistMetadata();
}

async function openLibraryRoot() {
  const snapshot = await window.spcBoy.chooseRootFolder();
  if (!snapshot) {
    return;
  }

  applyLibrarySnapshot(snapshot);
}

function applyLibrarySnapshot(snapshot) {
  playlistLoadGeneration += 1;
  Object.assign(state, snapshot);
  state.sidebarMode = "diskPath";
  state.sidebarQuery = "";
  state.selectedDatabaseGameKey = null;
  refs.sidebarSearchInput.value = "";
  state.selectedTrackId = resolveSelectedTrackId(snapshot.playlist);
  state.lastSelectedTrackId = state.selectedTrackId;
  state.totalSeconds = targetPlaybackSeconds();
  persistSettings();
  renderAll();
  syncTreeSelection();
  scrollSelectedTrackIntoView();
  uiApp.playback.preloadPlaylistAudio(state.playlist, state.selectedTrackId);
  void hydratePlaylistMetadata();
}

function applyFolderSelection(selection) {
  const preserveBrowserFocus = document.activeElement?.classList.contains("tree-node");
  playlistLoadGeneration += 1;
  state.selectedFolderPath = selection.selectedFolderPath;
  state.playlist = selection.playlist;
  state.selectedTrackId = resolveSelectedTrackId(selection.playlist);
  state.lastSelectedTrackId = state.selectedTrackId;
  if (!state.currentTrackId) {
    state.totalSeconds = targetPlaybackSeconds();
  }
  persistSettings();
  renderTree();
  syncTreeSelection();
  if (preserveBrowserFocus && state.selectedBrowserPath) {
    refs.treeRoot.querySelector(`[data-browser-path="${CSS.escape(state.selectedBrowserPath)}"]`)?.focus();
  }
  renderPlaylist();
  uiApp.playback.updateTimingSummary();
  uiApp.playback.updatePlaybackReadout();
  scrollSelectedTrackIntoView();
  uiApp.playback.preloadPlaylistAudio(state.playlist, state.selectedTrackId);
  void hydratePlaylistMetadata();
}

uiApp.ui = {
  resolveSelectedTrackId,
  renderTree,
  syncTreeSelection,
  renderPlaylist,
  refreshPlaylistPlaybackState,
  renderAll,
  moveSelection,
  moveBrowserSelection,
  jumpFocusedListToEdge,
  playSelectedTrack,
  hydratePlaylistMetadata,
  hydrateTrackMetadata,
  setPlayTime,
  setSpcForceManualTime,
  cycleRepeatMode,
  setSpcFadeTime,
  setSpcFadeEnabled,
  setQueuedSkipsEnabled,
  setArchiveCacheEnabled,
  setArchiveCacheLimit,
  setEqualizerEnabled,
  setEqualizerBandGain,
  resetEqualizer,
  setAppVolume,
  adjustAppVolume,
  commitSpcLengthInput,
  commitSpcFadeInput,
  commitPlaybackSpeedInput,
  setPlaybackSpeedEnabled,
  setUiItemSpacing,
  setFontSize,
  setSidebarWidth,
  setAccentColor,
  commitFontSizeInput,
  commitSidebarFontSizeInput,
  setSidebarTextColor,
  setSidebarMonospace,
  setSidebarPathCounts,
  commitPlaylistFontSizeInput,
  setPlaylistTextColor,
  setPlaylistMonospace,
  setApplicationMonospace,
  setPlaylistHeaderBold,
  setColumnAutoSize,
  applyAppearanceSettings,
  applyRoutingPreferences,
  commitSidebarWidthInput,
  setOptionsOpen,
  setAllDatabaseConsolesCollapsed,
  setAllSidebarNodesCollapsed,
  refreshDatabaseGamesForVisibleRoots,
  loadDatabaseFiles,
  setSidebarMode,
  updateSidebarSearch,
  loadDatabaseGames,
  loadDatabaseGame,
  activateDatabaseSelection,
  activateFocusedItem,
  renderSidebar,
  syncAnimatedRanges,
  bootstrap,
  openLibraryRoot,
  applyLibrarySnapshot,
  applyFolderSelection
};
})();
