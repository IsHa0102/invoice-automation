/**
 * sessionManager.js
 * Tracks eShop authentication session state.
 * Used by the dashboard to show current auth status.
 */

import fs from "fs";
import { debug, log } from "../../utils/logger.js";
import { ENV } from "../../config/env.js";

const state = {
  status: "idle", // idle | logging_in | otp_pending | authenticated | failed
  lastLogin: null,
  lastError: null,
  sessionFile: null,
  sessionValid: false,
  workflowRunning: false,
  workflowStartedAt: null,
  workflowStep: null,
};

export function getSessionState() {
  // Check if session file exists
  const sessionPath = ENV.ESHOPBOX_SESSION_PATH || "eshopbox-session.json";
  const hasFile = fs.existsSync(sessionPath);
  let sessionAge = null;

  if (hasFile) {
    try {
      const stat = fs.statSync(sessionPath);
      const ageMs = Date.now() - stat.mtimeMs;
      sessionAge = Math.round(ageMs / 1000 / 60); // minutes
    } catch {}
  }

  return {
    ...state,
    sessionFile: hasFile ? sessionPath : null,
    sessionValid: hasFile,
    sessionAgeMinutes: sessionAge,
  };
}

export function setStatus(status, details = {}) {
  state.status = status;
  if (details.error !== undefined) state.lastError = details.error;
  if (status === "authenticated") {
    state.lastLogin = new Date().toISOString();
    state.lastError = null;
  }
  debug(`Session status → ${status}${details.error ? `: ${details.error}` : ""}`);
}

export function setWorkflowRunning(running, step = null) {
  state.workflowRunning = running;
  state.workflowStep = step;
  if (running && !state.workflowStartedAt) {
    state.workflowStartedAt = new Date().toISOString();
  } else if (!running) {
    state.workflowStartedAt = null;
  }
}

export function setWorkflowStep(step) {
  state.workflowStep = step;
  log(`Workflow step: ${step}`);
}