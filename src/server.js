import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ENV } from "./config/env.js";
import { getLogs, clearLogs, log, error } from "./utils/logger.js";
import { getOtpHistory } from "./services/otp/otpExtractor.js";
import { fetchOtpViaImap } from "./services/otp/otpFetcher.js";
import { getGmailAuth } from "./services/gmail/gmailClient.js";
import { getSessionState } from "./services/session/sessionManager.js";
import { triggerConnector, runAllConnectors, getJobs, isAnyJobRunning, listConnectors } from "./engine/orchestrator.js";
import { isDriveConfigured } from "./services/drive/driveUploader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Write Drive token from env var if provided (Railway ephemeral filesystem workaround)
if (process.env.DRIVE_TOKEN_JSON && !fs.existsSync(ENV.DRIVE_TOKEN_PATH)) {
  try {
    fs.writeFileSync(ENV.DRIVE_TOKEN_PATH, process.env.DRIVE_TOKEN_JSON, "utf8");
  } catch {}
}

const app = express();
app.use(express.json());

// ── Static dashboard ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "dashboard")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "index.html"));
});

// ── Platforms API ─────────────────────────────────────────────────────────────
app.get("/api/platforms", (req, res) => {
  res.json({ platforms: listConnectors() });
});

app.post("/api/platforms/:id/run", (req, res) => {
  const result = triggerConnector(req.params.id, req.body || {});
  log(`Platform ${req.params.id} run — ${result.started ? "job " + result.jobId : result.reason}`);
  res.json(result);
});

// ── Jobs API ──────────────────────────────────────────────────────────────────
app.get("/api/jobs", (req, res) => {
  res.json({ jobs: getJobs() });
});

// ── Status API ────────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  const session = getSessionState();
  const running = isAnyJobRunning();
  const jobs = getJobs();
  const lastCompleted = jobs.find(j => j.status === "success" || j.status === "failed") || null;
  const lastResult = lastCompleted
    ? { success: lastCompleted.status === "success", error: lastCompleted.error, completedAt: lastCompleted.completedAt }
    : null;
  const gmailConfigured = !!(fs.existsSync(ENV.GMAIL_CREDENTIALS_PATH) && fs.existsSync(ENV.GMAIL_TOKEN_PATH));

  res.json({
    session,
    running,
    lastResult,
    config: {
      eshopEmail: ENV.ESHOPBOX_EMAIL || "not set",
      gmailOtpQuery: ENV.GMAIL_OTP_QUERY,
      fromFilter: ENV.IMAP_FROM_FILTER,
      pollIntervalMs: ENV.IMAP_POLL_INTERVAL_MS,
      maxAttempts: ENV.IMAP_MAX_ATTEMPTS,
      gmailConfigured,
    },
  });
});

// ── Run All API ───────────────────────────────────────────────────────────────
app.post("/api/run-all", (req, res) => {
  const { month, year } = req.body || {};
  if (!month || !year) {
    return res.json({ started: false, reason: "month and year are required" });
  }
  const result = runAllConnectors({ month: Number(month), year: Number(year) });
  log(`RunAll triggered — ${result.started ? "job " + result.jobId : result.reason}`);
  res.json(result);
});

// ── Drive status API ──────────────────────────────────────────────────────────
app.get("/api/drive/status", (req, res) => {
  res.json({ configured: isDriveConfigured() });
});

// ── Workflow API (backward-compat → eshopbox) ─────────────────────────────────
app.post("/api/workflow/run", (req, res) => {
  const months = Array.isArray(req.body?.months) ? req.body.months : [];
  const result = triggerConnector("eshopbox", { months });
  log(`Workflow triggered via API — ${result.started ? "started" : result.reason}`);
  res.json(result);
});

// ── OTP API ───────────────────────────────────────────────────────────────────
app.get("/api/otp/history", (req, res) => {
  res.json({ history: getOtpHistory() });
});

app.post("/api/otp/fetch", async (req, res) => {
  try {
    const { otp, entryId } = await fetchOtpViaImap({
      maxAttempts: 2,
      delayMs: 3000,
      sinceMinutes: ENV.IMAP_SINCE_MINUTES,
      fromFilter: ENV.IMAP_FROM_FILTER,
    });
    res.json({ ok: true, otp, entryId });
  } catch (err) {
    error(`Manual OTP fetch failed: ${err.message}`);
    res.json({ ok: false, error: err.message });
  }
});

// ── Gmail test ────────────────────────────────────────────────────────────────
app.post("/api/imap/test", async (req, res) => {
  try {
    await getGmailAuth();
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Session API ───────────────────────────────────────────────────────────────
app.delete("/api/session/clear", (req, res) => {
  const sessionPath = ENV.ESHOPBOX_SESSION_PATH || "eshopbox-session.json";
  try {
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
      log("Session cleared via API");
    }
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Logs API ──────────────────────────────────────────────────────────────────
app.get("/api/logs", (req, res) => {
  res.json({ logs: getLogs() });
});

app.delete("/api/logs/clear", (req, res) => {
  clearLogs();
  res.json({ ok: true });
});

// ── Health ─────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || ENV.UI_PORT || 3030;
app.listen(PORT, () => {
  log(`Nubokind Invoice Automation → http://localhost:${PORT}`);
  log(`eShop email: ${ENV.ESHOPBOX_EMAIL || "(not set)"}`);
  const gmailReady = fs.existsSync(ENV.GMAIL_CREDENTIALS_PATH) && fs.existsSync(ENV.GMAIL_TOKEN_PATH);
  log(`Gmail API configured: ${gmailReady}`);
  if (!gmailReady) log("WARNING: credentials.json / token.json missing — run node scripts/gmailAuth.js");
});
