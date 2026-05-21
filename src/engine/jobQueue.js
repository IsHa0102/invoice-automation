/**
 * jobQueue.js — In-memory job tracking for all automation runs.
 * Stores last 100 jobs; survives server restarts only if persisted (future work).
 */

let jobs = [];
let counter = 0;

export function createJob(connectorId, params = {}) {
  const job = {
    id: `job-${++counter}`,
    connectorId,
    params,
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
  };
  jobs.push(job);
  if (jobs.length > 100) jobs = jobs.slice(-100);
  return { ...job };
}

export function updateJob(jobId, updates) {
  const job = jobs.find(j => j.id === jobId);
  if (job) Object.assign(job, updates);
  return job ? { ...job } : null;
}

export function getJobs() {
  return [...jobs].reverse();
}

export function getJob(id) {
  const job = jobs.find(j => j.id === id);
  return job ? { ...job } : null;
}

export function isAnyJobRunning() {
  return jobs.some(j => j.status === 'running' || j.status === 'queued');
}
