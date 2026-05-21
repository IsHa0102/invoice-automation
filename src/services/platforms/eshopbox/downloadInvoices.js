import path from "path";
import { ENV } from "../../../config/env.js";
import { debug, log, warn } from "../../../utils/logger.js";
import { ensureDir } from "../../../utils/fileUtils.js";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const BILLING_PORTAL = "https://billing.myeshopbox.com/portal/eshopbox/index";
const INVOICE_HASH   = "#/invoices?filter_by=Status.Invoices&sort_order=D";

async function navigateToInvoices(page) {
  log("Navigating to Eshopbox billing portal...");

  // Step 1: go to billing portal base URL — may trigger SAML redirect to a different domain
  await page.goto(BILLING_PORTAL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000); // allow redirect chain to settle

  const landedUrl = page.url();
  debug(`Portal landed at: ${landedUrl}`);

  // Step 2: if SAML redirected us away from billing.myeshopbox.com, go back now.
  // SAML cookies are now set, so the second visit should stay on billing portal.
  if (!landedUrl.startsWith("https://billing.myeshopbox.com")) {
    log(`SAML redirected to ${landedUrl} — navigating back to billing portal with invoice route...`);
    await page.goto(BILLING_PORTAL + INVOICE_HASH, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    debug(`After return nav: ${page.url()}`);
  } else {
    // Already on billing portal — apply hash via JS to avoid another SAML round-trip
    log("On billing portal — applying invoices hash route...");
    await page.evaluate((hash) => { window.location.hash = hash; }, "/invoices?filter_by=Status.Invoices&sort_order=D");
    await page.waitForTimeout(3000);
  }

  try {
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    log("Invoice list loaded");
  } catch {
    warn("Invoice table not visible — page may not have loaded correctly");
  }

  debug(`Invoice page URL: ${page.url()}`);
}

export async function downloadInvoices(page, months = []) {
  if (months.length === 0) {
    warn("No months selected — skipping invoice download");
    return;
  }

  ensureDir(ENV.DOWNLOAD_PATH);

  for (const { month, year } of months) {
    const monthPad = String(month).padStart(2, "0");
    const label = `${MONTH_NAMES[month - 1]} ${year}`;
    const datePattern = `/${monthPad}/${year}`;

    log(`Fetching invoices for ${label}...`);
    await navigateToInvoices(page);

    const invoiceNumbers = await collectMatchingInvoices(page, datePattern, label);

    if (invoiceNumbers.length === 0) {
      warn(`No invoices found for ${label}`);
      continue;
    }

    log(`Found ${invoiceNumbers.length} invoice(s) for ${label}: ${invoiceNumbers.join(", ")}`);

    for (const invoiceNum of invoiceNumbers) {
      await downloadOneInvoice(page, invoiceNum, month, year);
      await navigateToInvoices(page);
    }
  }
}

async function waitForTableStable(page, { timeout = 20000, interval = 1500, stableFor = 3 } = {}) {
  const deadline = Date.now() + timeout;
  let stableCount = 0;
  let lastCount = -1;

  while (Date.now() < deadline) {
    const count = await page.locator("table tbody tr").count();
    if (count > 0 && count === lastCount) {
      stableCount++;
      if (stableCount >= stableFor) {
        debug(`Table stable at ${count} rows after ${stableFor} consistent checks`);
        return count;
      }
    } else {
      stableCount = 0;
      lastCount = count;
    }
    await page.waitForTimeout(interval);
  }
  debug(`Table stabilization timed out — last row count: ${lastCount}`);
  return Math.max(lastCount, 0);
}

// Scroll the last table row into view repeatedly to trigger lazy-load until row count stops growing
async function scrollToLoadAllRows(page) {
  let lastCount = 0;
  let sameRounds = 0;

  while (sameRounds < 4) {
    // Scroll last row into view — most reliable trigger for infinite-scroll/virtual tables
    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await rows.last().scrollIntoViewIfNeeded().catch(() => {});
    }

    // Also scroll window and every ancestor with overflow scroll
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const table = document.querySelector("table");
      if (!table) return;
      let el = table.parentElement;
      while (el && el !== document.body) {
        el.scrollTop = el.scrollHeight;
        el = el.parentElement;
      }
    });

    await page.waitForTimeout(2000);

    const newCount = await page.locator("table tbody tr").count();
    debug(`Scroll-load: ${newCount} rows`);
    if (newCount === lastCount) {
      sameRounds++;
    } else {
      sameRounds = 0;
      lastCount = newCount;
    }
  }

  log(`All rows loaded: ${lastCount} total`);
  return lastCount;
}

async function collectMatchingInvoices(page, datePattern, label) {
  try {
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
  } catch {
    warn(`Invoice table not found for ${label}`);
    return [];
  }

  // The table is virtualized — only ~24 rows exist in the DOM at a time.
  // Scroll-and-collect: read visible rows, scroll down, repeat until bottom row stops changing.
  const matched = [];
  const seenInvoices = new Set();
  let noNewRowsRounds = 0;
  let lastBottomText = null;

  log("Scanning invoice table (scroll-and-collect)...");

  while (noNewRowsRounds < 4) {
    const rows = page.locator("table tbody tr");
    const count = await rows.count();

    // Read all currently visible rows and collect matches
    for (let i = 0; i < count; i++) {
      const rowText = (await rows.nth(i).textContent().catch(() => "")).trim().replace(/\s+/g, " ");
      if (!rowText) continue;

      if (!seenInvoices.has(rowText) && rowText.includes(datePattern)) {
        const invoiceNum = rowText.split(/\s+/)[0].trim();
        if (invoiceNum && !seenInvoices.has(invoiceNum)) {
          debug(`Found invoice: ${invoiceNum} (row: ${rowText.slice(0, 80)})`);
          matched.push(invoiceNum);
        }
        seenInvoices.add(invoiceNum);
      }
    }

    // Log a sample of visible rows on first pass to verify date format
    if (lastBottomText === null && count > 0) {
      const sample = await rows.first().textContent().catch(() => "");
      debug(`Sample row text: ${sample.trim().replace(/\s+/g, " ").slice(0, 120)}`);
    }

    // Scroll down — try multiple methods
    const lastRow = rows.last();
    const bottomText = (await lastRow.textContent().catch(() => "")).trim();
    await lastRow.scrollIntoViewIfNeeded().catch(() => {});
    await page.keyboard.press("End");
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      document.querySelectorAll("*").forEach(el => {
        const s = getComputedStyle(el);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
    await page.waitForTimeout(2000);

    const newBottomText = (await page.locator("table tbody tr").last().textContent().catch(() => "")).trim();
    debug(`Scroll-collect: ${count} rows visible, bottom changed: ${newBottomText !== bottomText}`);

    if (newBottomText === bottomText) {
      noNewRowsRounds++;
    } else {
      noNewRowsRounds = 0;
      lastBottomText = newBottomText;
    }
  }

  log(`Scroll complete. Found ${matched.length} matching invoice(s) for ${label}`);
  return matched;
}

async function downloadOneInvoice(page, invoiceNum, month, year) {
  const monthPad = String(month).padStart(2, "0");
  const safeNum = invoiceNum.replace(/\//g, "-");
  log(`Opening invoice: ${invoiceNum}`);

  // ── Step 1: click the invoice row to open detail page ─────────────────────
  const row = page.locator("table tbody tr").filter({ hasText: invoiceNum }).first();
  await row.waitFor({ state: "visible", timeout: 5000 });

  const link = row.locator("a").first();
  if (await link.count() > 0) {
    await link.click();
  } else {
    await row.locator("td").first().click();
  }

  await page.waitForTimeout(2000);
  debug(`Detail page URL: ${page.url()}`);

  // ── Step 2: confirm detail page loaded (Print button visible) ─────────────
  const printBtn = page.locator("button").filter({ hasText: /print/i }).first();
  try {
    await printBtn.waitFor({ state: "visible", timeout: 10000 });
    debug("Print button visible on detail page");
  } catch {
    const allBtns = await page.locator("button").all();
    const texts = await Promise.all(allBtns.map(b => b.textContent().catch(() => "")));
    warn(`Print button not found. Buttons on page: ${JSON.stringify(texts.map(t => t.trim()).filter(Boolean))}`);
    return;
  }

  // ── Step 3: open download dropdown ────────────────────────────────────────
  // Toolbar has 3 buttons: [Print] [Download icon] [▾ chevron]
  // Try each non-Print button until "Download PDF" dropdown appears
  const toolbar = printBtn.locator("..");
  const toolbarBtns = toolbar.locator("button");
  const btnCount = await toolbarBtns.count();
  debug(`Buttons in toolbar: ${btnCount}`);

  const pdfOption = page.getByText("Download PDF", { exact: true }).first();
  let dropdownOpen = false;

  for (let i = 0; i < btnCount; i++) {
    const btn = toolbarBtns.nth(i);
    const btnText = (await btn.textContent().catch(() => "")).trim().toLowerCase();
    if (btnText.includes("print")) continue;

    debug(`Clicking toolbar button ${i}: "${btnText || "(no text)"}"`);
    await btn.click();
    await page.waitForTimeout(500);

    const visible = await pdfOption.isVisible().catch(() => false);
    if (visible) {
      debug(`Download PDF dropdown opened by button ${i}`);
      dropdownOpen = true;
      break;
    }
    debug(`Button ${i} did not open dropdown — trying next`);
  }

  if (!dropdownOpen) {
    warn(`Could not open download dropdown for ${invoiceNum}`);
    return;
  }

  // ── Step 4: click "Download PDF" ──────────────────────────────────────────

  // ── Step 5: capture and save the file ────────────────────────────────────
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }),
      pdfOption.click(),
    ]);
    const suggested = await download.suggestedFilename();
    const filename = `eshopbox-${year}-${monthPad}-${safeNum}-${suggested}`;
    const filePath = path.join(ENV.DOWNLOAD_PATH, filename);
    await download.saveAs(filePath);
    log(`Downloaded: ${filePath}`);
  } catch (err) {
    warn(`Download failed for ${invoiceNum}: ${err.message}`);
  }
}
