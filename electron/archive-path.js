function normalizeArchiveEntry(entry) {
  return String(entry || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
}

module.exports = { normalizeArchiveEntry };
