const KEYWORD_TEMPLATES = [
  "{industry} industries",
  "{industry} manufacturer",
  "{industry} company",
  "{industry} plant",
  "{industry} factory",
];

const el = (id) => document.getElementById(id);

const apiKeyInput = el("apiKey");
const cityInput = el("city");
const maxPagesSelect = el("maxPages");
const areasTextarea = el("areas");
const industryInput = el("industry");
const genKeywordsBtn = el("genKeywords");
const keywordsTextarea = el("keywords");
const excludeTextarea = el("exclude");
const runBtn = el("runBtn");
const runHint = el("runHint");
const queueCount = el("queueCount");
const matrixWrap = el("matrixWrap");
const matrixEl = el("matrix");
const logWrap = el("logWrap");
const logEl = el("log");
const resultsPanel = el("panel-results");
const resultsBody = el("resultsBody");
const resultsNote = el("resultsNote");
const downloadBtn = el("downloadBtn");

const signedInEl = el("signedIn");
const saveStatusEl = el("saveStatus");
const loadHistoryBtn = el("loadHistoryBtn");
const downloadHistoryBtn = el("downloadHistoryBtn");
const historyStatusEl = el("historyStatus");
const historyTableWrap = el("historyTableWrap");
const historyBody = el("historyBody");

let lastCsv = "";
let lastCity = "";
let currentUsername = null;
let lastHistoryCsv = "";

async function loadWhoami() {
  try {
    const resp = await fetch("/api/whoami");
    const data = await resp.json();
    currentUsername = data.username || null;
    signedInEl.textContent = currentUsername
      ? `Signed in as ${currentUsername}`
      : "Not signed in";
  } catch {
    signedInEl.textContent = "Couldn't verify sign-in";
  }
}
loadWhoami();

function linesOf(textarea) {
  return textarea.value.split("\n").map((s) => s.trim()).filter(Boolean);
}

function updateQueueCount() {
  const areas = linesOf(areasTextarea);
  const keywords = linesOf(keywordsTextarea);
  queueCount.textContent = `${areas.length} areas × ${keywords.length} keywords = ${areas.length * keywords.length} searches`;
  return { areas, keywords };
}

function updateRunEnabled() {
  const { areas, keywords } = updateQueueCount();
  const ready = apiKeyInput.value.trim() && cityInput.value.trim() && areas.length && keywords.length;
  runBtn.disabled = !ready;
  runHint.textContent = ready
    ? "Ready. This runs one request per cell in the matrix below."
    : "Enter your API key, city, at least one area, and at least one keyword.";
}

[apiKeyInput, cityInput, areasTextarea, keywordsTextarea].forEach((elm) =>
  elm.addEventListener("input", updateRunEnabled)
);

genKeywordsBtn.addEventListener("click", () => {
  const industries = industryInput.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!industries.length) return;
  const seen = new Set();
  const out = [];
  for (const industry of industries) {
    for (const template of KEYWORD_TEMPLATES) {
      const kw = template.replace("{industry}", industry);
      if (!seen.has(kw)) {
        seen.add(kw);
        out.push(kw);
      }
    }
  }
  keywordsTextarea.value = out.join("\n");
  updateRunEnabled();
});

function looksLikeShop(name, types, excludeKeywords) {
  const nameLower = name.toLowerCase();
  if (excludeKeywords.some((kw) => kw && nameLower.includes(kw.toLowerCase()))) return true;
  if (types.includes("store") || types.includes("pharmacy")) return true;
  return false;
}

function log(msg) {
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
}

function buildMatrix(areas, keywords) {
  matrixEl.innerHTML = "";
  matrixEl.style.gridTemplateColumns = `repeat(${keywords.length}, minmax(18px, 1fr))`;
  matrixEl.style.gridTemplateRows = `repeat(${areas.length}, minmax(18px, 1fr))`;
  const cells = [];
  for (let r = 0; r < areas.length; r++) {
    const row = [];
    for (let c = 0; c < keywords.length; c++) {
      const cell = document.createElement("div");
      cell.className = "mx-cell";
      cell.title = `${areas[r]} — ${keywords[c]}`;
      matrixEl.appendChild(cell);
      row.push(cell);
    }
    cells.push(row);
  }
  return cells;
}

async function searchOne(apiKey, city, area, keyword, maxPages) {
  const resp = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, city, area, keyword, maxPages }),
  });
  return resp.json();
}

async function runSearch() {
  const apiKey = apiKeyInput.value.trim();
  const city = cityInput.value.trim();
  const areas = linesOf(areasTextarea);
  const keywords = linesOf(keywordsTextarea);
  const excludeKeywords = linesOf(excludeTextarea);
  const maxPages = parseInt(maxPagesSelect.value, 10);

  runBtn.disabled = true;
  matrixWrap.classList.remove("hidden");
  logWrap.classList.remove("hidden");
  resultsPanel.classList.add("hidden");
  logEl.innerHTML = "";
  const cells = buildMatrix(areas, keywords);

  const allResults = new Map();
  let done = 0;
  const total = areas.length * keywords.length;

  for (let r = 0; r < areas.length; r++) {
    for (let c = 0; c < keywords.length; c++) {
      const cell = cells[r][c];
      cell.classList.add("active");
      const area = areas[r];
      const keyword = keywords[c];

      let payload;
      try {
        payload = await searchOne(apiKey, city, area, keyword, maxPages);
      } catch (e) {
        payload = { error: String(e), results: [] };
      }

      cell.classList.remove("active");
      if (payload.error) {
        cell.classList.add("error-cell");
        log(`✕ ${keyword} · ${area} — ${payload.error}`);
      } else {
        let added = 0;
        for (const p of payload.results || []) {
          if (!allResults.has(p.id)) {
            allResults.set(p.id, p);
            added++;
          }
        }
        cell.classList.add(added > 0 || (payload.results || []).length > 0 ? "hit" : "empty-cell");
        log(`${keyword} · ${area} — +${added} new (${allResults.size} unique so far)`);
      }

      done++;
      runHint.textContent = `Running… ${done}/${total} searches complete.`;
      await new Promise((res) => setTimeout(res, 120));
    }
  }

  const kept = Array.from(allResults.values())
    .filter((p) => !looksLikeShop(p.name, p.types || [], excludeKeywords))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
  const uniqueKept = Array.from(new Set(kept));
  const dropped = allResults.size - uniqueKept.length;

  const industry = industryInput.value.trim();
  showResults(uniqueKept, dropped, city, industry);
  runHint.textContent = `Done. ${uniqueKept.length} companies kept, ${dropped} auto-dropped as shop/pharmacy-looking.`;
  runBtn.disabled = false;

  await saveToDirectory(uniqueKept, city, industry);
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function showResults(names, dropped, city, industry) {
  resultsPanel.classList.remove("hidden");
  resultsNote.textContent = `${names.length} kept · ${dropped} auto-dropped`;
  resultsBody.innerHTML = "";
  names.forEach((name, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td></td>`;
    tr.children[1].textContent = name;
    resultsBody.appendChild(tr);
  });

  const who = currentUsername || "unknown";
  const csvRows = [
    "company_name,extracted_by,city,industry",
    ...names.map((n) => [csvCell(n), csvCell(who), csvCell(city), csvCell(industry)].join(",")),
  ];
  lastCsv = csvRows.join("\n");
  lastCity = city;
  saveStatusEl.textContent = "";
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveToDirectory(names, city, industry) {
  if (!names.length) return;
  saveStatusEl.textContent = "Saving to shared directory…";
  try {
    const resp = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, industry, companies: names }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    saveStatusEl.textContent = `Saved ${data.saved} companies as ${data.username}.`;
  } catch (e) {
    saveStatusEl.textContent = `Couldn't save to shared directory: ${e.message}`;
  }
}

async function loadHistory() {
  historyStatusEl.textContent = "Loading…";
  loadHistoryBtn.disabled = true;
  try {
    const resp = await fetch("/api/history");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    renderHistory(data.entries || []);
    historyStatusEl.textContent = `${data.entries.length} saved entries.`;
  } catch (e) {
    historyStatusEl.textContent = `Couldn't load history: ${e.message}`;
  } finally {
    loadHistoryBtn.disabled = false;
  }
}

function renderHistory(entries) {
  historyTableWrap.classList.toggle("hidden", entries.length === 0);
  downloadHistoryBtn.classList.toggle("hidden", entries.length === 0);
  historyBody.innerHTML = "";
  entries.forEach((e, i) => {
    const tr = document.createElement("tr");
    const cells = [i + 1, e.company_name, e.extracted_by, e.city, e.industry, e.extracted_at];
    cells.forEach((val) => {
      const td = document.createElement("td");
      td.textContent = val ?? "";
      tr.appendChild(td);
    });
    historyBody.appendChild(tr);
  });

  const rows = [
    "company_name,extracted_by,city,industry,extracted_at",
    ...entries.map((e) =>
      [e.company_name, e.extracted_by, e.city, e.industry, e.extracted_at].map(csvCell).join(",")
    ),
  ];
  lastHistoryCsv = rows.join("\n");
}

loadHistoryBtn.addEventListener("click", loadHistory);

downloadHistoryBtn.addEventListener("click", () => {
  if (!lastHistoryCsv) return;
  const blob = new Blob([lastHistoryCsv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "directory_history.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

downloadBtn.addEventListener("click", () => {
  if (!lastCsv) return;
  const blob = new Blob([lastCsv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeCity = (lastCity || "companies").toLowerCase().replace(/\s+/g, "_");
  a.href = url;
  a.download = `${safeCity}_companies.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

runBtn.addEventListener("click", runSearch);

updateRunEnabled();
