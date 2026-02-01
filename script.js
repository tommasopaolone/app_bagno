/** =========================
 * Registro Bagno - Client (multi-docente, class code)
 * Backend: Google Apps Script Web App
 * ========================= */

const API_URL = "https://script.google.com/macros/s/AKfycbwcwRECOuFHvvPfWzWwpBX281unTZcZhJeJtd5qdBFmju1D699KtEGtdLmD8IPkskJvhw/exec";

const LS = {
  teacher: "rb_teacher_name_v1",
  device: "rb_device_id_v1",
  classCode: "rb_class_code_v1",
  className: "rb_class_name_v1",
  roster: "rb_roster_v1",
  events: "rb_events_cache_v1",
  lastSync: "rb_last_sync_ts_v1",
};

function uid() { return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 0,0,0,0); }
function startOfWeekMonday(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  return x;
}
function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString("it-IT", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function loadStr(key, fallback = "") {
  const v = localStorage.getItem(key);
  return (v === null || v === undefined) ? fallback : String(v);
}
function saveStr(key, val) { localStorage.setItem(key, String(val)); }

const el = {
  btnSettings: document.getElementById("btnSettings"),
  btnCloseModal: document.getElementById("btnCloseModal"),
  modal: document.getElementById("modal"),

  classTitle: document.getElementById("classTitle"),
  classCodeBadge: document.getElementById("classCodeBadge"),

  search: document.getElementById("search"),
  students: document.getElementById("students"),

  kpiToday: document.getElementById("kpiToday"),
  kpiWeek: document.getElementById("kpiWeek"),
  kpiMonth: document.getElementById("kpiMonth"),

  panelWeek: document.getElementById("panelWeek"),
  panelMonth: document.getElementById("panelMonth"),
  panelLog: document.getElementById("panelLog"),
  tabs: Array.from(document.querySelectorAll(".tab")),

  status: document.getElementById("status"),

  btnUndo: document.getElementById("btnUndo"),
  btnExportEvents: document.getElementById("btnExportEvents"),

  teacherName: document.getElementById("teacherName"),
  classCodeInput: document.getElementById("classCodeInput"),
  btnJoinClass: document.getElementById("btnJoinClass"),

  newClassName: document.getElementById("newClassName"),
  btnCreateClass: document.getElementById("btnCreateClass"),

  btnMake25: document.getElementById("btnMake25"),
  btnClearRoster: document.getElementById("btnClearRoster"),
  csvFile: document.getElementById("csvFile"),
  btnImportCsv: document.getElementById("btnImportCsv"),
  namesArea: document.getElementById("namesArea"),
  btnSaveRoster: document.getElementById("btnSaveRoster"),
  btnExportRoster: document.getElementById("btnExportRoster"),
};

function setStatus(msg) {
  el.status.textContent = msg;
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => el.status.textContent = "Pronto.", 2500);
}

let teacher = loadStr(LS.teacher, "");
let deviceId = loadStr(LS.device, "");
if (!deviceId) { deviceId = uid(); saveStr(LS.device, deviceId); }

let classCode = loadStr(LS.classCode, "");
let className = loadStr(LS.className, "");

let roster = load(LS.roster, []);
let eventsCache = load(LS.events, []);
let lastSyncTs = Number(loadStr(LS.lastSync, "0")) || 0;

function api(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + Math.random().toString(16).slice(2);
    const url = new URL(API_URL);

    url.searchParams.set("action", action);
    url.searchParams.set("callback", cbName);
    url.searchParams.set("payload", JSON.stringify({ action, ...payload }));

    const script = document.createElement("script");
    script.src = url.toString();

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout API"));
    }, 12000);

    function cleanup() {
      clearTimeout(timeout);
      try { delete window[cbName]; } catch {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (data) => {
      cleanup();
      if (!data || data.ok !== true) {
        reject(new Error((data && data.error) ? data.error : "API error"));
        return;
      }
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Errore caricamento API (script.onerror)"));
    };

    document.head.appendChild(script);
  });
}


function parseCsvToNames(csvText) {
  const text = String(csvText || "").replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();
  if (!text) return [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const sep = (lines[0].includes(";") && !lines[0].includes(",")) ? ";" : ",";
  const firstCells = lines[0].split(sep).map(s => s.trim().replace(/^"|"$/g,""));
  const lower = firstCells.map(s => s.toLowerCase());
  let colIndex = 0;
  const idxNome = lower.indexOf("nome");
  const idxName = lower.indexOf("name");
  if (idxNome >= 0) colIndex = idxNome;
  else if (idxName >= 0) colIndex = idxName;
  const hasHeader = idxNome >= 0 || idxName >= 0;
  const start = hasHeader ? 1 : 0;

  const names = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(sep).map(s => s.trim().replace(/^"|"$/g,""));
    const v = cells[colIndex] ?? cells[0] ?? "";
    const n = String(v).trim();
    if (n) names.push(n);
  }
  return names;
}

function toCSV(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes(";")) {
      return `"${s.replace(/"/g,'""')}"`;
    }
    return s;
  };
  return rows.map(r => r.map(esc).join(",")).join("\n");
}
function downloadText(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function setActiveTab(tabName) {
  for (const t of el.tabs) t.classList.toggle("active", t.dataset.tab === tabName);
  el.panelWeek.classList.toggle("hidden", tabName !== "week");
  el.panelMonth.classList.toggle("hidden", tabName !== "month");
  el.panelLog.classList.toggle("hidden", tabName !== "log");
}

function renderHeader() {
  el.classTitle.textContent = className ? `Classe: ${className}` : "Classe: —";
  el.classCodeBadge.textContent = classCode ? `CODICE: ${classCode}` : "CODICE: —";
}

function countsForRange(fromTs, toTs) {
  const per = Array.from({ length: roster.length }, () => 0);
  let total = 0;
  for (const e of eventsCache) {
    if (e.ts >= fromTs && e.ts < toTs) {
      total++;
      if (e.studentIndex >= 0 && e.studentIndex < per.length) per[e.studentIndex]++;
    }
  }
  return { total, per };
}

function renderKPIs() {
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const tomorrowStart = todayStart + 86400000;
  const weekStart = startOfWeekMonday(now).getTime();
  const weekEnd = weekStart + 7 * 86400000;
  const monthStart = startOfMonth(now).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  el.kpiToday.textContent = String(countsForRange(todayStart, tomorrowStart).total);
  el.kpiWeek.textContent  = String(countsForRange(weekStart, weekEnd).total);
  el.kpiMonth.textContent = String(countsForRange(monthStart, monthEnd).total);
}

function renderStudents() {
  el.students.innerHTML = "";
  const now = new Date();

  const todayStart = startOfDay(now).getTime();
  const tomorrowStart = todayStart + 86400000;
  const weekStart = startOfWeekMonday(now).getTime();
  const weekEnd = weekStart + 7 * 86400000;
  const monthStart = startOfMonth(now).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  const today = countsForRange(todayStart, tomorrowStart).per;
  const week  = countsForRange(weekStart, weekEnd).per;
  const month = countsForRange(monthStart, monthEnd).per;

  const q = (el.search.value || "").trim().toLowerCase();
  const list = roster
    .map((name, i) => ({ name: String(name || "").trim() || `Alunno ${i+1}`, i }))
    .filter(x => q ? x.name.toLowerCase().includes(q) : true);

  for (const s of list) {
    const div = document.createElement("div");
    div.className = "student";
    div.tabIndex = 0;

    const left = document.createElement("div");
    left.className = "name";
    left.textContent = s.name;

    const right = document.createElement("div");
    right.className = "count";
    right.textContent = `Oggi: ${today[s.i]||0} • Sett: ${week[s.i]||0} • Mese: ${month[s.i]||0}`;

    div.appendChild(left);
    div.appendChild(right);

    div.addEventListener("click", () => addExit(s.i));
    div.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") addExit(s.i); });

    el.students.appendChild(div);
  }

  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = "Nessun alunno trovato.";
    el.students.appendChild(p);
  }
}

function renderTable(panelEl, titleText, fromTs, toTs) {
  const { per } = countsForRange(fromTs, toTs);
  const rows = roster
    .map((name, idx) => ({ name: String(name || "").trim() || `Alunno ${idx+1}`, count: per[idx] || 0 }))
    .sort((a,b) => b.count - a.count || a.name.localeCompare(b.name,"it"));

  panelEl.innerHTML = `
    <div class="small">${escapeHtml(titleText)}</div>
    <table class="table">
      <thead><tr><th>Alunno</th><th>Uscite</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${r.count}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderLog(panelEl) {
  const last = [...eventsCache].sort((a,b) => b.ts - a.ts).slice(0, 30);
  if (last.length === 0) {
    panelEl.innerHTML = `<p class="small">Nessuna uscita registrata.</p>`;
    return;
  }
  panelEl.innerHTML = `
    <div class="small">Ultime 30 uscite</div>
    <table class="table">
      <thead><tr><th>Data/Ora</th><th>Alunno</th><th>Docente</th></tr></thead>
      <tbody>
        ${last.map(e => `
          <tr>
            <td>${formatDateTime(e.ts)}</td>
            <td>${escapeHtml(roster[e.studentIndex] ?? `Alunno ${e.studentIndex+1}`)}</td>
            <td class="small">${escapeHtml(e.teacher || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderReports() {
  const now = new Date();
  const weekStartD = startOfWeekMonday(now);
  const weekStart = weekStartD.getTime();
  const weekEnd = weekStart + 7 * 86400000;

  const monthStartD = startOfMonth(now);
  const monthStart = monthStartD.getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  const weekTitle = `Settimana: ${weekStartD.toLocaleDateString("it-IT")} – ${new Date(weekEnd-1).toLocaleDateString("it-IT")}`;
  const monthTitle = `Mese: ${monthStartD.toLocaleDateString("it-IT", { month:"long", year:"numeric" })}`;

  renderTable(el.panelWeek, weekTitle, weekStart, weekEnd);
  renderTable(el.panelMonth, monthTitle, monthStart, monthEnd);
  renderLog(el.panelLog);
}

function renderAll() {
  renderHeader();
  renderKPIs();
  renderStudents();
  renderReports();
}

async function syncFromServer() {
  if (!classCode) return;

  const join = await api("joinClass", { classCode });
  className = join.className || className;
  roster = Array.isArray(join.roster) ? join.roster : roster;

  const ev = await api("getEvents", { classCode, sinceTs: lastSyncTs || 0 });
  const newEvents = ev.events || [];

  if (newEvents.length > 0) {
    const key = (x) => `${x.ts}|${x.studentIndex}|${x.teacher}|${x.deviceId}`;
    const map = new Map(eventsCache.map(x => [key(x), x]));
    for (const x of newEvents) map.set(key(x), x);
    eventsCache = Array.from(map.values()).sort((a,b) => a.ts - b.ts);
    lastSyncTs = Math.max(lastSyncTs, ...newEvents.map(x => x.ts));
  } else {
    lastSyncTs = Math.max(lastSyncTs, Date.now() - 1000);
  }

  saveStr(LS.classCode, classCode);
  saveStr(LS.className, className);
  save(LS.roster, roster);
  save(LS.events, eventsCache);
  saveStr(LS.lastSync, String(lastSyncTs));

  renderAll();
}

async function createClass() {
  teacher = (el.teacherName.value || "").trim();
  saveStr(LS.teacher, teacher);

  const name = (el.newClassName.value || "").trim();
  if (!name) { setStatus("Inserisci il nome classe (es. 2A)."); return; }

  setStatus("Creo classe su Google…");
  const out = await api("createClass", { className: name, teacher });

  classCode = out.classCode;
  className = out.className;
  el.classCodeInput.value = classCode;

  lastSyncTs = 0;
  eventsCache = [];
  saveStr(LS.lastSync, "0");
  await syncFromServer();

  el.namesArea.value = roster.join("\n");
  setStatus(`Classe creata. Codice: ${classCode}`);
}

async function joinClass() {
  teacher = (el.teacherName.value || "").trim();
  saveStr(LS.teacher, teacher);

  const code = (el.classCodeInput.value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if (!code) { setStatus("Inserisci un codice classe."); return; }

  classCode = code;
  lastSyncTs = 0;
  eventsCache = [];
  saveStr(LS.lastSync, "0");

  setStatus("Collego la classe…");
  await syncFromServer();

  el.namesArea.value = roster.join("\n");
  setStatus("Classe collegata.");
}

async function saveRosterToServer() {
  if (!classCode) { setStatus("Prima entra in una classe con codice."); return; }

  const lines = (el.namesArea.value || "")
    .replace(/\r\n/g,"\n").replace(/\r/g,"\n")
    .split("\n").map(s => s.trim()).filter(Boolean);

  if (lines.length === 0) { setStatus("Nessun nome inserito."); return; }

  teacher = (el.teacherName.value || "").trim();
  saveStr(LS.teacher, teacher);

  setStatus("Salvo elenco su Google…");
  await api("setRoster", { classCode, roster: lines, teacher });

  lastSyncTs = 0;
  eventsCache = [];
  saveStr(LS.lastSync, "0");
  await syncFromServer();

  setStatus("Elenco salvato e sincronizzato.");
}

async function importCsv() {
  if (!classCode) { setStatus("Prima entra in una classe con codice."); return; }

  const file = el.csvFile.files && el.csvFile.files[0];
  if (!file) { setStatus("Seleziona un CSV."); return; }

  const text = await file.text();
  const names = parseCsvToNames(text);
  if (names.length === 0) { setStatus("CSV vuoto o non valido."); return; }

  el.namesArea.value = names.join("\n");
  setStatus("CSV caricato. Ora premi 'Salva elenco su Google'.");
}

function make25() {
  el.namesArea.value = Array.from({length:25}, (_,i) => `Alunno ${i+1}`).join("\n");
  setStatus("Creati 25 placeholder (non ancora salvati su Google).");
}
function clearRoster() { el.namesArea.value = ""; setStatus("Textarea svuotata (non ancora salvato su Google)."); }

async function addExit(studentIndex) {
  if (!classCode) { setStatus("Prima entra in una classe con codice."); return; }

  teacher = (el.teacherName.value || "").trim();
  saveStr(LS.teacher, teacher);

  const ts = Date.now();
  await api("addEvent", { classCode, studentIndex, ts, teacher, deviceId });

  eventsCache.push({ ts, studentIndex, teacher, deviceId });
  eventsCache.sort((a,b) => a.ts - b.ts);
  lastSyncTs = Math.max(lastSyncTs, ts);
  save(LS.events, eventsCache);
  saveStr(LS.lastSync, String(lastSyncTs));

  setStatus(`Registrata uscita: ${roster[studentIndex] ?? `Alunno ${studentIndex+1}`} (${formatDateTime(ts)})`);
  renderAll();
}

async function undoMine() {
  if (!classCode) { setStatus("Prima entra in una classe con codice."); return; }

  teacher = (el.teacherName.value || "").trim();
  saveStr(LS.teacher, teacher);

  setStatus("Annullamento…");
  const out = await api("undoLastByTeacher", { classCode, teacher });

  if (!out.deleted) { setStatus("Niente da annullare (per il tuo nome docente)."); return; }

  lastSyncTs = 0;
  eventsCache = [];
  saveStr(LS.lastSync, "0");
  await syncFromServer();

  setStatus("Annullato l’ultimo evento registrato da te.");
}

function exportEventsCsv() {
  if (!classCode) { setStatus("Prima entra in una classe con codice."); return; }

  const rows = [["timestamp","data_ora","classCode","className","studentIndex","studentName","teacher"]];
  for (const e of [...eventsCache].sort((a,b) => a.ts - b.ts)) {
    rows.push([
      e.ts,
      formatDateTime(e.ts),
      classCode,
      className,
      e.studentIndex,
      roster[e.studentIndex] ?? `Alunno ${e.studentIndex+1}`,
      e.teacher || ""
    ]);
  }
  downloadText(`uscite_${className||classCode}_${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows), "text/csv;charset=utf-8");
  setStatus("Uscite esportate.");
}

function exportRosterCsv() {
  if (!classCode) { setStatus("Prima entra in una classe con codice."); return; }
  const rows = [["nome"], ...roster.map(n => [n])];
  downloadText(`elenco_${className||classCode}.csv`, toCSV(rows), "text/csv;charset=utf-8");
  setStatus("Elenco esportato.");
}

function openModal() {
  el.teacherName.value = teacher;
  el.classCodeInput.value = classCode;
  el.namesArea.value = roster.join("\n");
  el.modal.classList.remove("hidden");
}
function closeModal() { el.modal.classList.add("hidden"); }

function msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0,0,0,0);
  return next.getTime() - now.getTime();
}
function scheduleMidnightRefresh() {
  if (scheduleMidnightRefresh._t) clearTimeout(scheduleMidnightRefresh._t);
  scheduleMidnightRefresh._t = setTimeout(() => {
    renderAll();
    setStatus("Nuovo giorno: conteggi 'Oggi' azzerati.");
    scheduleMidnightRefresh();
  }, msUntilNextMidnight() + 50);
}

el.btnSettings.addEventListener("click", openModal);
el.btnCloseModal.addEventListener("click", closeModal);
el.modal.addEventListener("click", (e) => { if (e.target === el.modal) closeModal(); });

el.btnCreateClass.addEventListener("click", () => createClass().catch(err => setStatus(String(err.message || err))));
el.btnJoinClass.addEventListener("click", () => joinClass().catch(err => setStatus(String(err.message || err))));

el.btnSaveRoster.addEventListener("click", () => saveRosterToServer().catch(err => setStatus(String(err.message || err))));
el.btnImportCsv.addEventListener("click", () => importCsv().catch(err => setStatus(String(err.message || err))));
el.btnMake25.addEventListener("click", make25);
el.btnClearRoster.addEventListener("click", clearRoster);

el.btnUndo.addEventListener("click", () => undoMine().catch(err => setStatus(String(err.message || err))));
el.btnExportEvents.addEventListener("click", exportEventsCsv);
el.btnExportRoster.addEventListener("click", exportRosterCsv);

el.search.addEventListener("input", renderStudents);
el.tabs.forEach(t => t.addEventListener("click", () => setActiveTab(t.dataset.tab)));

setActiveTab("week");

(async function init() {
  renderHeader();

  if (teacher) el.teacherName.value = teacher;

  if (classCode) {
    try {
      setStatus("Sincronizzo…");
      await syncFromServer();
      el.namesArea.value = roster.join("\n");
      setStatus("Sincronizzato.");
    } catch (err) {
      setStatus("Sync fallito: controlla API_URL o permessi Web App.");
      renderAll();
    }
  } else {
    renderAll();
    setStatus("Apri Impostazioni → Entra con codice o Crea classe.");
  }

  scheduleMidnightRefresh();
  setInterval(async () => { if (classCode) { try { await syncFromServer(); } catch(_) {} } }, 30000);
})();
