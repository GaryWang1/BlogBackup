import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handler } = require('../lib/api-handler.cjs');

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
