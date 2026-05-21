import path from "path";
import fs from "fs";
import { ENV } from "../../../config/env.js";
import { debug, log, warn } from "../../../utils/logger.js";

const BILLING_URL = "https://app.kwikengage.ai/billing";
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

async function navigateToInvoicesTab(page) {
  await page.goto(BILLING_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const tabCandidates = [
    page.getByRole("tab",  { name: /^invoices$/i }),
    page.locator('[role="tab"]').filter({ hasText: /^invoices$/i }),
    page.locator('button, a').filter({ hasText: /^invoices$/i }),
  ];

  for (const tab of tabCandidates) {
    if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(2000);
      break;
    }
  }
}

// Try to extract the PDF URL from the preview modal DOM.
// Looks for embed/object/iframe src attributes or bare URLs in innerHTML.
async function extractPdfUrlFromDom(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll("embed, object, iframe")) {
      const src = el.src || el.data
        || el.getAttribute("src") || el.getAttribute("data") || "";
      if (src && (src.includes("tellephant") || /\.pdf(\?|$)/i.test(src))) return src;
    }
    // Regex scan of full innerHTML for tellephant CDN URLs
    const m = document.documentElement.innerHTML
      .match(/https?:\/\/[^"'<>\s]*tellephant[^"'<>\s]*/);
    return m ? m[0] : null;
  }).catch(() => null);
}

export async function downloadInvoices(page, months = []) {
  if (!months.length) {
    warn("No months selected — skipping KwikEngage invoice download");
    return [];
  }

  const downloadDir = path.join(ENV.DOWNLOAD_PATH, "kwikengage");
  fs.mkdirSync(downloadDir, { recursive: true });

  const downloaded = [];

  for (const { month, year } of months) {
    const label     = `${MONTH_NAMES[month - 1]} ${year}`;
    const monthPad  = String(month).padStart(2, "0");
    const datePattern = `${monthPad}-${year}`;

    log(`Fetching KwikEngage invoices for ${label}...`);
    await navigateToInvoicesTab(page);

    const rows = page.locator("table tbody tr").filter({ hasText: datePattern });
    const count = await rows.count();
    debug(`Rows matching "${datePattern}": ${count}`);

    if (count === 0) {
      warn(`No KwikEngage invoices found for ${label}`);
      continue;
    }

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);

      const invoiceNo = (await row.locator("td").first().textContent().catch(() => "")).trim()
        || `invoice-${i}`;
      log(`Downloading invoice: ${invoiceNo}`);

      const safeNo   = invoiceNo.replace(/\//g, "-");
      const filename = `kwikengage-${year}-${monthPad}-${safeNo}.pdf`;
      const filePath = path.join(downloadDir, filename);

      // ── Path A: network interception (non-headless — PDF viewer fetches inline) ──
      let networkPdfBuf = null;
      const onResponse = async (response) => {
        if (networkPdfBuf) return;
        const url = response.url();
        const ct  = (response.headers()["content-type"] || "").toLowerCase();
        if (
          ct.includes("pdf") ||
          url.toLowerCase().includes(".pdf") ||
          (url.includes("tellephant") && !/\.(js|css|png|jpg|gif|woff|svg)(\?|$)/i.test(url))
        ) {
          debug(`PDF network response: ${url}`);
          const buf = await response.body().catch(() => null);
          if (buf && buf.length > 1000 && buf.slice(0, 5).toString("ascii") === "%PDF-") {
            networkPdfBuf = buf;
          } else if (buf) {
            debug(`Skipping non-PDF response (${buf.length}b, header: ${buf.slice(0, 8).toString("ascii")})`);
          }
        }
      };
      page.on("response", onResponse);

      // ── Path B: download event (some headless configs trigger this) ──
      const downloadPromise = page.context()
        .waitForEvent("download", { timeout: 20000 })
        .catch(() => null);

      // ── Click the eye/View button ────────────────────────────────────────────
      await row.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);
      await row.hover().catch(() => {});
      await page.waitForTimeout(300);

      await page.screenshot({ path: `kwikengage-before-click-${i}.png` }).catch(() => {});

      const cellDebug = await row.evaluate(el => {
        const tds = Array.from(el.querySelectorAll("td"));
        const lastTd = tds[tds.length - 1];
        if (!lastTd) return null;

        const html = lastTd.innerHTML.slice(0, 400);
        const candidates = [
          lastTd.querySelector("[aria-describedby]"),
          lastTd.querySelector("svg"),
          lastTd.querySelector("button"),
          lastTd.querySelector("[role='button']"),
          lastTd.querySelector("a"),
          lastTd.querySelector("div"),
          lastTd,
        ];

        for (const c of candidates) {
          if (!c) continue;
          const r = c.getBoundingClientRect();
          if (r.width > 2 && r.height > 2 && r.x >= 0 && r.y >= 0) {
            return { html, x: r.x + r.width / 2, y: r.y + r.height / 2, tag: c.tagName, cls: c.className };
          }
        }

        const r = lastTd.getBoundingClientRect();
        return { html, x: r.x + r.width / 2, y: r.y + r.height / 2, tag: "TD", cls: "" };
      }).catch(() => null);

      if (cellDebug) {
        debug(`Last cell HTML: ${cellDebug.html}`);
        debug(`Clicking <${cellDebug.tag}> cls="${cellDebug.cls}" at (${Math.round(cellDebug.x)}, ${Math.round(cellDebug.y)})`);
        await page.mouse.click(cellDebug.x, cellDebug.y);
      } else {
        await row.locator("td").last().click({ force: true }).catch(() => {});
        debug("Eye button clicked via force click (no cellDebug coords)");
      }

      log(`Opened preview for: ${invoiceNo}`);
      await page.screenshot({ path: `kwikengage-after-click-${i}.png` }).catch(() => {});

      // ── Wait up to 2 s for Path A (network) ─────────────────────────────────
      await page.waitForTimeout(2000);
      page.off("response", onResponse);

      let pdfBuffer = networkPdfBuf || null;

      // ── Path C: DOM extraction (headless — no PDF viewer, embed doesn't load) ─
      if (!pdfBuffer) {
        debug("No network PDF — trying DOM extraction (headless mode)");
        for (let attempt = 0; attempt < 3 && !pdfBuffer; attempt++) {
          if (attempt > 0) await page.waitForTimeout(1500);

          const pdfUrl = await extractPdfUrlFromDom(page);
          if (pdfUrl) {
            debug(`PDF URL found in DOM (attempt ${attempt + 1}): ${pdfUrl}`);
            const resp = await page.request.get(pdfUrl, { timeout: 15000 }).catch(() => null);
            if (resp && resp.ok()) {
              const buf = Buffer.from(await resp.body());
              if (buf.length > 1000 && buf.slice(0, 5).toString("ascii") === "%PDF-") {
                pdfBuffer = buf;
                debug(`DOM extraction success: ${buf.length} bytes`);
              } else {
                debug(`DOM fetch returned non-PDF (${buf.length}b)`);
              }
            } else {
              debug(`DOM fetch failed: ${resp ? resp.status() : "no response"}`);
            }
          } else {
            debug(`DOM extraction attempt ${attempt + 1}: no PDF URL found`);
          }
        }
      }

      // ── Path B resolution: download event ───────────────────────────────────
      if (!pdfBuffer) {
        const dl = await Promise.race([
          downloadPromise,
          new Promise(r => setTimeout(() => r(null), 3000)),
        ]);
        if (dl) {
          debug(`Download event: ${dl.suggestedFilename()}`);
          const buf = await dl.path()
            .then(p => p ? fs.readFileSync(p) : null)
            .catch(() => null);
          if (buf && buf.length > 1000 && buf.slice(0, 5).toString("ascii") === "%PDF-") {
            pdfBuffer = buf;
          } else {
            await dl.saveAs(filePath).catch(() => {});
            pdfBuffer = "saved_by_playwright";
          }
        }
      }

      // ── Save result ──────────────────────────────────────────────────────────
      if (pdfBuffer === "saved_by_playwright") {
        log(`Downloaded (via download event): ${filePath}`);
        downloaded.push(filePath);
      } else if (pdfBuffer) {
        fs.writeFileSync(filePath, pdfBuffer);
        log(`Downloaded: ${filePath}`);
        downloaded.push(filePath);
      } else {
        // All paths failed — try clicking an explicit download button in the viewer
        warn(`PDF not captured for ${invoiceNo} — trying download button in preview`);
        await page.screenshot({ path: `kwikengage-preview-${monthPad}-${year}.png`, fullPage: true }).catch(() => {});

        const DL_SELECTORS = [
          'button[aria-label*="download" i]',
          'button[title*="download" i]',
          '[data-testid*="download"]',
          'a[download]',
          'button[aria-label*="save" i]',
          'button[title*="save" i]',
        ];

        let dlBtn = null;
        for (const frame of page.frames()) {
          debug(`Checking frame: ${frame.url()}`);
          for (const sel of DL_SELECTORS) {
            const loc = frame.locator(sel).first();
            if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
              dlBtn = loc;
              debug(`Download button found: ${sel}`);
              break;
            }
          }
          if (dlBtn) break;
          const btns = await frame.locator("button:visible").all().catch(() => []);
          for (const btn of btns) {
            const html = (await btn.innerHTML().catch(() => "")).toLowerCase();
            if (html.includes("download") || html.includes("arrow-down") || html.includes("save")) {
              dlBtn = btn;
              debug("Download button found by SVG content");
              break;
            }
          }
          if (dlBtn) break;
        }

        if (dlBtn) {
          try {
            const [download] = await Promise.all([
              page.context().waitForEvent("download", { timeout: 15000 }),
              dlBtn.click(),
            ]);
            await download.saveAs(filePath);
            log(`Downloaded via button: ${filePath}`);
            downloaded.push(filePath);
          } catch (err) {
            warn(`Download button click failed for ${invoiceNo}: ${err.message}`);
            await page.screenshot({ path: `kwikengage-download-failed-${monthPad}.png`, fullPage: true }).catch(() => {});
          }
        } else {
          warn(`No download button found for ${invoiceNo}`);
          await page.screenshot({ path: `kwikengage-no-download-btn-${monthPad}.png`, fullPage: true }).catch(() => {});
        }
      }

      // Close preview and return to invoice list
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }
  }

  return downloaded;
}
