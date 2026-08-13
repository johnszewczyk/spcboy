function playlistSourceIdentity(sourcePath, archiveEntry = null) {
  const pathText = String(sourcePath || "");
  if (archiveEntry !== null && archiveEntry !== undefined) {
    const entryText = String(archiveEntry);
    return `ps1|a|${pathText.length}|${pathText}|${entryText.length}|${entryText}`;
  }
  return `ps1|f|${pathText.length}|${pathText}`;
}

function playlistTrackIdentity(sourcePath, archiveEntry = null, trackIndex = 0) {
  const pathText = String(sourcePath || "");
  const index = Math.max(0, Number(trackIndex) || 0);
  if (archiveEntry !== null && archiveEntry !== undefined) {
    const entryText = String(archiveEntry);
    return `pt1|a|${pathText.length}|${pathText}|${entryText.length}|${entryText}|${index}`;
  }
  return `pt1|f|${pathText.length}|${pathText}|${index}`;
}

module.exports = { playlistSourceIdentity, playlistTrackIdentity };
