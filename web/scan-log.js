(() => {
  const api = window.spcBoy;
  const summary = document.getElementById("scan-log-summary");
  const body = document.getElementById("scan-log-body");
  const copyButton = document.getElementById("scan-log-copy");
  let logText = "";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(logText);
      return true;
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(body);
      selection.removeAllRanges();
      selection.addRange(range);
      const copied = document.execCommand("copy");
      selection.removeAllRanges();
      return copied;
    }
  }

  function render(root) {
    root = root || {};
    logText = root.last_scan_log || "No errored files recorded.";
    const completedAt = root.last_scan_completed_at
      ? new Date(root.last_scan_completed_at * 1000).toLocaleString()
      : "Not scanned";
    document.title = `Scan Log — ${root.path || "Library"}`;
    summary.innerHTML = `<strong>${escapeHtml(root.path || "Unknown library folder")}</strong><span class="scan-log-summary-items"><span>${Number(root.last_scan_file_count) || 0} files</span><span>${Number(root.last_scan_success_count) || 0} successful</span><span>${Number(root.last_scan_error_count) || 0} errors</span><span>${Number(root.last_scan_track_count) || 0} tracks</span><time>${escapeHtml(completedAt)}</time></span>`;
    body.textContent = logText;
  }

  copyButton.addEventListener("click", async () => {
    const copied = await copyLog();
    copyButton.textContent = copied ? "Copied" : "Copy failed";
    window.setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = "Copy"; }, 1200);
  });
  api.onScanLogData(render);
})();
