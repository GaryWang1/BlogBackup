import path from 'node:path';
import { Buffer } from 'node:buffer';
import jobs from '../lib/jobs.cjs';

const { getJob, getZip } = jobs;

function json(status, body) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store'
    }
  });
}

function jobIdFromRequest(request) {
  const pathname = new URL(request.url).pathname;
  return decodeURIComponent(path.posix.basename(pathname));
}

export default async function download(request) {
  const jobId = jobIdFromRequest(request);
  const job = await getJob(jobId);
  if (!job || job.status !== 'complete') {
    return json(404, { error: 'Download is not ready or has expired.' });
  }

  const zip = await getZip(jobId);
  if (!zip) {
    return json(404, { error: 'Download file has expired.' });
  }

  const bytes = Buffer.from(zip);
  const fileName = String(job.result?.fileName || `BlogArchive-${jobId}.zip`).replace(/"/g, '');
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-length': String(bytes.length),
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'private, max-age=300'
    }
  });
}
