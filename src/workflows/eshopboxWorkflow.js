import fs from "fs";
import { chromium } from "playwright";
import { ENV, validateEshopboxEnv } from "../config/env.js";
import { login } from "../services/platforms/eshopbox/login.js";
import { downloadInvoices } from "../services/platforms/eshopbox/downloadInvoices.js";
import { debug, error, log } from "../utils/logger.js";

export async function runEshopboxWorkflow(months = []) {
  validateEshopboxEnv();

  const browser = await chromium.launch({
    headless: ENV.ESHOPBOX_HEADLESS,
  });

  const contextOptions = {
    acceptDownloads: true,
  };

  if (fs.existsSync(ENV.ESHOPBOX_SESSION_PATH)) {
    contextOptions.storageState = ENV.ESHOPBOX_SESSION_PATH;
    debug(`Using saved session state: ${ENV.ESHOPBOX_SESSION_PATH}`);
  } else {
    debug("No saved Eshopbox session state found; starting fresh login");
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    await login(page);
    await context.storageState({ path: ENV.ESHOPBOX_SESSION_PATH });
    debug(`Session state saved to ${ENV.ESHOPBOX_SESSION_PATH}`);

    if (ENV.ESHOPBOX_SKIP_DOWNLOAD) {
      log("Skipping invoice download because ESHOPBOX_SKIP_DOWNLOAD=true");
    } else {
      await downloadInvoices(page, months);
    }

    log("Eshopbox workflow complete");
  } catch (err) {
    error(err.stack || err.message);
    throw err;
  } finally {
    await browser.close();
  }
}