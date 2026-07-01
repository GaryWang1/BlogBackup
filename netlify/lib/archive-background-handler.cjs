const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { configureRuntime } = require('../lib/runtime.cjs');
const { MAX_ZIP_BYTES } = require('../lib/limits.cjs');
const {
  getJob,
  publicJob,
  saveJob,
  storeZip
} = require('../lib/jobs.cjs');

async function readBody(event) {
  if (!event.body) {
    return {};
  }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(raw || '{}');
}

function addMessage(job, message) {
  job.messages = Array.isArray(job.messages) ? job.messages : [];
  job.messages.push({
    time: new Date().toISOString(),
    message
  });
  if (job.messages.length > 250) {
    job.messages = job.messages.slice(-250);
  }
}

exports.handler = async (event) => {
  const { jobId } = await readBody(event);
  if (!jobId) {
    return;
  }

  const job = await getJob(jobId);
  if (!job || job.status === 'complete') {
    return;
  }

  const tempRoot = path.join(os.tmpdir(), `blog-backup-${jobId}`);
  configureRuntime(tempRoot);
  process.env.BLOG_BACKUP_SERVERLESS = '1';

  let writeChain = Promise.resolve();
  const queueSave = () => {
    writeChain = writeChain.catch(() => {}).then(() => saveJob(job));
    return writeChain;
  };

  try {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    const { runBackup } = require('../../app/server/src/crawler');
    const { exportArchiveZip } = require('../../app/server/src/archive');

    job.status = 'running';
    addMessage(job, 'Archive worker started.');
    await queueSave();

    const payload = job.payload || {};
    await runBackup({
      profile: payload.profile,
      startUrl: payload.startUrl,
      blog: payload.blog,
      categories: payload.categories,
      incremental: false,
      includeComments: payload.includeComments,
      limits: {
        maxPages: payload.limits?.maxPagesPerJob,
        maxCategoryIndexPages: payload.limits?.maxCategoryIndexPages,
        maxAssetBytes: payload.limits?.maxAssetBytes
      },
      progress: (message) => {
        addMessage(job, message);
        queueSave();
      }
    });

    const exported = await exportArchiveZip();
    const stat = await fs.stat(exported.path);
    if (stat.size > MAX_ZIP_BYTES) {
      throw new Error(`The generated ZIP is ${(stat.size / 1024 / 1024).toFixed(1)} MB, which is above the public web limit.`);
    }

    const zipBuffer = await fs.readFile(exported.path);
    await storeZip(job.id, zipBuffer);

    job.status = 'complete';
    job.result = {
      fileName: exported.fileName,
      bytes: zipBuffer.length,
      downloadUrl: `/api/download/${encodeURIComponent(job.id)}`
    };
    addMessage(job, 'Archive ZIP is ready to download.');
    await queueSave();
    await writeChain;
  } catch (error) {
    job.status = 'failed';
    job.error = error.stack || error.message;
    addMessage(job, `Archive failed: ${error.message}`);
    await queueSave();
    await writeChain;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }

  return publicJob(job);
};
