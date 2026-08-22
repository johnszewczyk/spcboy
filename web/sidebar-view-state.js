(() => {
  function resolve(storedMode, searchQuery) {
    const normalizedMode = ["paths", "consoles", "diskPath"].includes(storedMode)
      ? storedMode
      : "consoles";
    const query = String(searchQuery || "").trim();
    const isTemporary = query.length > 0;
    const view = isTemporary ? "search" : normalizedMode;
    const contentMode = view === "consoles" || view === "search" ? "database" : "tree";
    return Object.freeze({
      storedMode: normalizedMode,
      query,
      view,
      contentMode,
      resultSource: view === "paths"
        ? "catalog-path-index"
        : view === "diskPath"
          ? "disk-path-tree"
          : "catalog-console-index",
      isTemporary
    });
  }

  window.SPCBoySidebarViewState = Object.freeze({ resolve });
})();
