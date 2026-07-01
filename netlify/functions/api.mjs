import { Buffer } from 'node:buffer';
import * as netlifyBlobsBundle from '@netlify/blobs';
import archiverBundle from 'archiver';
import * as cheerioBundle from 'cheerio';
import apiHandler from '../lib/api-handler.cjs';

const { handler } = apiHandler;
void netlifyBlobsBundle;
void archiverBundle;
void cheerioBundle;
const FUNCTION_BUNDLE_VERSION = 'cheerio-bundled-2026-06-30';

function headersObject(headers) {
  return Object.fromEntries(headers.entries());
}

async function requestToEvent(request) {
  const url = new URL(request.url);
  return {
    path: url.pathname,
    httpMethod: request.method,
    headers: headersObject(request.headers),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: ['GET', 'HEAD'].includes(request.method) ? '' : await request.text(),
    isBase64Encoded: false
  };
}

function resultToResponse(result) {
  if (!result) {
    return new Response(null, { status: 204 });
  }

  const status = result.statusCode || 200;
  const headers = new Headers(result.headers || {});
  headers.set('x-blog-backup-function-version', FUNCTION_BUNDLE_VERSION);
  const body = result.isBase64Encoded
    ? Buffer.from(result.body || '', 'base64')
    : (result.body || '');

  return new Response(body, { status, headers });
}

export default async function api(request) {
  try {
    const result = await handler(await requestToEvent(request));
    return resultToResponse(result);
  } catch (error) {
    return Response.json(
      { error: error.message || 'Netlify function failed.' },
      { status: 500, headers: { 'cache-control': 'no-store' } }
    );
  }
}
