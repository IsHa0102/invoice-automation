import fs from "fs";
import { chromium } from "playwright";
import { ENV } from "../config/env.js";
import { login } from "../services/platforms/kwikengage/login.js";
import { downloadInvoices } from "../services/platforms/kwikengage/downloadInvoices.js";
import { error, log } from "../utils/logger.js";

export async function runKwikengageWorkflow(months = []) {
  if (!ENV.KWIKENGAGE_EMAIL || !ENV.KWIKENGAGE_PASSWORD) {
    throw new Error("Missing KWIKENGAGE_EMAIL or KWIKENGAGE_PASSWORD in .env");
  }

  const browser = await chromium.launch({ headless: ENV.ESHOPBOX_HEADLESS });

  const contextOptions = { acceptDownloads: true };
  if (fs.existsSync(ENV.KWIKENGAGE_SESSION_PATH)) {
    contextOptions.storageState = ENV.KWIKENGAGE_SESSION_PATH;
  }

  const context = await browser.newContext(contextOptions);
  const page    = await context.newPage();

  try {
    await login(page);
    await context.storageState({ path: ENV.KWIKENGAGE_SESSION_PATH });

    const files = await downloadInvoices(page, months);
    log(`KwikEngage workflow complete — ${files.length} file(s) downloaded`);
    return { downloaded: files };
  } catch (err) {
    error(err.stack || err.message);
    throw err;
  } finally {
    await browser.close();
  }
}
