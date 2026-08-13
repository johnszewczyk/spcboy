(() => {
  const api = window.spcBoy;
  const roots = document.getElementById("roots"), status = document.getElementById("status"), cancel = document.getElementById("cancel");
  let active = false;
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  async function render() { const list = await api.databaseRoots(); roots.innerHTML = list.sort((a,b)=>a.path.localeCompare(b.path)).map(r => `<div class="library-root-row"><div class="library-root-main"><span>${esc(r.path)}</span></div><div class="library-root-meta">${r.last_scan_completed_at ? `<span>${r.last_scan_success_count||0} OK · ${r.last_scan_error_count||0} errors · ${r.last_scan_track_count||0} tracks</span><time>${esc(new Date(r.last_scan_completed_at*1000).toLocaleString())}</time>` : "Not scanned"}</div></div>`).join("") || '<div class="empty">No library folders configured.</div>'; }
  async function run(label, work) { active=true; cancel.disabled=false; status.textContent=label; try { await work(); await render(); status.textContent=`${label} complete.`; } catch(e) { status.textContent=e.message === "Library operation cancelled" ? `${label} cancelled.` : `${label} failed · ${e.message}`; } finally { active=false; cancel.disabled=true; } }
  document.getElementById("add").onclick = async () => { const result=await api.chooseLibraryPath(); if(result) await render(); };
  document.getElementById("scan").onclick = () => run("Scan", () => api.scanAllDatabaseRoots());
  document.getElementById("trim").onclick = () => run("Trim Missing", () => api.trimMissingDatabaseSources());
  cancel.onclick = () => api.cancelLibraryOperation();
  api.onLibraryScanProgress(p => { const n=String(p.path||"").split(/[\\/]/).pop(); const phases={preparing:"Preparing",discovery:"Discovering",planning:"Planning",archiveListing:"Listing archives",materialization:"Extracting archive",inspection:"Inspecting metadata",persistence:"Saving scan",publication:"Publishing scan",cleanup:"Cleaning up scan"}; const label=p.operation === "trim" ? "Checking" : phases[p.phase] || (p.operation === "stream" && p.stage === "archiveListing" ? "Listing archive" : "Scanning"); status.textContent=`${label} ${p.total ? `${p.completed}/${p.total} · ` : ""}${n}`; });
  render().catch(e => { status.textContent=e.message; });
})();
