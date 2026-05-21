/**
 * orchestrator.js — Multi-platform workflow runner.
 */

import path from 'path';
import fs   from 'fs';
import { getConnector, listConnectors } from '../connectors/registry.js';
import { createJob, updateJob, getJobs, isAnyJobRunning } from './jobQueue.js';
import { log, error, warn } from '../utils/logger.js';
import { uploadToDrive, isDriveConfigured } from '../services/drive/driveUploader.js';
import { ENV } from '../config/env.js';

export { getJobs, isAnyJobRunning, listConnectors };

export function triggerConnector(connectorId, params = {}) {
  const connector = getConnector(connectorId);

  if (!connector) {
    return { started: false, reason: `Unknown connector: ${connectorId}` };
  }
  if (!connector.available) {
    return { started: false, reason: `${connector.name} is not yet available` };
  }
  if (isAnyJobRunning()) {
    warn(`Job already running — ignoring trigger for ${connectorId}`);
    return { started: false, reason: 'already_running' };
  }

  const job = createJob(connectorId, params);
  updateJob(job.id, { status: 'running', startedAt: new Date().toISOString() });
  log(`[${connector.name}] Job ${job.id} started`);

  connector.run(params)
    .then(() => {
      updateJob(job.id, { status: 'success', completedAt: new Date().toISOString() });
      log(`[${connector.name}] Job ${job.id} completed`);
    })
    .catch(err => {
      updateJob(job.id, { status: 'failed', error: err.message, completedAt: new Date().toISOString() });
      error(`[${connector.name}] Job ${job.id} failed: ${err.message}`);
    });

  return { started: true, jobId: job.id };
}

const ACTIVE_CONNECTORS = ['eshopbox', 'gokwik', 'easebuzz', 'kwikengage'];
const MONTH_ABBR = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// eShopBox saves to the root download dir; others use a subfolder named after the connector
function downloadDirFor(connectorId) {
  if (connectorId === 'eshopbox') return path.resolve(ENV.DOWNLOAD_PATH);
  return path.resolve(ENV.DOWNLOAD_PATH, connectorId);
}

// Find PDFs modified at or after `startMs` in a directory
function newPdfsAfter(dir, startMs) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(dir, f))
    .filter(fp => { try { return fs.statSync(fp).mtimeMs >= startMs; } catch { return false; } });
}

export function runAllConnectors({ month, year }) {
  if (isAnyJobRunning()) {
    warn('Job already running — ignoring Run All trigger');
    return { started: false, reason: 'already_running' };
  }

  const months = [{ month, year }];
  const job    = createJob('all', { months });
  updateJob(job.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
    results: {},
    currentConnector: null,
  });
  log(`[RunAll] Job ${job.id} — ${MONTH_ABBR[month - 1].toUpperCase()} ${year}`);

  (async () => {
    const allFiles = [];
    const results  = {};

    for (const connectorId of ACTIVE_CONNECTORS) {
      const connector = getConnector(connectorId);
      if (!connector || !connector.available) {
        results[connectorId] = { status: 'skipped' };
        updateJob(job.id, { results: { ...results } });
        continue;
      }

      results[connectorId] = { status: 'running' };
      updateJob(job.id, { currentConnector: connectorId, results: { ...results } });
      log(`[RunAll] Starting ${connector.name}...`);

      const downloadDir = downloadDirFor(connectorId);
      const startMs     = Date.now() - 500; // 500ms buffer for filesystem clock skew

      try {
        await connector.run({ months });

        const newFiles = newPdfsAfter(downloadDir, startMs);
        results[connectorId] = { status: 'success', count: newFiles.length };
        allFiles.push(...newFiles);
        log(`[RunAll] ${connector.name} — ${newFiles.length} file(s) downloaded`);
      } catch (err) {
        results[connectorId] = { status: 'failed', error: err.message };
        error(`[RunAll] ${connector.name} failed: ${err.message}`);
      }

      updateJob(job.id, { results: { ...results } });
    }

    // Upload everything to Google Drive
    if (isDriveConfigured()) {
      results._drive = { status: 'running' };
      updateJob(job.id, { currentConnector: 'drive', results: { ...results } });

      try {
        const dr = await uploadToDrive(allFiles, { month, year });
        results._drive = {
          status: 'success',
          folder: dr.folderName,
          count:  dr.uploaded.length,
        };
        log(`[RunAll] Drive — ${dr.uploaded.length} file(s) in "${dr.folderName}"`);
      } catch (err) {
        results._drive = { status: 'failed', error: err.message };
        error(`[RunAll] Drive upload failed: ${err.message}`);
      }
    } else {
      warn('[RunAll] Drive not configured — skipping upload (run: node scripts/driveAuth.js)');
      results._drive = { status: 'skipped', reason: 'not_configured' };
    }

    updateJob(job.id, {
      status: 'success',
      completedAt: new Date().toISOString(),
      currentConnector: null,
      results: { ...results },
      filesTotal: allFiles.length,
    });
    log(`[RunAll] Complete — ${allFiles.length} total file(s)`);
  })().catch(err => {
    updateJob(job.id, {
      status: 'failed',
      error: err.message,
      completedAt: new Date().toISOString(),
    });
    error(`[RunAll] Fatal error: ${err.message}`);
  });

  return { started: true, jobId: job.id };
}
