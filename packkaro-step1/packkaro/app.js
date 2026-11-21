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
