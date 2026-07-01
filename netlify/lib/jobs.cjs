const crypto = require('crypto');

const {
  JOB_TTL_MS,
  MAX_JOBS_PER_HOUR
} = require('./limits.cjs');

const STORE_NAME = 'blog-backup-jobs';

async function getStore() {
  const blobs = await import('@netlify/blobs');
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN;
  const options = {
    name: STORE_NAME,
    consistency: 'strong'
  };

  if (siteID && token) {
    options.siteID = siteID;
    options.token = token;
  }

  return blobs.getStore(options);
}

function createJobId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
}

function jobKey(jobId) {
  return `jobs/${jobId}.json`;
}

function zipKey(jobId) {
  return `zips/${jobId}.zip`;
}

function rateKey(ip, date = new Date()) {
  const safeIp = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 24);
  const hour = date.toISOString().slice(0, 13);
  return `rate/${safeIp}/${hour}.json`;
}

async function readJson(key, fallback = null) {
  const store = await getStore();
  const raw = await store.get(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(key, value, metadata = {}) {
  const store = await getStore();
  await store.set(key, JSON.stringify(value), { metadata });
}

async function createJob(payload, owner) {
  const now = Date.now();
  const jobId = createJobId();
  const job = {
    id: jobId,
    status: 'queued',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + JOB_TTL_MS).toISOString(),
    owner: owner || {},
    payload,
    messages: [{
      time: new Date(now).toISOString(),
      message: 'Archive job queued.'
    }],
    result: null,
    error: null
  };
  await saveJob(job);
  return job;
}

async function getJob(jobId) {
  const job = await readJson(jobKey(jobId));
  if (!job) {
    return null;
  }
  if (Date.parse(job.expiresAt || '') < Date.now()) {
    await deleteJob(jobId);
    return null;
  }
  return job;
}

async function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  await writeJson(jobKey(job.id), job, {
    status: job.status,
    expiresAt: job.expiresAt || ''
  });
}

async function deleteJob(jobId) {
  const store = await getStore();
  await Promise.all([
    store.delete(jobKey(jobId)),
    store.delete(zipKey(jobId))
  ]);
}

async function checkRateLimit(ip) {
  const key = rateKey(ip);
  const current = await readJson(key, { count: 0, startedAt: new Date().toISOString() });
  current.count = Number(current.count || 0) + 1;
  current.updatedAt = new Date().toISOString();
  await writeJson(key, current);
  if (current.count > MAX_JOBS_PER_HOUR) {
    throw new Error('Too many archive jobs from this network. Please try again later.');
  }
}

async function storeZip(jobId, buffer) {
  const store = await getStore();
  await store.set(zipKey(jobId), buffer, {
    metadata: {
      jobId,
      contentType: 'application/zip',
      expiresAt: new Date(Date.now() + JOB_TTL_MS).toISOString()
    }
  });
}

async function getZip(jobId) {
  const store = await getStore();
  return store.get(zipKey(jobId), { type: 'arrayBuffer' });
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    messages: Array.isArray(job.messages) ? job.messages.slice(-200) : [],
    result: job.result,
    error: job.error
  };
}

module.exports = {
  checkRateLimit,
  createJob,
  getJob,
  getZip,
  publicJob,
  saveJob,
  storeZip
};
