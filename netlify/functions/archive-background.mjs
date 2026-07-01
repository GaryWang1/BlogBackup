import * as netlifyBlobsBundle from '@netlify/blobs';
import archiverBundle from 'archiver';
import * as cheerioBundle from 'cheerio';
import archiveBackgroundHandler from '../lib/archive-background-handler.cjs';

const { handler } = archiveBackgroundHandler;
void netlifyBlobsBundle;
void archiverBundle;
void cheerioBundle;

export const config = {
  background: true
};

async function requestToEvent(request) {
  return {
    path: new URL(request.url).pathname,
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.text(),
    isBase64Encoded: false
  };
}

export default async function archiveBackground(request) {
  await handler(await requestToEvent(request));
  return new Response(null, { status: 204 });
}
