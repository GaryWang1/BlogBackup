const path = require('path');
const { stream } = require('@netlify/functions');

const { getJob, getZip } = require('../lib/jobs.cjs');

function jobIdFromEvent(event) {
  const rawPath = event.path || '';
  return decodeURIComponent(path.basename(rawPath));
}

function jsonStream(statusCode, body) {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      }
    })
  };
}

exports.handler = stream(async (event) => {
  const jobId = jobIdFromEvent(event);
  const job = await getJob(jobId);
  if (!job || job.status !== 'complete') {
    return jsonStream(404, { error: 'Download is not ready or has expired.' });
  }

  const zip = await getZip(jobId);
  if (!zip) {
    return jsonStream(404, { error: 'Download file has expired.' });
  }

  const fileName = String(job.result?.fileName || `BlogArchive-${jobId}.zip`).replace(/"/g, '');
  const bytes = Buffer.from(zip);
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/zip',
      'content-length': String(bytes.length),
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'private, max-age=300'
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    })
  };
});
