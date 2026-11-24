// ------------------------------------------------------------
// PackKaro
// ------------------------------------------------------------

// The "where do your orders come from" boxes were removed.
// Platforms are now found automatically from the label text (see PLATFORM_KEYWORDS below).
function getSources() { return []; }

// ------------------------------------------------------------
// Upload PDFs, read every page (platform, SKU, quantity)
// ------------------------------------------------------------

// Words that tell us which platform a label belongs to.
// These are STARTER guesses. We tune them with your real sample labels.
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

// How we find the item code and quantity in the label text.
// Also a starter guess. If a label does not match, it goes to Manual Check.
const SKU_REGEX = /(?:seller\s*sku|product\s*sku|sku|item\s*code)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9_\-\/\.]{1,39})/i;
const QTY_REGEX = /(?:qty|quantity)\s*[:\-]?\s*(\d{1,3})\b/i;

// Couriers we can spot on a label. This only fills the "Courier" count table.
const COURIERS = [
  ["Ekart", /\bekart\b|\be[\s\-]kart\b/i],
  ["Delhivery", /\bdelhivery\b/i],
  ["Shadowfax", /\bshadowfax\b/i],
  ["Xpressbees", /\bxpress\s*bees\b/i],
  ["Ecom Express", /\becom\s*express\b/i],
  ["DTDC", /\bdtdc\b/i],
  ["Blue Dart", /\bblue\s*dart\b/i],
  ["India Post", /\b(?:india|speed)\s*post\b/i],
  ["Amazon Transport", /\bamazon\s*transport\b|\batsl\b/i],
  ["Valmo", /\bvalmo\b/i],
  ["Gati", /\bgati\b/i],
  ["Shiprocket", /\bshiprocket\b/i]
];

// Thermal printer label size: 4 x 6 inch (the common shipping-label roll).
// 1 inch = 72 points.
const THERMAL_W = 4 * 72;  // 288
const THERMAL_H = 6 * 72;  // 432

const CHUNK_SIZE = 10; // pages handled before we give the browser a short rest

const fileInput = document.getElementById("file-input");
const scanBtn = document.getElementById("scan-btn");
const progressWrap = document.getElementById("progress-wrap");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const resultsEl = document.getElementById("results");
const cropBox = document.getElementById("crop-box");
const cropBoxText = document.getElementById("crop-box-text");
const cropBtn = document.getElementById("crop-btn");
const cropStatus = document.getElementById("crop-status");
const cropLoading = document.getElementById("crop-loading");
const cropLoadingText = document.getElementById("crop-loading-text");
const cropBar = document.getElementById("crop-bar");
const cropDone = document.getElementById("crop-done");

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// What the last scan found. The crop step uses this.
let scanState = null;

function detectPlatform(text) {
  const t = text.toLowerCase();
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

// Decide everything we can about one page. Never guess: unclear = reason.
function analysePage(text) {
  if (text.replace(/\s/g, "").length < 20) {
    return { reasons: ["Page has almost no readable text (blank, faded or scanned)"] };
  }
  const reasons = [];
  const det = detectPlatform(text);
  if (!det.platform) reasons.push(det.review);

  let sku = null;
  const skuMatch = text.match(SKU_REGEX);
  if (skuMatch) sku = skuMatch[1].replace(/[.\-\/]+$/, "");
  if (!sku) reasons.push("Item code (SKU) not found");

  let qty = null;
  const qtyMatch = text.match(QTY_REGEX);
  if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
  if (qty === null) reasons.push("Quantity not found");
  else if (qty < 1 || qty > 99) { reasons.push("Quantity looks wrong (" + qty + ")"); qty = null; }

  return { platform: det.platform || null, sku, qty, reasons, courier: detectCourier(text) };
}

function detectCourier(text) {
  const found = COURIERS.filter(([, rx]) => rx.test(text)).map(([name]) => name);
  if (found.length === 1) return found[0];
  return found.length > 1 ? "Unclear (more than one)" : "Not recognised";
}

function pause() { return new Promise(r => setTimeout(r, 0)); }

function formatTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return sec >= 60 ? Math.floor(sec / 60) + " min " + (sec % 60) + " s" : sec + " s";
}

async function scanFiles() {
  resultsEl.textContent = "";
  document.getElementById("make-results").textContent = "";
  scanState = null;
  document.getElementById("make-btn").disabled = true;
  cropBox.hidden = true;
  cropStatus.hidden = true;

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

  const counts = {};
  const courierCounts = {};
  const records = [];       // one per page: { docIdx, page, platform, sku, qty, reason }
  const fileProblems = [];  // whole files we could not open
  const docs = [];
  let totalPages = 0;

  for (const file of files) {
    try {
      const bytes = await file.arrayBuffer();
      // pdf.js takes ownership of the data it is given, so give it a copy.
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
      docs.push({ file, pdf, bytes });
      totalPages += pdf.numPages;
    } catch (e) {
      fileProblems.push({ file: file.name, page: "-", reason: "File could not be opened (damaged or password protected)" });
    }
  }

  const started = Date.now();
  let done = 0;

  for (let d = 0; d < docs.length; d++) {
    const { pdf } = docs[d];
    for (let p = 1; p <= pdf.numPages; p++) {
      let rec = { docIdx: d, page: p, platform: null, sku: null, qty: null, reason: "" };
      try {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map(i => i.str).join(" ");
        const r = analysePage(text);
        rec.platform = r.platform; rec.sku = r.sku; rec.qty = r.qty;
        rec.reason = r.reasons.join("; ");
        if (r.platform) counts[r.platform] = (counts[r.platform] || 0) + 1;
        if (r.courier) courierCounts[r.courier] = (courierCounts[r.courier] || 0) + 1;
        page.cleanup();
      } catch (e) {
        rec.reason = "Page could not be read";
      }
      records.push(rec);
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

  scanState = { docs, records };
  const review = fileProblems.concat(
    records.filter(r => r.reason).map(r => ({ file: docs[r.docIdx].file.name, page: r.page, reason: r.reason }))
  );
  showResults(counts, review, courierCounts);
  const goodCount = records.filter(r => !r.reason).length;
  if (goodCount > 0) {
    document.getElementById("make-btn").disabled = false;
    cropBoxText.textContent = goodCount + " label(s) ready to crop" +
      (review.length ? ". " + review.length + " need a manual check and are kept separate." : ".");
    cropBox.hidden = false;
  }
}

function countTable(firstHeader, counts) {
  const table = document.createElement("table");
  table.className = "counts";
  const head = table.insertRow();
  for (const h of [firstHeader, "Labels"]) {
    const th = document.createElement("th"); th.textContent = h; head.appendChild(th);
  }
  for (const n of Object.keys(counts).sort((x, y) => counts[y] - counts[x])) {
    const row = table.insertRow();
    row.insertCell().textContent = n;
    row.insertCell().textContent = counts[n];
  }
  return table;
}

function showResults(counts, reviewList, courierCounts) {
  resultsEl.textContent = "";

  const names = Object.keys(counts);
  if (names.length > 0) resultsEl.appendChild(countTable("Platform", counts));
  if (courierCounts && Object.keys(courierCounts).length > 0) {
    resultsEl.appendChild(countTable("Courier", courierCounts));
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

// ------------------------------------------------------------
// Crop, add shop details, sort, number, make a new PDF
// ------------------------------------------------------------

const shopNameEl = document.getElementById("shop-name");
const thanksEl = document.getElementById("thanks-msg");
const logoInput = document.getElementById("logo-input");
const logoClear = document.getElementById("logo-clear");
const logoPreview = document.getElementById("logo-preview");
const topPercentEl = document.getElementById("top-percent");
const makeBtn = document.getElementById("make-btn");
const makeWrap = document.getElementById("make-progress-wrap");
const makeBar = document.getElementById("make-bar");
const makeText = document.getElementById("make-text");
const makeResults = document.getElementById("make-results");

// ---- Remember shop details on this device ----
const SHOP_KEY = "packkaro.shop";
let logoDataUrl = "";

function saveShop() {
  try {
    localStorage.setItem(SHOP_KEY, JSON.stringify({
      name: shopNameEl.value, msg: thanksEl.value, logo: logoDataUrl
    }));
  } catch (e) { /* storage full or blocked: ignore */ }
}
function showLogo() {
  logoPreview.hidden = !logoDataUrl;
  logoClear.hidden = !logoDataUrl;
  if (logoDataUrl) logoPreview.src = logoDataUrl;
}
(function loadShop() {
  try {
    const s = JSON.parse(localStorage.getItem(SHOP_KEY) || "{}");
    shopNameEl.value = s.name || "";
    thanksEl.value = s.msg || "";
    logoDataUrl = s.logo || "";
  } catch (e) { /* ignore */ }
  showLogo();
})();
shopNameEl.addEventListener("input", saveShop);
thanksEl.addEventListener("input", saveShop);

// Shrink the logo so it stays small and quick.
logoInput.addEventListener("change", () => {
  const file = logoInput.files[0];
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const max = 240;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    logoDataUrl = c.toDataURL("image/png");
    URL.revokeObjectURL(url);
    showLogo(); saveShop();
  };
  img.onerror = () => { URL.revokeObjectURL(url); makeResults.textContent = "That logo file could not be read."; };
  img.src = url;
});
logoClear.addEventListener("click", () => { logoDataUrl = ""; logoInput.value = ""; showLogo(); saveShop(); });

// ---- Helpers ----

// The built-in PDF font only knows basic English letters and symbols.
function safeText(s) {
  return (s || "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "").replace(/\s+/g, " ").trim();
}

function fitText(font, text, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  while (text.length > 1 && font.widthOfTextAtSize(text + "...", size) > maxWidth) text = text.slice(0, -1);
  return text + "...";
}

function wrapText(font, text, size, maxWidth, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fitText(font, lines[maxLines - 1] + " ...", size, maxWidth);
  }
  return lines.map(l => fitText(font, l, size, maxWidth));
}

function dataUrlToBytes(url) {
  const bin = atob(url.split(",")[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Draw the page small, find where the ink is, return the crop box in PDF points.
async function measureBox(pdf, pageNo, topPct) {
  const page = await pdf.getPage(pageNo);
  try {
    if (page.rotate % 360 !== 0) return { reason: "Page is rotated, cannot crop safely" };
    const scale = 0.75;
    const vp = page.getViewport({ scale });
    const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const rows = Math.max(1, Math.ceil(h * topPct / 100));
    const px = ctx.getImageData(0, 0, w, rows).data;
    const colCount = new Uint32Array(w), rowCount = new Uint32Array(rows);
    let ink = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) { colCount[x]++; rowCount[y]++; ink++; }
      }
    }
    canvas.width = 0; canvas.height = 0;
    if (ink < 200) return { reason: "Label area looks empty or too faded" };

    // Ignore lone specks: a line must have at least 2 dark pixels.
    let minX = 0; while (minX < w && colCount[minX] < 2) minX++;
    let maxX = w - 1; while (maxX > minX && colCount[maxX] < 2) maxX--;
    let minY = 0; while (minY < rows && rowCount[minY] < 2) minY++;
    let maxY = rows - 1; while (maxY > minY && rowCount[maxY] < 2) maxY--;
    if (minX >= maxX || minY >= maxY) return { reason: "Could not find the label edges" };

    const v = page.view; // [left, bottom, right, top] in PDF points
    const pad = 6;
    const left = Math.max(v[0], v[0] + minX / scale - pad);
    const right = Math.min(v[2], v[0] + (maxX + 1) / scale + pad);
    const top = Math.min(v[3], v[3] - minY / scale + pad);
    const bottom = Math.max(v[1], v[3] - (maxY + 1) / scale - pad);
    if (right - left < 60 || top - bottom < 60) return { reason: "Cropped area is too small to be a label" };
    return { box: { left, bottom, right, top } };
  } finally {
    page.cleanup();
  }
}

function downloadLink(bytes, filename, text, extraClass) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  a.download = filename;
  a.className = "dl " + (extraClass || "");
  a.textContent = text;
  return a;
}

// ---- The main job ----
// Builds the label PDF (and the Manual Check PDF). report(percent, text) is called as it works.
async function buildLabels(report) {
  if (!scanState) throw new Error("Please scan your PDFs first.");
  if (!window.PDFLib) throw new Error("The PDF maker could not load. Check your internet and refresh.");

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const topPct = Math.min(100, Math.max(20, Number(topPercentEl.value) || 100));
  const shopName = safeText(shopNameEl.value);
  const thanks = safeText(thanksEl.value);

  const good = scanState.records.filter(r => !r.reason).map(r => ({ ...r }));
  const bad = scanState.records.filter(r => r.reason).map(r => ({ ...r }));
  const total = good.length * 2;
  let done = 0;
  const started = Date.now();
  report(0, "Starting…");
  const tick = async (label, i, n) => {
    done++;
    if (done % CHUNK_SIZE === 0 || done === total) {
      const per = (Date.now() - started) / 1000 / done;
      report((done / total) * 100,
        label + " " + i + " of " + n + " – about " + formatTime(per * (total - done)) + " left");
      await pause();
    }
  };

  // Part A: find the crop box of every good label.
  const sourceDocs = new Map(); // docIdx -> pdf-lib document (or null if it failed)
  for (const r of good) {
    if (!sourceDocs.has(r.docIdx)) {
      try { sourceDocs.set(r.docIdx, await PDFDocument.load(scanState.docs[r.docIdx].bytes)); }
      catch (e) { sourceDocs.set(r.docIdx, null); }
    }
  }
  let cropped = 0;
  for (const r of good) {
    if (!sourceDocs.get(r.docIdx)) { r.reason = "File could not be processed for cropping"; }
    else {
      try {
        const m = await measureBox(scanState.docs[r.docIdx].pdf, r.page, topPct);
        if (m.box) r.box = m.box; else r.reason = m.reason;
      } catch (e) { r.reason = "Could not measure this page"; }
    }
    cropped++;
    await tick("Cropping label", cropped, good.length);
  }
  const ready = good.filter(r => !r.reason);
  const moved = good.filter(r => r.reason);
  bad.push(...moved);

  // Part B: sort by item code, then by quantity, then keep original order.
  ready.sort((a, b) =>
    a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" }) ||
    a.qty - b.qty || a.docIdx - b.docIdx || a.page - b.page);

  // Part C: build the new PDF.
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (logoDataUrl) { try { logo = await out.embedPng(dataUrlToBytes(logoDataUrl)); } catch (e) { logo = null; } }

  // Bring each label in (a few at a time), grouped by source file.
  const embedded = new Map(); // record -> embedded page
  const byDoc = new Map();
  for (const r of ready) { if (!byDoc.has(r.docIdx)) byDoc.set(r.docIdx, []); byDoc.get(r.docIdx).push(r); }
  let built = 0;
  for (const [docIdx, list] of byDoc) {
    const src = sourceDocs.get(docIdx);
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE);
      const pages = chunk.map(r => src.getPage(r.page - 1));
      const emb = await out.embedPages(pages, chunk.map(r => r.box));
      chunk.forEach((r, k) => embedded.set(r, emb[k]));
      for (let k = 0; k < chunk.length; k++) { built++; await tick("Building label", built, ready.length); }
    }
  }
  report(100, "Finishing…");

  // One label per page, exactly the size of a 4 x 6 inch thermal label.
  const W = THERMAL_W, H = THERMAL_H, M = 8, headerH = 30;
  const hasFooter = !!(shopName || thanks || logo);
  const footerH = hasFooter ? 42 : 0;
  const N = ready.length;

  ready.forEach((r, n) => {
    const pg = out.addPage([W, H]);
    const emb = embedded.get(r);

    // Header strip: sequence number, item code, quantity badge.
    pg.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: rgb(0.94, 0.94, 0.94) });
    const seq = "#" + (n + 1) + "/" + N;
    pg.drawText(seq, { x: M, y: H - headerH + 10, size: 12, font: bold, color: rgb(0, 0, 0) });
    const seqW = bold.widthOfTextAtSize(seq, 12);

    let badgeLeft;
    if (r.qty > 1) {
      const t = "** QTY " + r.qty;
      const tw = bold.widthOfTextAtSize(t, 13);
      const bw = tw + 14;
      badgeLeft = W - M - bw;
      pg.drawRectangle({ x: badgeLeft, y: H - headerH + 4, width: bw, height: 22, color: rgb(0, 0, 0) });
      pg.drawText(t, { x: badgeLeft + 7, y: H - headerH + 10, size: 13, font: bold, color: rgb(1, 1, 1) });
    } else {
      const t = "* QTY 1";
      const tw = bold.widthOfTextAtSize(t, 12);
      badgeLeft = W - M - tw;
      pg.drawText(t, { x: badgeLeft, y: H - headerH + 10, size: 12, font: bold, color: rgb(0, 0, 0) });
    }
    const skuText = fitText(font, safeText(r.sku), 10, badgeLeft - (M + seqW + 10) - 8);
    pg.drawText(skuText, { x: M + seqW + 10, y: H - headerH + 11, size: 10, font, color: rgb(0.1, 0.1, 0.1) });

    // The cropped label, as large as fits.
    const areaTop = H - headerH - 4, areaBottom = footerH + 4;
    const bw = emb.width, bh = emb.height;
    const k = Math.min((W - 2 * M) / bw, (areaTop - areaBottom) / bh, 2);
    const dw = bw * k, dh = bh * k;
    pg.drawPage(emb, { x: (W - dw) / 2, y: areaTop - dh, width: dw, height: dh });

    // Footer: logo, shop name, Mini Thanks message.
    if (hasFooter) {
      pg.drawLine({ start: { x: M, y: footerH }, end: { x: W - M, y: footerH }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
      let textX = M;
      if (logo) {
        const lk = Math.min(60 / logo.width, 32 / logo.height);
        const lw = logo.width * lk, lh = logo.height * lk;
        pg.drawImage(logo, { x: M, y: (footerH - lh) / 2, width: lw, height: lh });
        textX = M + lw + 8;
      }
      const maxW = W - M - textX;
      let y = footerH - 14;
      if (shopName) {
        pg.drawText(fitText(bold, shopName, 10, maxW), { x: textX, y, size: 10, font: bold });
        y -= 11;
      }
      if (thanks) {
        for (const line of wrapText(font, thanks, 8, maxW, shopName ? 2 : 3)) {
          pg.drawText(line, { x: textX, y, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
          y -= 9;
        }
      }
    }
  });

  // Part D: a second PDF with the untouched pages that need a human look.
  let reviewBytes = null;
  if (bad.length > 0) {
    const rev = await PDFDocument.create();
    for (const r of bad) {
      try {
        let src = sourceDocs.get(r.docIdx);
        if (src === undefined) { src = await PDFDocument.load(scanState.docs[r.docIdx].bytes); sourceDocs.set(r.docIdx, src); }
        if (!src) continue;
        const [cp] = await rev.copyPages(src, [r.page - 1]);
        rev.addPage(cp);
      } catch (e) { /* cannot copy this one: it is still listed */ }
    }
    if (rev.getPageCount() > 0) reviewBytes = await rev.save();
  }

  const labelBytes = N > 0 ? await out.save() : null;
  return { ready, bad, moved, labelBytes, reviewBytes };
}

// The "Create cropped labels PDF" button in the shop-details card.
async function makeLabels() {
  makeResults.textContent = "";
  makeBtn.disabled = true; scanBtn.disabled = true; cropBtn.disabled = true;
  makeWrap.hidden = false; makeBar.value = 0; makeText.textContent = "Starting…";
  try {
    const r = await buildLabels((pct, text) => { makeBar.value = pct; makeText.textContent = text; });
    showMakeResults(r.ready, r.bad, r.labelBytes, r.reviewBytes);
    makeText.textContent = "Done.";
  } catch (e) {
    makeResults.textContent = "Something went wrong while making the PDF: " + (e && e.message ? e.message : e);
  } finally {
    makeBtn.disabled = false; scanBtn.disabled = false; cropBtn.disabled = false;
  }
}

// The Crop button in the scan section: shows the scissor loader, then swaps the loader for a Download button.
function showCropDone(r) {
  cropDone.textContent = "";
  const msg = document.createElement("p");
  if (r.labelBytes) {
    msg.className = "ok-note";
    msg.textContent = r.ready.length + " label(s) cropped to 4 x 6 inch thermal size.";
    cropDone.appendChild(msg);
    cropDone.appendChild(downloadLink(r.labelBytes, "packkaro-labels.pdf", "Download cropped labels"));
  } else {
    msg.textContent = "No label could be cropped safely. See the Manual Check list.";
    cropDone.appendChild(msg);
  }
  if (r.reviewBytes) {
    cropDone.appendChild(downloadLink(r.reviewBytes, "packkaro-manual-check.pdf",
      "Download Manual Check pages (" + r.bad.length + ")", "warn"));
  }
  if (r.moved.length > 0) {
    const box = document.createElement("div");
    box.className = "review";
    const h3 = document.createElement("h3");
    h3.textContent = "Also moved to Manual Check while cropping (" + r.moved.length + ")";
    const ul = document.createElement("ul");
    for (const m of r.moved) {
      const li = document.createElement("li");
      li.textContent = scanState.docs[m.docIdx].file.name + ", page " + m.page + ": " + m.reason;
      ul.appendChild(li);
    }
    box.append(h3, ul);
    cropDone.appendChild(box);
  }
}

cropBtn.addEventListener("click", async () => {
  if (!scanState) return;
  cropBtn.disabled = true; scanBtn.disabled = true; makeBtn.disabled = true;
  cropStatus.hidden = false;
  cropLoading.hidden = false;
  cropDone.hidden = true;
  cropDone.textContent = "";
  cropBar.value = 0;
  cropLoadingText.textContent = "Starting…";
  cropStatus.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const r = await buildLabels((pct, text) => { cropBar.value = pct; cropLoadingText.textContent = text; });
    showCropDone(r);
  } catch (e) {
    cropDone.textContent = "Something went wrong while cropping: " + (e && e.message ? e.message : e);
  } finally {
    cropLoading.hidden = true;   // the scissors go away...
    cropDone.hidden = false;     // ...and the Download button takes their place
    cropBtn.disabled = false; scanBtn.disabled = false; makeBtn.disabled = false;
  }
});

function showMakeResults(ready, bad, labelBytes, reviewBytes) {
  makeResults.textContent = "";

  if (labelBytes) {
    const p = document.createElement("p");
    p.className = "ok-note";
    p.textContent = ready.length + " label(s) cropped, sorted by item and numbered.";
    makeResults.appendChild(p);
    makeResults.appendChild(downloadLink(labelBytes, "packkaro-labels.pdf", "Download cropped labels (PDF)"));
  } else {
    const p = document.createElement("p");
    p.textContent = "No label could be cropped safely. See the Manual Check list.";
    makeResults.appendChild(p);
  }
  if (reviewBytes) {
    makeResults.appendChild(downloadLink(reviewBytes, "packkaro-manual-check.pdf",
      "Download Manual Check pages (" + bad.length + ")", "warn"));
  }

  // Packing preview: one row per item code.
  const groups = new Map();
  for (const r of ready) {
    const key = r.sku.toUpperCase();
    if (!groups.has(key)) groups.set(key, { sku: r.sku, labels: 0, units: 0, multi: false });
    const g = groups.get(key);
    g.labels++; g.units += r.qty; if (r.qty > 1) g.multi = true;
  }
  if (groups.size > 0) {
    const table = document.createElement("table");
    table.className = "counts";
    const head = table.insertRow();
    for (const h of ["Item code", "Labels", "Units to pack", ""]) {
      const th = document.createElement("th"); th.textContent = h; head.appendChild(th);
    }
    for (const g of groups.values()) {
      const row = table.insertRow();
      row.insertCell().textContent = g.sku;
      row.insertCell().textContent = g.labels;
      row.insertCell().textContent = g.units;
      const c = row.insertCell();
      if (g.multi) { const b = document.createElement("span"); b.className = "multi"; b.textContent = "** has qty > 1"; c.appendChild(b); }
    }
    makeResults.appendChild(table);
  }

  if (bad.length > 0) {
    const box = document.createElement("div");
    box.className = "review";
    const h3 = document.createElement("h3");
    h3.textContent = "Manual Check needed (" + bad.length + ") - not in the cropped PDF";
    const ul = document.createElement("ul");
    for (const r of bad) {
      const li = document.createElement("li");
      li.textContent = scanState.docs[r.docIdx].file.name + ", page " + r.page + ": " + r.reason;
      ul.appendChild(li);
    }
    box.append(h3, ul);
    makeResults.appendChild(box);
  }
}

makeBtn.addEventListener("click", makeLabels);
