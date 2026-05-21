import path from "path";
import { ENV } from "../../../config/env.js";
import { debug, log, warn } from "../../../utils/logger.js";
import { ensureDir } from "../../../utils/fileUtils.js";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const BILLING_PORTAL = "https://billing.myeshopbox.com/portal/eshopbox/index";
const INVOICE_HASH   = "#/invoices?filter_by=Status.Invoices&per_page=200";

async function navigateToInvoices(page) {
  log("Navigating to Eshopbox billing portal...");

  // Navigate to base URL — SAML may redirect through auth.myeshopbox.com
  await page.goto(BILLING_PORTAL, { waitUntil: "domcontentloaded" });

  // Wait up to 60s for the full SAML chain to settle on billing.myeshopbox.com
  try {
    await page.waitForURL(
      (url) => url.href.startsWith("https://billing.myeshopbox.com"),
      { timeout: 60000 }
    );
  } catch {
    // Not on billing portal yet — try one more direct navigation
    warn(`SAML chain did not settle on billing portal (at: ${page.url()}) — retrying...`);
    await page.goto(BILLING_PORTAL, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForURL(
        (url) => url.href.startsWith("https://billing.myeshopbox.com"),
        { timeout: 60000 }
      );
    } catch {
      warn(`Still not on billing portal — at: ${page.url()}`);
    }
  }

  debug(`Landed on billing portal: ${page.url()}`);

  // Apply invoice hash via JS — stays on same domain, no SAML triggered
  // per_page=200 loads all invoices at once without pagination
  log("Applying invoices hash route (per_page=200)...");
  await page.evaluate(() => {
    window.location.hash = "/invoices?filter_by=Status.Invoices&per_page=200";
  });
  await page.waitForTimeout(4000);

  debug(`Invoice page URL: ${page.url()}`);

  try {
    await page.waitForSelector("table tbody tr", { timeout: 20000 });
    log("Invoice list loaded");
  } catch {
    warn("Invoice table not visible — page may not have loaded correctly");
  }
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
    await page.waitForSelector("table tbody tr", { timeout: 20000 });
  } catch {
    warn(`Invoice table not found for ${label}`);
    return [];
  }

  // per_page=200 loads all invoices at once — read all rows directly
  const rows = page.locator("table tbody tr");
  const totalRows = await rows.count();
  debug(`Total rows in table: ${totalRows}`);

  // Log a sample row to verify date format
  if (totalRows > 0) {
    const sample = (await rows.first().textContent().catch(() => "")).trim().replace(/\s+/g, " ");
    debug(`Sample row: ${sample.slice(0, 120)}`);
  }

  const matched = [];
  for (let i = 0; i < totalRows; i++) {
    const rowText = (await rows.nth(i).textContent().catch(() => "")).trim().replace(/\s+/g, " ");
    if (!rowText.includes(datePattern)) continue;
    const invoiceNum = rowText.split(/\s+/)[0].trim();
    if (invoiceNum) {
      debug(`Found invoice: ${invoiceNum}`);
      matched.push(invoiceNum);
    }
  }

  debug(`Rows matching "${datePattern}": ${matched.length}`);
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
