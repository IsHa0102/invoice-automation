import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "fs";
import { ENV } from "../../../config/env.js";
import { SELECTORS } from "./selectors.js";
import { debug, error, log, warn } from "../../../utils/logger.js";
import { fetchOtpViaImapDirect, confirmOtpUsed, failOtp } from "../../otp/otpFetcher.js";
import { setStatus, setWorkflowStep } from "../../session/sessionManager.js";

const OTP_INPUT_SELECTORS = [
  'input[name="vcode"]',
  'input[placeholder*="6 digit" i]',
  'input[placeholder*="code" i]',
  'input[aria-label="vcode"]',
  'input[autocomplete="one-time-code"]',
  'input[type="tel"]',
  'input[name*="otp" i]',
];

async function dumpLoginDebug(page, reason) {
  const safeReason = reason.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const screenshotPath = `eshopbox-login-${safeReason}.png`;
  const htmlPath = `eshopbox-login-${safeReason}.html`;

  const inputs = await page
    .locator("input")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        type: node.type,
        name: node.name,
        id: node.id,
        placeholder: node.placeholder,
        aria: node.getAttribute("aria-label"),
        visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      }))
    )
    .catch((err) => [{ error: err.message }]);

  debug(`Login page URL: ${page.url()}`);
  debug(`Visible input debug: ${JSON.stringify(inputs)}`);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  fs.writeFileSync(htmlPath, await page.content(), "utf8");
  debug(`Debug files: ${screenshotPath}, ${htmlPath}`);
}

async function findOtpInput(page) {
  for (const selector of OTP_INPUT_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 2500 });
      debug(`OTP input found: ${selector}`);
      return locator;
    } catch {
      // try next
    }
  }
  await dumpLoginDebug(page, "otp-input-missing");
  throw new Error("OTP input not found on Eshopbox login page");
}

async function clickVerifyButton(page) {
  const candidates = [
    page.getByRole("button", { name: /^continue$/i }),
    page.getByRole("button", { name: /^verify$/i }),
    page.locator('button[type="submit"]').first(),
  ];

  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: "visible", timeout: 2500 });
      await candidate.click();
      return;
    } catch {
      // try next
    }
  }
  await dumpLoginDebug(page, "verify-button-missing");
  throw new Error("Verify/Continue button not found on Eshopbox OTP page");
}

/**
 * Resolve OTP using (in priority order):
 * 1. ESHOPBOX_DEV_OTP env var (dev override)
 * 2. Gmail IMAP with App Password (primary)
 * 3. Manual CLI prompt (fallback if ESHOPBOX_MANUAL_OTP=true)
 */
async function resolveOtp() {
  if (ENV.ESHOPBOX_DEV_OTP) {
    debug(`Using dev OTP override: ${ENV.ESHOPBOX_DEV_OTP}`);
    return { otp: ENV.ESHOPBOX_DEV_OTP, entryId: null };
  }

  // Try IMAP if EMAIL_USER + EMAIL_APP_PASSWORD are configured
  if (ENV.EMAIL_USER && ENV.EMAIL_APP_PASSWORD) {
    log("Fetching OTP via IMAP...");
    setStatus("otp_pending");
    try {
      const result = await fetchOtpViaImapDirect({
        maxAttempts: ENV.IMAP_MAX_ATTEMPTS,
        delayMs: ENV.IMAP_POLL_INTERVAL_MS,
        sinceMinutes: ENV.IMAP_SINCE_MINUTES,
        fromFilter: ENV.IMAP_FROM_FILTER,
      });
      return result;
    } catch (err) {
      warn(`IMAP OTP fetch failed: ${err.message}`);
      if (!ENV.ESHOPBOX_MANUAL_OTP) throw err;
    }
  } else {
    warn("IMAP not configured (EMAIL_USER / EMAIL_APP_PASSWORD missing)");
  }

  // Fallback to manual
  if (ENV.ESHOPBOX_MANUAL_OTP) {
    const rl = createInterface({ input, output });
    try {
      const otp = await rl.question("Enter OTP from Eshopbox email: ");
      return { otp: otp.trim(), entryId: null };
    } finally {
      rl.close();
    }
  }

  throw new Error("No OTP resolution method available. Configure EMAIL_USER + EMAIL_APP_PASSWORD.");
}

export async function login(page) {
  setWorkflowStep("opening_login");
  log("Opening Eshopbox login page...");

  await page.goto(ENV.ESHOPBOX_BASE_URL, { waitUntil: "domcontentloaded" });

  // Eshopbox uses a JS-based session check that redirects AFTER domcontentloaded.
  // Wait up to 6s for a redirect away from the login page.
  try {
    await page.waitForURL((url) => !url.href.includes("/auth/login"), { timeout: 6000 });
  } catch {
    // No redirect within 6s — login page is showing, proceed with full login
  }

  const urlAfterNav = page.url();
  if (!urlAfterNav.includes("/auth/login")) {
    log(`Session still valid — already on dashboard, skipping login`);
    setStatus("authenticated");
    return;
  }

  setWorkflowStep("submitting_email");
  debug(`Filling email: ${ENV.ESHOPBOX_EMAIL}`);
  await page.fill(SELECTORS.emailInput, ENV.ESHOPBOX_EMAIL);
  await page.click(SELECTORS.continueBtn);
  log("Email submitted — OTP should arrive shortly");

  setWorkflowStep("waiting_otp_input");
  log("Waiting for OTP input field...");
  const otpInput = await findOtpInput(page);

  // Give the email a couple of seconds to arrive before polling Gmail
  log("Pausing 2s for OTP email delivery...");
  await page.waitForTimeout(2000);

  setWorkflowStep("fetching_otp");
  const { otp, entryId } = await resolveOtp();
  debug(`OTP resolved: ${otp}`);

  setWorkflowStep("submitting_otp");
  log("Submitting OTP...");

  // Clear field first, then type character-by-character to trigger input events
  await otpInput.click();
  await otpInput.clear();
  await otpInput.pressSequentially(otp, { delay: 80 });
  debug(`OTP typed into field: ${otp}`);

  // Small pause so the form can react to input before we click verify
  await page.waitForTimeout(500);

  await clickVerifyButton(page);

  // Also press Enter as a fallback trigger
  await page.keyboard.press("Enter");
  debug("OTP verification submitted");

  setWorkflowStep("verifying");

  // Wait for URL to change away from login/auth pages (up to 20s)
  try {
    await page.waitForURL(
      (url) => !url.href.includes("/auth/login"),
      { timeout: 20000 }
    );
  } catch {
    // waitForURL timed out — fall through to URL check below
  }

  // Verify login success by checking URL or page state
  const currentUrl = page.url();
  if (currentUrl.includes("/auth/login")) {
    failOtp(otp, entryId, "still on login page after OTP submit");
    setStatus("failed", { error: "OTP verification failed — still on login page" });
    await dumpLoginDebug(page, "post-otp-still-on-login");
    throw new Error("Login failed: OTP verification did not redirect away from login");
  }

  confirmOtpUsed(otp, entryId);
  setStatus("authenticated");
  log("Logged in successfully");
}