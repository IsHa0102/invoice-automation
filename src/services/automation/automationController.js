/**
 * automationController.js
 * Singleton controller for the eShopbox workflow.
 * Prevents concurrent runs, exposes start/stop/status API.
 */

import { runEshopboxWorkflow } from "../../workflows/eshopboxWorkflow.js";
import { log, error, warn } from "../../utils/logger.js";
import { getSessionState, setWorkflowRunning } from "../session/sessionManager.js";

let running = false;
let lastResult = null; // { success, error, completedAt }

export function isRunning() {
  return running;
}

export function getLastResult() {
  return lastResult;
}

/**
 * Trigger the eShopbox workflow.
 * Returns immediately — workflow runs asynchronously.
 * @returns {{ started: boolean, reason?: string }}
 */
export function triggerWorkflow(months = []) {
  if (running) {
    warn("Workflow already running — ignoring trigger");
    return { started: false, reason: "already_running" };
  }

  running = true;
  lastResult = null;
  log(`Workflow triggered — months: ${months.map(m => `${m.month}/${m.year}`).join(", ") || "none"}`);

  runEshopboxWorkflow(months)
    .then(() => {
      running = false;
      lastResult = { success: true, completedAt: new Date().toISOString() };
      log("Workflow completed successfully");
    })
    .catch((err) => {
      running = false;
      lastResult = { success: false, error: err.message, completedAt: new Date().toISOString() };
      error(`Workflow failed: ${err.message}`);
    });

  return { started: true };
}

/**
 * Get full automation status for dashboard API
 */
export function getAutomationStatus() {
  const session = getSessionState();
  return {
    running,
    lastResult,
    session,
  };
}