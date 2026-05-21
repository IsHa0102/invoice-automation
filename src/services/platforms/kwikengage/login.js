import { google } from "googleapis";
import { getGmailAuthForToken } from "../../gmail/gmailClient.js";
import { extractOtpFromEmail, isOtpUsed, recordOtp, markOtpUsed } from "../../otp/otpExtractor.js";
import { ENV } from "../../../config/env.js";
import { debug, log, warn } from "../../../utils/logger.js";

const BASE_URL  = "https://app.kwikengage.ai";
const OTP_QUERY = "from:no-reply@kwikengage.ai newer_than:10m";

async function fetchKwikEngageOtp() {
  log("Fetching KwikEngage OTP from digital@nubokind.com...");
  const auth  = await getGmailAuthForToken(ENV.GMAIL_DIGITAL_TOKEN_PATH);
  const gmail = google.gmail({ version: "v1", auth });

  for (let attempt = 1; attempt <= 10; attempt++) {
    debug(`KwikEngage OTP attempt ${attempt}/10`);

    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: 5,
      q: OTP_QUERY,
      includeSpamTrash: true,
    });

    for (const { id } of res.data.messages || []) {
      const msgData = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const headers = msgData.data.payload?.headers || [];

      let text = "";
      let html = "";

      function extractParts(parts) {
        if (!parts) return;
        for (const part of parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            text += Buffer.from(part.body.data, "base64").toString("utf8");
          } else if (part.mimeType === "text/html" && part.body?.data) {
            html += Buffer.from(part.body.data, "base64").toString("utf8");
          } else if (part.parts) extractParts(part.parts);
        }
      }

      if (msgData.data.payload?.body?.data) {
        const decoded = Buffer.from(msgData.data.payload.body.data, "base64").toString("utf8");
        if (msgData.data.payload.mimeType === "text/html") html = decoded;
        else text = decoded;
      }
      extractParts(msgData.data.payload?.parts);

      const email = {
        uid: id,
        subject: headers.find(h => h.name.toLowerCase() === "subject")?.value || "",
        from:    headers.find(h => h.name.toLowerCase() === "from")?.value || "",
        date:    new Date(headers.find(h => h.name.toLowerCase() === "date")?.value || Date.now()),
        text:    text || msgData.data.snippet || "",
        html,
      };

      const result = extractOtpFromEmail(email);
      if (!result) continue;
      const { otp, source, emailDate } = result;
      if (isOtpUsed(otp)) { debug(`OTP ${otp} already used — skipping`); continue; }

      const entry = recordOtp({ otp, source, emailDate, uid: id, status: "extracted" });
      log(`KwikEngage OTP extracted: ${otp}`);
      return { otp, entryId: entry.id };
    }

    if (attempt < 10) {
      debug("No OTP yet — waiting 5s...");
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  throw new Error("KwikEngage OTP not received in digital@nubokind.com after 10 attempts");
}

async function submitOtp(page, otp) {
  // Count ALL visible inputs on the OTP page
  const allInputs  = page.locator("input:visible");
  const inputCount = await allInputs.count();
  debug(`OTP page visible inputs: ${inputCount}`);

  if (inputCount >= 6) {
    // 6 separate single-digit boxes — type one digit per box
    debug("Filling 6 individual OTP boxes");
    for (let i = 0; i < 6; i++) {
      const box = allInputs.nth(i);
      await box.click();
      await box.pressSequentially(otp[i], { delay: 100 });
    }
  } else if (inputCount >= 1) {
    // Single input — type all 6 digits
    debug("Filling single OTP input");
    const inp = allInputs.first();
    await inp.click();
    await inp.clear();
    await inp.pressSequentially(otp, { delay: 80 });
  } else {
    return false;
  }

  return true;
}

export async function login(page) {
  log("Opening KwikEngage...");
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  debug(`URL after initial load: ${page.url()}`);

  // Detect login requirement by presence of the email input field.
  // URL-based check is unreliable — the root URL (app.kwikengage.ai/) can be
  // either the login page OR the dashboard after a valid session restore.
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const needsLogin = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);

  if (!needsLogin) {
    log("Session valid — skipping login");
    return;
  }

  // ── Fill email ────────────────────────────────────────────────────────────
  log(`Filling email: ${ENV.KWIKENGAGE_EMAIL}`);
  await emailInput.fill(ENV.KWIKENGAGE_EMAIL);

  // ── Fill password ─────────────────────────────────────────────────────────
  const passwordInput = page.locator('input[type="password"]').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    log("Filling password...");
    await passwordInput.fill(ENV.KWIKENGAGE_PASSWORD);
  }

  // ── Check T&C checkbox ────────────────────────────────────────────────────
  const checkbox = page.locator('input[type="checkbox"]').first();
  if (await checkbox.isVisible().catch(() => false)) {
    if (!await checkbox.isChecked().catch(() => false)) {
      await checkbox.click();
      debug("Checked T&C checkbox");
    }
  }

  // ── Submit and wait for navigation ────────────────────────────────────────
  log("Submitting login form...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {}),
    page.locator('button[type="submit"]').first().click(),
  ]);

  const urlAfterSubmit = page.url();
  debug(`URL after submit: ${urlAfterSubmit}`);
  await page.screenshot({ path: "kwikengage-after-submit.png", fullPage: true }).catch(() => {});

  // ── Password on second screen? ────────────────────────────────────────────
  const pw2 = page.locator('input[type="password"]').first();
  if (await pw2.isVisible({ timeout: 2000 }).catch(() => false)) {
    log("Filling password on second screen...");
    await pw2.fill(ENV.KWIKENGAGE_PASSWORD);
    const cb2 = page.locator('input[type="checkbox"]').first();
    if (await cb2.isVisible().catch(() => false) && !await cb2.isChecked().catch(() => false)) {
      await cb2.click();
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {}),
      page.locator('button[type="submit"]').first().click(),
    ]);
    debug(`URL after second submit: ${page.url()}`);
    await page.screenshot({ path: "kwikengage-after-submit2.png", fullPage: true }).catch(() => {});
  }

  // ── Check for OTP screen ─────────────────────────────────────────────────
  // Wait up to 8s for any input to appear (OTP form renders asynchronously in React)
  log("Checking for OTP screen...");
  await page.waitForSelector("input", { timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: "kwikengage-otp-screen.png", fullPage: true }).catch(() => {});

  const otpFound = await submitOtp(page, "______"); // dry-run check: will fail but tells us if inputs exist
  // Actually: just try to find any input and check what screen we're on
  const currentUrl = page.url();
  const allInputs  = await page.locator("input:visible").count();
  debug(`Current URL: ${currentUrl} | visible inputs: ${allInputs}`);

  // If there are visible inputs and we're NOT on the main dashboard, assume OTP screen
  const onDashboard = currentUrl.includes("/home") || currentUrl.includes("/dashboard") ||
                      currentUrl.includes("/overview") || currentUrl.includes("/campaign") ||
                      (currentUrl.includes("kwikengage.ai") && !currentUrl.includes("/login") &&
                       !currentUrl.includes("/auth") && !currentUrl.includes("/sign") && allInputs === 0);

  if (onDashboard) {
    log("Logged in — on dashboard (no OTP needed)");
    return;
  }

  if (allInputs > 0) {
    log(`OTP screen — ${allInputs} input(s) visible. Fetching OTP from Gmail...`);
    await page.waitForTimeout(4000); // let OTP email arrive

    const { otp, entryId } = await fetchKwikEngageOtp();
    log(`Submitting OTP: ${otp}`);

    const submitted = await submitOtp(page, otp);
    if (!submitted) {
      await page.screenshot({ path: "kwikengage-otp-input-not-found.png", fullPage: true }).catch(() => {});
      throw new Error("Could not find OTP input — check kwikengage-otp-input-not-found.png");
    }

    // Wait for Submit button to become enabled (turns dark blue when all OTP boxes filled)
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll("button")]
          .find(b => b.textContent.trim().toLowerCase() === "submit");
        return btn && !btn.disabled;
      },
      { timeout: 8000 }
    ).catch(() => {});

    // Click the Submit button by its visible text
    const submitBtn = page.getByRole("button", { name: /^submit$/i });
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      debug("Clicking Submit button");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }).catch(() => {}),
        submitBtn.click(),
      ]);
    } else {
      // Fallback: any visible button, then Enter
      const anyBtn = page.locator("button:visible").last();
      if (await anyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }).catch(() => {}),
          anyBtn.click(),
        ]);
      } else {
        await page.keyboard.press("Enter");
        await page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
      }
    }

    markOtpUsed(otp);
    await page.screenshot({ path: "kwikengage-post-otp.png", fullPage: true }).catch(() => {});
    log(`Login complete — URL: ${page.url()}`);
  } else {
    throw new Error(`Login failed — no inputs visible on page. URL: ${currentUrl}`);
  }
}
