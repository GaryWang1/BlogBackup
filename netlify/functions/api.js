const path = require('path');

const { configureRuntime } = require('../lib/runtime.cjs');
const { json, methodNotAllowed, text } = require('../lib/responses.cjs');
const {
  MAX_BBS_SEARCH_PAGES,
  MAX_SELECTED_BBS_POSTS,
  MAX_SELECTED_CATEGORIES,
  assertSupportedUrl,
  limitSummary
} = require('../lib/limits.cjs');
const {
  checkRateLimit,
  createJob,
  getJob,
  getZip,
  publicJob,
  saveJob
} = require('../lib/jobs.cjs');

configureRuntime();

const { listProfiles, getProfile, getProfileForUrl } = require('../../app/server/src/profiles');
const { inspectBlog } = require('../../app/server/src/blog-inspector');
const { searchBbs } = require('../../app/server/src/bbs-inspector');

function routeFromEvent(event) {
  const rawPath = event.path || '/';
  if (rawPath.startsWith('/api/')) {
    return rawPath;
  }
  return rawPath.replace(/^\/\.netlify\/functions\/api\/?/, '/api/');
}

function readBody(event) {
  if (!event.body) {
    return {};
  }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(raw || '{}');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isBbsPostUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === 'bbs.wenxuecity.com'
      && /^\/[^/]+\/\d+\.html$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function sanitizeBbsPage(page) {
  const sourceUrl = String(page?.sourceUrl || '').trim();
  if (!isBbsPostUrl(sourceUrl)) {
    throw new Error('Every selected BBS item needs a Wenxuecity forum post URL.');
  }

  return {
    id: String(page.id || '').trim(),
    title: String(page.title || 'BBS post').trim(),
    sourceUrl,
    sourceCreatedAt: String(page.sourceCreatedAt || '').trim(),
    author: String(page.author || '').trim(),
    forumId: String(page.forumId || '').trim(),
    forumName: String(page.forumName || '').trim(),
    isReply: page.isReply === true
  };
}

function sanitizeCategory(category, profile) {
  const sanitized = {
    id: String(category.id || '').trim(),
    name: String(category.name || 'Category').trim(),
    count: Number.isFinite(Number(category.count)) ? Number(category.count) : null,
    url: String(category.url || '').trim()
  };

  if (!isHttpUrl(sanitized.url)) {
    throw new Error('Every selected category needs a full http:// or https:// URL.');
  }
  assertSupportedUrl(sanitized.url);

  if (profile.id === 'bbs') {
    const pages = Array.isArray(category.pages) ? category.pages.map(sanitizeBbsPage) : [];
    sanitized.keyword = String(category.keyword || '').trim();
    sanitized.searchMode = category.searchMode === 'title' ? 'title' : 'author';
    sanitized.forum = category.forum && typeof category.forum === 'object' ? {
      id: String(category.forum.id || '').trim(),
      name: String(category.forum.name || '').trim(),
      url: String(category.forum.url || '').trim()
    } : null;
    sanitized.pages = pages;
    sanitized.count = sanitized.pages.length;
  }

  return sanitized;
}

function clientIp(event) {
  return String(
    event.headers['x-nf-client-connection-ip']
    || event.headers['client-ip']
    || event.headers['x-forwarded-for']
    || ''
  ).split(',')[0].trim() || 'unknown';
}

function siteOrigin(event) {
  const host = event.headers.host;
  const protocol = event.headers['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}`;
}

async function invokeBackground(event, jobId) {
  const url = `${siteOrigin(event)}/.netlify/functions/archive-background`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId })
  });
  if (!response.ok && response.status !== 202) {
    throw new Error(`Could not start background archive job: HTTP ${response.status}.`);
  }
}

async function handleProfiles() {
  const profiles = (await listProfiles())
    .filter((profile) => profile.id === 'wenxuecity' || profile.id === 'bbs');
  return json(200, { profiles, limits: limitSummary() });
}

async function handleInspect(event) {
  const body = readBody(event);
  const startUrl = String(body.startUrl || '').trim();
  if (!startUrl || !isHttpUrl(startUrl)) {
    return json(400, { error: 'Enter a full http:// or https:// URL.' });
  }
  assertSupportedUrl(startUrl);

  const profile = await getProfileForUrl(startUrl);
  if (!profile || !['wenxuecity', 'bbs'].includes(profile.id)) {
    return json(400, { error: 'This web version only supports Wenxuecity blog and BBS sources.' });
  }

  const result = await inspectBlog({ profile, startUrl });
  return json(200, result);
}

async function handleBbsSearch(event) {
  const body = readBody(event);
  const result = await searchBbs({
    forumId: body.forumId,
    forumName: body.forumName,
    keyword: body.keyword,
    searchMode: body.searchMode,
    maxPages: MAX_BBS_SEARCH_PAGES,
    maxResults: MAX_SELECTED_BBS_POSTS
  });
  return json(200, result);
}

async function handleStart(event) {
  const body = readBody(event);
  const startUrl = String(body.startUrl || '').trim();
  if (!startUrl || !isHttpUrl(startUrl)) {
    return json(400, { error: 'Enter a full http:// or https:// URL.' });
  }
  assertSupportedUrl(startUrl);
  await checkRateLimit(clientIp(event));

  const profile = body.profileId ? await getProfile(body.profileId) : await getProfileForUrl(startUrl);
  if (!profile || !['wenxuecity', 'bbs'].includes(profile.id)) {
    return json(400, { error: 'This web version only supports Wenxuecity blog and BBS sources.' });
  }

  const blog = body.blog && typeof body.blog === 'object' ? body.blog : null;
  if (!blog || !blog.name) {
    return json(400, { error: 'Inspect the source before starting a backup.' });
  }

  const selected = Array.isArray(body.categories) ? body.categories : [];
  if (!selected.length) {
    return json(400, { error: 'Choose at least one category or post to archive.' });
  }
  if (selected.length > MAX_SELECTED_CATEGORIES) {
    return json(400, { error: `Choose ${MAX_SELECTED_CATEGORIES} categories or fewer per web archive job.` });
  }

  const categories = selected.map((category) => sanitizeCategory(category, profile));
  const bbsPostCount = categories.reduce((total, category) => total + (Array.isArray(category.pages) ? category.pages.length : 0), 0);
  if (profile.id === 'bbs' && bbsPostCount > MAX_SELECTED_BBS_POSTS) {
    return json(400, { error: `Choose ${MAX_SELECTED_BBS_POSTS} BBS posts or fewer per web archive job.` });
  }

  const job = await createJob({
    profile,
    startUrl,
    blog,
    categories,
    incremental: false,
    includeComments: profile.id === 'bbs' || body.includeComments === true,
    limits: limitSummary()
  }, {
    ipHash: clientIp(event) === 'unknown' ? 'unknown' : 'set'
  });

  try {
    await invokeBackground(event, job.id);
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.messages.push({ time: new Date().toISOString(), message: error.message });
    await saveJob(job);
    throw error;
  }

  return json(200, { jobId: job.id, limits: limitSummary() });
}

async function handleJob(route) {
  const jobId = path.basename(route);
  const job = await getJob(jobId);
  if (!job) {
    return json(404, { error: 'Job not found or expired.' });
  }
  return json(200, publicJob(job));
}

async function handleDownload(route) {
  const jobId = path.basename(route);
  const job = await getJob(jobId);
  if (!job || job.status !== 'complete') {
    return json(404, { error: 'Download is not ready or has expired.' });
  }

  const zip = await getZip(jobId);
  if (!zip) {
    return json(404, { error: 'Download file has expired.' });
  }

  const fileName = job.result?.fileName || `BlogArchive-${jobId}.zip`;
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      'cache-control': 'private, max-age=300'
    },
    body: Buffer.from(zip).toString('base64')
  };
}

async function handler(event) {
  try {
    const route = routeFromEvent(event);
    if (event.httpMethod === 'GET' && route === '/api/health') {
      return json(200, { ok: true, mode: 'netlify', limits: limitSummary() });
    }
    if (event.httpMethod === 'GET' && route === '/api/profiles') {
      return handleProfiles();
    }
    if (event.httpMethod === 'POST' && route === '/api/inspect') {
      return handleInspect(event);
    }
    if (event.httpMethod === 'POST' && route === '/api/bbs/search') {
      return handleBbsSearch(event);
    }
    if (event.httpMethod === 'POST' && route === '/api/start') {
      return handleStart(event);
    }
    if (event.httpMethod === 'GET' && route.startsWith('/api/jobs/')) {
      return handleJob(route);
    }
    if (event.httpMethod === 'GET' && route.startsWith('/api/download/')) {
      return handleDownload(route);
    }
    if (event.httpMethod === 'POST' && route === '/api/export') {
      return json(400, { error: 'Use the job download link after a web archive job completes.' });
    }
    if (!['GET', 'POST'].includes(event.httpMethod)) {
      return methodNotAllowed();
    }
    return text(404, 'Not found.');
  } catch (error) {
    return json(400, { error: error.message });
  }
}

exports.handler = handler;
