/**
 * logger.js — structured logger with in-memory ring buffer for dashboard
 */

const MAX_LOGS = 500;
const logStore = [];

function addEntry(level, msg) {
  const entry = { ts: new Date().toISOString(), level, msg };
  logStore.push(entry);
  if (logStore.length > MAX_LOGS) logStore.shift();
  return entry;
}

export function log(msg) {
  const e = addEntry("info", msg);
  console.log(`[info]  ${e.ts} ${msg}`);
}

export function error(msg) {
  const e = addEntry("error", msg);
  console.error(`[error] ${e.ts} ${msg}`);
}

export function debug(msg) {
  const e = addEntry("debug", msg);
  console.log(`[debug] ${e.ts} ${msg}`);
}

export function warn(msg) {
  const e = addEntry("warn", msg);
  console.warn(`[warn]  ${e.ts} ${msg}`);
}

/** Return a copy of the log store for API consumption */
export function getLogs() {
  return [...logStore];
}

/** Clear all stored logs */
export function clearLogs() {
  logStore.length = 0;
}