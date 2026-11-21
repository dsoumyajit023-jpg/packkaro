# PackKaro – Step-by-Step Roadmap

Plain-language plan to build and host everything on **GitHub + Cloudflare free tiers**.

---

## 0. The big picture (how the pieces fit)

| Piece | What it is | Where it lives | Cost |
|---|---|---|---|
| **Website (frontend)** | The pages users see: HTML, CSS, JavaScript | GitHub → served by Cloudflare Pages | Free. Static file requests are unlimited on Pages |
| **Server functions (backend)** | Small programs for OTP, payments, QR codes | `/functions` folder → Cloudflare Pages Functions | Free up to **100,000 requests/day** (shared Workers quota) |
| **Small database** | Stores users, trial dates, passes, QR sessions | Cloudflare **D1** (SQL) or **KV** (key-value) | Free tier: KV ≈ 100,000 reads/day, 1,000 writes/day; D1 ≈ 5 GB |
| **Temporary file storage** (optional) | Holds uploaded labels briefly for the cafe-QR feature | Cloudflare **R2** | Free tier ≈ 10 GB |
| **Cropping / sorting work** | Reading PDFs, cropping labels | **Inside the user's own browser** | Free for you (uses their phone/PC) |

**Key money-saving idea:** do the heavy work (PDF cropping, sorting) in the user's browser, not on your server. Your server only handles tiny things: OTP check, payment confirmation, QR code. That is how you stay inside the free limits.

> Limits above come from Cloudflare's documentation as of Nov 2026. They can change, so check the Cloudflare pricing pages before launch.

---

## 1. Accounts to create (all free)

1. **GitHub** – github.com → Sign up. Stores your code and history.
2. **Cloudflare** – dash.cloudflare.com → Sign up. Hosts your site and server functions. No card needed.
3. **A domain name (optional, NOT free)** – your site works free at `yourname.pages.dev`. A custom `.com`/`.in` costs money yearly. Skip it until you launch.
4. **Payment gateway account (Step 5)** – e.g. Razorpay, Cashfree or PhonePe PG. Signup is free; they take a **per-transaction fee** (typically a percentage). They also need KYC (PAN, bank account). Read their current pricing, because on a ₹9 payment even a small fixed fee matters.
5. **OTP/SMS provider (Step 5)** – SMS is the one thing that is rarely truly free (see section 5 below).

---

## 2. Put your code on GitHub (beginner steps)

1. Install **Git** (git-scm.com) and **VS Code** (code.visualstudio.com).
2. On GitHub: click **New repository** → name it `packkaro` → keep it **Public** or **Private** (both work with Cloudflare) → Create.
3. Unzip the starter project to a folder, e.g. `Documents/packkaro`.
4. Open a terminal in that folder and run:

```
git init
git add .
git commit -m "Step 1 starter"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/packkaro.git
git push -u origin main
```

(Easier alternative: on the GitHub repo page choose **uploading an existing file** and drag the files in.)

---

## 3. Connect Cloudflare Pages to GitHub

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorize GitHub and select your `packkaro` repo.
3. Build settings: **Framework preset: None**, **Build command: (leave empty)**, **Output directory: `/`** (or leave blank).
4. Click **Save and Deploy**. In about a minute you get `https://packkaro.pages.dev`.
5. From now on, every `git push` redeploys automatically. Free plan allows 500 builds/month.
6. Open your site → click **Test server** → you should see "Hello from the Cloudflare server!".

SSL (the padlock / HTTPS) is automatic and free.

---

## 4. Build order (each step is small and testable)

| Step | What you build | Notes |
|---|---|---|
| **1** | Dynamic source boxes + deploy to Cloudflare | **Included in this starter** |
| 2 | Upload files + detect platform (Meesho/Flipkart/etc.) | Use PDF.js in the browser to read text from each page. Detect the platform by keywords on the label |
| 3 | Crop labels | Per-platform crop rules, rendered to a canvas, then assembled into a new PDF with pdf-lib |
| 4 | Item/SKU sorting + `*` / `**` quantity badges | Extract SKU and Qty from label text. Anything unclear goes to **Manual Check** |
| 5 | Shop logo, name and "Mini Thanks" on labels | Added while building the output PDF |
| 6 | Packing summary with checkboxes + one-click download | Saved in the browser |
| 7 | State-wise graph + trends | Read the state from the address block; draw a bar chart with a free library (e.g. Chart.js) |
| 8 | Batch processing with progress bar and time estimate | Process 10–20 labels at a time; see section 6 |
| 9 | Cafe QR (rolling code) | See section 7 |
| 10 | OTP login + 30-day free trial | See section 5 |
| 11 | ₹9 / 24-hour pass + UPI QR + webhook | See section 8 |
| 12 | Cloudflare security hardening | See section 9 |

**Strong advice:** get Steps 2–8 (the real label tools) working *without login or payment first*. Add accounts and money only when the core tool already saves people time.

---

## 5. OTP and free-trial abuse (how it works)

**The idea:** a "free trial" must be tied to something hard to fake. A phone number is the best option in India.

1. User enters their mobile number.
2. Your server creates a random 6-digit code, **stores only a hash of it** with a 5-minute expiry, and sends it by SMS.
3. User types the code. Server checks it, marks the number as verified and records `trial_start = today`.
4. Trial ends 30 days later. The same number can never start a second trial.

**Abuse protections (all free):**
- One trial per phone number (database rule).
- Limit OTP requests, e.g. 3 per number per hour, and a few per IP.
- Add **Cloudflare Turnstile** (free CAPTCHA alternative) to the OTP button so bots cannot spam it.
- Lock a code after 5 wrong tries.
- Optional: also record a device fingerprint or cookie. It is weak on its own, but it helps.

**Honest cost note:** SMS OTP costs money per message (India also requires DLT registration for SMS senders). Free options:
- **Email OTP** (cheaper/free tiers exist) or **Google sign-in** are the realistic "zero cost" starting points, though they are easier for abusers to repeat with new email addresses.
- Start with email or Google sign-in during your early users phase, and move to SMS OTP when revenue covers it.

---

## 6. Batch / crash-safe processing

Browsers freeze when you process hundreds of PDF pages in one go. The fix:

1. Split the work into **chunks** (e.g. 10 pages).
2. Process a chunk, update the progress bar, then give the browser a tiny break (`await` a short timeout) before the next chunk.
3. Show **"Page 40 of 200 – about 1 min 20 s left"** (time per chunk × chunks remaining).
4. Use a **Web Worker** so the screen stays responsive.
5. Save results after each chunk (browser storage), so a refresh or crash does not lose everything.

This costs you nothing because it runs on the user's device.

---

## 7. Auto-changing Cafe QR (print helper)

1. User uploads on their phone. The processed file is stored **temporarily** (R2 or KV) under a random ID, with an expiry (e.g. 15 minutes).
2. Phone shows a QR/short code. Every 30–60 seconds the **code rotates**: the server stores `code → file ID` and replaces it with a new one.
3. At the cafe computer the user opens your site, scans/types the code, and the server returns the file **once**.
4. After first use, or on timeout, the code and the file are **deleted**.

Free-tier notes: KV allows only about 1,000 writes/day on the free plan, so rotating codes for many users will hit that limit quickly. D1 or Durable-Object style designs handle more, and you should plan for a small paid plan (Workers Paid starts at a few dollars per month) once real traffic arrives. Also, never log or keep order contents longer than needed, because they contain customers' addresses and phone numbers.

---

## 8. ₹9 pass, UPI QR and webhook

1. User taps **Buy 24-hour pass (₹9)**.
2. Your server asks the payment gateway to create an **order** (or a dynamic UPI QR) for ₹9 and gets back an order ID.
3. User pays by scanning the QR in any UPI app.
4. The gateway calls your **webhook** (`functions/api/payment-webhook.js`) with a signed message.
5. Your server **verifies the signature** (never trust the browser saying "I paid"), then saves `pass_expires_at = now + 24h` for that user.
6. The site checks that expiry before allowing use.

Costs: gateways charge a fee per transaction, and some charge extra for dynamic QR. Confirm current rates and terms before choosing, as a ₹9 sale leaves very little margin.
Use the gateway's **test mode** first. It is free and lets you practise without real money.

---

## 9. Security with Cloudflare (free)

- **HTTPS/SSL:** automatic and free.
- **DDoS protection:** included on all plans.
- **Bot protection:** use Turnstile on OTP/payment buttons. Basic bot-fight features exist on the free plan.
- **Rate limiting:** free plan includes a limited rate-limiting rule allowance. Also add your own limits inside functions (see OTP section).
- **Secrets:** API keys go in **Cloudflare → Settings → Variables and Secrets**, never in GitHub.
- **Input checks:** validate everything the server receives. Never trust the browser.
- **Security headers:** add a `_headers` file (e.g. no-sniff, frame blocking, content security policy).
- **Privacy:** order labels contain personal data. Process in the browser where possible, delete temporary uploads fast, and write a short privacy policy.
- **Bug handling:** use the Cloudflare dashboard logs, keep a staging branch (Pages gives free preview deployments for every branch), and roll back to an earlier deployment with one click if something breaks.

---

## 10. Free vs. "will cost later" summary

| Free for a long time | Likely to cost once you grow |
|---|---|
| Hosting, SSL, DDoS protection | SMS OTP |
| Static site traffic | Payment gateway fees |
| Up to 100,000 server calls/day | KV/D1 writes beyond free quota |
| Browser-side cropping | Custom domain (yearly) |
| GitHub public/private repos | Support tools, email sending at volume |
