const { normalizeArchiveEntry } = require("./archive-path");

function sourceKey(source) {
  return `${source.archivePath || source.path}\u0000${normalizeArchiveEntry(source.archiveEntry)}`;
}

function indexIndexedTracks(rows) {
  const indexed = new Map();
  for (const row of rows) {
    const key = sourceKey({
      path: row.path,
      archivePath: row.archivePath,
      archiveEntry: row.archiveEntry
    });
    const group = indexed.get(key) || [];
    group.push(row);
    indexed.set(key, group);
  }
  return indexed;
}

function reusableRecordsForSource(source, stat, rows, scanVersion, backendId = null, metadataRequired = true) {
  if (!rows?.length || rows.some((row) => Number(row.scanVersion) !== Number(scanVersion))) return null;
  if (rows.some((row) => !row.scanCompleted)) return null;
  if (rows.some((row) => (row.backendId || null) !== backendId)) return null;
  if (metadataRequired && rows.some((row) => !row.metadataTrackId)) return null;
  const statMatches = rows.every((row) => Number(row.fileSize) === Number(stat.size)
    && Math.abs(Number(row.modifiedAt) - Number(stat.mtimeMs / 1000)) <= 0.001);
  const contentMatches = Boolean(source.sourceSignature)
    && rows.every((row) => row.sourceSignature === source.sourceSignature);
  if (!statMatches && !contentMatches) return null;
  if (source.archiveEntry && rows.some((row) => row.archiveSignature !== source.archiveSignature)) return null;
  if (rows.some((row) => row.sourceSignature !== source.sourceSignature)) return null;

  const expectedTrackCount = Number(rows[0].trackCount) || 1;
  if (rows.length !== expectedTrackCount) return null;
  const orderedRows = [...rows].sort((left, right) => Number(left.trackIndex) - Number(right.trackIndex));
  if (orderedRows.some((row, index) => Number(row.trackIndex) !== index)) return null;

  return orderedRows.map((row) => ({
    folderPath: row.folderPath,
    path: row.path,
    filename: row.filename,
    extension: row.extension,
    backendId: row.backendId || null,
    trackIndex: Number(row.trackIndex),
    trackCount: Number(row.trackCount) || 1,
    fileSize: Number(stat.size) || 0,
    modifiedAt: Number(stat.mtimeMs / 1000) || 0,
    scanCompleted: Boolean(row.scanCompleted),
    specialAudioKind: row.specialAudioKind || null,
    archivePath: row.archivePath || null,
    archiveEntry: normalizeArchiveEntry(row.archiveEntry) || null,
    archiveSignature: row.archiveSignature || null,
    sourceSignature: row.sourceSignature || null,
    scanVersion: Number(row.scanVersion) || 0,
    metadata: row.metadataTrackId ? {
      title: row.title || "",
      game: row.game || "",
      artist: row.artist || "",
      system: row.system || "",
      playLengthMs: Number(row.playLengthMs) || 0
    } : null
  }));
}

function reusableRecordsForArchive(rows, archivePath, stat, sourceSignature, scanVersion, backendIdForEntry = () => null, metadataRequiredForEntry = () => true) {
  if (!rows?.length || rows.some((row) => row.archivePath !== archivePath)) return null;
  const rowsByEntry = new Map();
  for (const row of rows) {
    const entry = normalizeArchiveEntry(row.archiveEntry);
    if (!entry) continue;
    const entryRows = rowsByEntry.get(entry) || [];
    entryRows.push(row);
    rowsByEntry.set(entry, entryRows);
  }
  const entries = [...rowsByEntry.keys()].sort();
  if (!entries.length) return null;
  const reusable = [];
  for (const archiveEntry of entries) {
    const entryRows = rowsByEntry.get(archiveEntry);
    const archiveSignature = entryRows[0]?.archiveSignature || null;
    const records = reusableRecordsForSource({
      path: archivePath,
      archivePath,
      archiveEntry,
      archiveSignature,
      sourceSignature
    }, stat, entryRows, scanVersion, backendIdForEntry(archiveEntry), metadataRequiredForEntry(archiveEntry));
    if (!records) return null;
    reusable.push(...records);
  }
  return reusable.length === rows.length ? reusable : null;
}

module.exports = { indexIndexedTracks, reusableRecordsForSource, reusableRecordsForArchive, sourceKey, normalizeArchiveEntry };
