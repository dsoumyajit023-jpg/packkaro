// ------------------------------------------------------------
// PackKaro – Step 1: Dynamic Source Boxes
// ------------------------------------------------------------

// 1) Starter suggestions. These are ONLY hints. Users can type anything.
//    Later we can load this list from a server and add the names
//    people type most often.
const SUGGESTIONS = [
  "Meesho", "Flipkart", "Amazon", "Myntra", "Ajio", "Nykaa",
  "JioMart", "Snapdeal", "Shopsy", "Instagram Shop", "WhatsApp Orders",
  "Own Website", "Shopify Store", "Offline / Walk-in"
];

const listEl = document.getElementById("source-list");
const datalistEl = document.getElementById("source-suggestions");
const statusEl = document.getElementById("status");

// 2) Put the suggestions into the <datalist>.
//    The browser shows them automatically as the user types.
for (const name of SUGGESTIONS) {
  const opt = document.createElement("option");
  opt.value = name;
  datalistEl.appendChild(opt);
}

// 3) Create one new empty box (a "row").
function addRow(value = "") {
  const row = document.createElement("div");
  row.className = "source-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a source / preference…";
  input.setAttribute("list", "source-suggestions"); // links to the suggestions
  input.maxLength = 40;
  input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "×";
  removeBtn.title = "Remove this box";
  removeBtn.addEventListener("click", () => {
    row.remove();
    ensureOneEmptyBoxAtEnd();
  });

  // Every time the user types or picks a suggestion, check the boxes.
  input.addEventListener("input", () => {
    input.classList.toggle("filled", input.value.trim() !== "");
    ensureOneEmptyBoxAtEnd();
  });

  row.append(input, removeBtn);
  listEl.appendChild(row);
  input.classList.toggle("filled", value.trim() !== "");
  return input;
}

// 4) The "auto-open next box" rule:
//    If the LAST box has text, add a new empty box after it.
function ensureOneEmptyBoxAtEnd() {
  const inputs = listEl.querySelectorAll("input");
  if (inputs.length === 0) { addRow(); return; }
  const last = inputs[inputs.length - 1];
  if (last.value.trim() !== "") addRow();
}

// 5) Read all filled boxes -> clean list (no blanks, no duplicates).
function getSources() {
  const seen = new Set();
  const result = [];
  for (const input of listEl.querySelectorAll("input")) {
    const name = input.value.trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
  }
  return result;
}

// 6) Save in the browser (localStorage) so it is remembered next visit.
//    Free, private to this device, no server needed.
const STORAGE_KEY = "packkaro.sources";

document.getElementById("save-btn").addEventListener("click", () => {
  const sources = getSources();
  if (sources.length === 0) {
    statusEl.textContent = "Please add at least one source.";
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
  } catch (e) {
    statusEl.textContent = "Could not save on this browser.";
    return;
  }
  statusEl.textContent = "Saved: " + sources.join(", ");
});

document.getElementById("clear-btn").addEventListener("click", () => {
  listEl.innerHTML = "";
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  statusEl.textContent = "";
  addRow();
});

// 7) On page load: restore saved sources (if any) + one empty box.
function init() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch (e) { saved = []; }
  for (const name of saved) addRow(name);
  ensureOneEmptyBoxAtEnd();
}
init();

// 8) Backend test: call our small server function at /api/hello.
document.getElementById("ping-btn").addEventListener("click", async () => {
  const out = document.getElementById("ping-result");
  out.textContent = "Calling server…";
  try {
    const res = await fetch("/api/hello");
    out.textContent = JSON.stringify(await res.json(), null, 2);
  } catch (e) {
    out.textContent = "No server found. This is normal if you opened the file directly on your computer.";
  }
});

// ------------------------------------------------------------
// Step 2: Upload PDFs, find the platform on every page
// ------------------------------------------------------------

// Words that tell us which platform a label belongs to.
// These are STARTER guesses. We will tune them with your real sample labels.
const PLATFORM_KEYWORDS = {
  "Meesho": ["meesho"],
  "Flipkart": ["flipkart"],
  "Amazon": ["amazon"],
  "Myntra": ["myntra"],
  "Ajio": ["ajio"],
  "Nykaa": ["nykaa"],
  "JioMart": ["jiomart"],
  "Snapdeal": ["snapdeal"],
  "Shopsy": ["shopsy"]
};

const CHUNK_SIZE = 10; // pages handled before we give the browser a short rest

const fileInput = document.getElementById("file-input");
const scanBtn = document.getElementById("scan-btn");
const progressWrap = document.getElementById("progress-wrap");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const resultsEl = document.getElementById("results");

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// Look at the text of one page and decide the platform.
// Returns { platform } if sure, or { review: "reason" } if NOT sure.
function detectPlatform(text) {
  const t = text.toLowerCase();
  if (t.replace(/\s/g, "").length < 20) {
    return { review: "Page has almost no readable text (blank, faded or scanned)" };
  }
  // Built-in names + the sources the user typed in Step 1.
  const names = new Map(); // lowercase keyword -> display name
  for (const [name, words] of Object.entries(PLATFORM_KEYWORDS)) {
    for (const w of words) names.set(w, name);
  }
  for (const s of getSources()) {
    if (s.length >= 3) names.set(s.toLowerCase(), s);
  }
  const found = new Set();
  for (const [word, name] of names) {
    if (t.includes(word)) found.add(name);
  }
  if (found.size === 1) return { platform: [...found][0] };
  if (found.size > 1) return { review: "Matches more than one platform: " + [...found].join(", ") };
  return { review: "Could not recognise the platform" };
}

function pause() { return new Promise(r => setTimeout(r, 0)); }

function formatTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return sec >= 60 ? Math.floor(sec / 60) + " min " + (sec % 60) + " s" : sec + " s";
}

async function scanFiles() {
  resultsEl.textContent = "";
  if (!window.pdfjsLib) {
    resultsEl.textContent = "The PDF reader could not load. Check your internet and refresh.";
    return;
  }
  const files = [...fileInput.files];
  if (files.length === 0) { resultsEl.textContent = "Please choose at least one PDF first."; return; }

  scanBtn.disabled = true;
  progressWrap.hidden = false;
  progressBar.value = 0;
  progressText.textContent = "Opening files…";

  const counts = {};        // platform -> number of pages
  const reviewList = [];    // pages that need a human look
  const docs = [];
  let totalPages = 0;

  // Open every file first so we know the total number of pages.
  for (const file of files) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      docs.push({ file, pdf });
      totalPages += pdf.numPages;
    } catch (e) {
      reviewList.push({ file: file.name, page: "-", reason: "File could not be opened (damaged or password protected)" });
    }
  }

  const started = Date.now();
  let done = 0;

  for (const { file, pdf } of docs) {
    for (let p = 1; p <= pdf.numPages; p++) {
      try {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map(i => i.str).join(" ");
        const result = detectPlatform(text);
        if (result.platform) counts[result.platform] = (counts[result.platform] || 0) + 1;
        else reviewList.push({ file: file.name, page: p, reason: result.review });
        page.cleanup();
      } catch (e) {
        reviewList.push({ file: file.name, page: p, reason: "Page could not be read" });
      }
      done++;
      if (done % CHUNK_SIZE === 0 || done === totalPages) {
        const secsPerPage = (Date.now() - started) / 1000 / done;
        progressBar.value = (done / totalPages) * 100;
        progressText.textContent =
          "Page " + done + " of " + totalPages + " – about " + formatTime(secsPerPage * (totalPages - done)) + " left";
        await pause(); // lets the browser breathe so it never freezes
      }
    }
  }

  progressBar.value = 100;
  progressText.textContent = "Done. " + totalPages + " page(s) checked.";
  scanBtn.disabled = false;
  showResults(counts, reviewList);
}

function showResults(counts, reviewList) {
  resultsEl.textContent = "";

  const names = Object.keys(counts);
  if (names.length > 0) {
    const table = document.createElement("table");
    table.className = "counts";
    const head = table.insertRow();
    for (const h of ["Platform", "Labels"]) {
      const th = document.createElement("th"); th.textContent = h; head.appendChild(th);
    }
    for (const n of names.sort((a, b) => counts[b] - counts[a])) {
      const row = table.insertRow();
      row.insertCell().textContent = n;
      row.insertCell().textContent = counts[n];
    }
    resultsEl.appendChild(table);
  }

  if (reviewList.length > 0) {
    const box = document.createElement("div");
    box.className = "review";
    const h3 = document.createElement("h3");
    h3.textContent = "Manual Check needed (" + reviewList.length + ")";
    const ul = document.createElement("ul");
    for (const r of reviewList) {
      const li = document.createElement("li");
      li.textContent = r.file + ", page " + r.page + ": " + r.reason;
      ul.appendChild(li);
    }
    box.append(h3, ul);
    resultsEl.appendChild(box);
  } else if (names.length > 0) {
    const ok = document.createElement("p");
    ok.className = "ok-note";
    ok.textContent = "All pages recognised. Nothing needs a manual check.";
    resultsEl.appendChild(ok);
  }
}

scanBtn.addEventListener("click", scanFiles);
