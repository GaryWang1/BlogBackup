const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const CONTENT_TYPE_EXTENSIONS = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-msvideo': '.avi',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp'
};

const MEDIA_EXTENSIONS = new Set([
  '.avi',
  '.avif',
  '.gif',
  '.jpg',
  '.jpeg',
  '.mov',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.oga',
  '.ogg',
  '.ogv',
  '.png',
  '.svg',
  '.wav',
  '.webm',
  '.webp'
]);

const AUDIO_EXTENSIONS = new Set(['.mp3', '.oga', '.ogg', '.wav']);
const VIDEO_EXTENSIONS = new Set(['.avi', '.mov', '.mp4', '.mpeg', '.ogv', '.webm']);

function toUrlPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function safeBaseName(urlObject) {
  const rawName = decodeURIComponent(path.basename(urlObject.pathname || 'asset')).replace(/[?#].*$/, '');
  const cleaned = rawName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'asset';
}

function extensionFor(urlObject, contentType) {
  const currentExt = path.extname(urlObject.pathname || '').toLowerCase();
  if (MEDIA_EXTENSIONS.has(currentExt)) {
    return currentExt;
  }
  const cleanContentType = String(contentType || '').split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS[cleanContentType] || '.bin';
}

function resolveAssetUrl(value, pageUrl) {
  const source = String(value || '').trim();
  if (!source || source.startsWith('data:') || source.startsWith('blob:') || source.startsWith('mailto:') || source.startsWith('tel:')) {
    return null;
  }
  try {
    return new URL(source, pageUrl).href;
  } catch {
    return null;
  }
}

function mediaKindForUrl(value, contentType = '') {
  const cleanContentType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (cleanContentType.startsWith('audio/')) {
    return 'audio';
  }
  if (cleanContentType.startsWith('video/')) {
    return 'video';
  }

  try {
    const extension = path.extname(new URL(value).pathname || '').toLowerCase();
    if (AUDIO_EXTENSIONS.has(extension)) {
      return 'audio';
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
      return 'video';
    }
  } catch {
    return null;
  }

  return null;
}

function resolveEmbeddedMedia(value, pageUrl) {
  const resolved = resolveAssetUrl(value, pageUrl);
  if (!resolved) {
    return null;
  }

  try {
    const urlObject = new URL(resolved);
    const playerPath = urlObject.pathname.toLowerCase();
    const mediaParam = urlObject.searchParams.get('url') || urlObject.searchParams.get('file') || urlObject.searchParams.get('src');

    if (mediaParam && /(?:audio|video)_ckeditor\.php$/.test(playerPath)) {
      const mediaUrl = new URL(mediaParam, urlObject.origin).href;
      return {
        url: mediaUrl,
        kind: playerPath.includes('video_') ? 'video' : 'audio'
      };
    }

    const directKind = mediaKindForUrl(resolved);
    if (directKind && /\/upload\/media\//i.test(urlObject.pathname)) {
      return {
        url: resolved,
        kind: directKind
      };
    }
  } catch {
    return null;
  }

  return null;
}

function youtubeVideoId(urlObject) {
  const host = urlObject.hostname.replace(/^www\./i, '').toLowerCase();
  const pathname = urlObject.pathname.replace(/\/+$/, '');

  if (host === 'youtu.be') {
    return pathname.split('/').filter(Boolean)[0] || null;
  }

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host.endsWith('.youtube.com')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'v') {
      return parts[1] || null;
    }
    if (pathname === '/watch') {
      return urlObject.searchParams.get('v');
    }
  }

  return null;
}

function normalizeYoutubeEmbedUrl(urlObject, videoId) {
  const host = urlObject.hostname.toLowerCase().includes('youtube-nocookie.com')
    ? 'www.youtube-nocookie.com'
    : 'www.youtube.com';
  const embedUrl = new URL(`https://${host}/embed/${videoId}`);

  for (const name of ['start', 'end', 'list', 'rel']) {
    const value = urlObject.searchParams.get(name);
    if (value) {
      embedUrl.searchParams.set(name, value);
    }
  }

  const time = urlObject.searchParams.get('t');
  if (time && !embedUrl.searchParams.has('start')) {
    const seconds = secondsFromYoutubeTime(time);
    if (seconds > 0) {
      embedUrl.searchParams.set('start', String(seconds));
    }
  }

  if (!embedUrl.searchParams.has('rel')) {
    embedUrl.searchParams.set('rel', '0');
  }

  return embedUrl.href;
}

function secondsFromYoutubeTime(value) {
  const raw = String(value || '').trim();
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!match) {
    return 0;
  }

  return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
}

function resolveEmbeddedFrame(value, pageUrl) {
  const resolved = resolveAssetUrl(value, pageUrl);
  if (!resolved) {
    return null;
  }

  try {
    const urlObject = new URL(resolved);
    const videoId = youtubeVideoId(urlObject);
    if (videoId) {
      return {
        kind: 'youtube',
        url: normalizeYoutubeEmbedUrl(urlObject, videoId),
        title: 'YouTube video'
      };
    }
  } catch {
    return null;
  }

  return null;
}

function stripSearchAndHash(assetUrl) {
  try {
    const urlObject = new URL(assetUrl);
    if (!urlObject.search && !urlObject.hash) {
      return null;
    }
    urlObject.search = '';
    urlObject.hash = '';
    return urlObject.href;
  } catch {
    return null;
  }
}

function hasSignature(buffer, signature, offset = 0) {
  if (buffer.length < offset + signature.length) {
    return false;
  }

  return signature.every((byte, index) => buffer[offset + index] === byte);
}

function isLikelyValidAsset(buffer, contentType) {
  const cleanContentType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!buffer.length) {
    return false;
  }

  if (cleanContentType === 'image/png') {
    return hasSignature(buffer, [0x89, 0x50, 0x4e, 0x47]);
  }
  if (cleanContentType === 'image/jpeg' || cleanContentType === 'image/jpg') {
    return hasSignature(buffer, [0xff, 0xd8]);
  }
  if (cleanContentType === 'image/gif') {
    return buffer.slice(0, 3).toString('ascii') === 'GIF';
  }
  if (cleanContentType === 'image/webp') {
    return buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  }
  if (cleanContentType === 'image/avif') {
    return buffer.includes(Buffer.from('ftypavif')) || buffer.includes(Buffer.from('ftypavis'));
  }
  if (cleanContentType === 'image/svg+xml') {
    return buffer.slice(0, 512).toString('utf8').includes('<svg');
  }
  if (cleanContentType.startsWith('image/')) {
    return buffer.length > 32;
  }
  if (cleanContentType.startsWith('audio/') || cleanContentType.startsWith('video/')) {
    return buffer.length > 1024;
  }

  return true;
}

async function fetchAssetBuffer(assetUrl, progress) {
  const candidates = [assetUrl];
  const withoutSearch = stripSearchAndHash(assetUrl);
  if (withoutSearch && withoutSearch !== assetUrl) {
    candidates.push(withoutSearch);
  }

  let lastError = null;
  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      redirect: 'follow',
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,audio/*,video/*,*/*;q=0.8',
        referer: assetUrl,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      lastError = new Error(`HTTP ${response.status} for ${candidate}`);
      continue;
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (isLikelyValidAsset(buffer, contentType)) {
      if (candidate !== assetUrl) {
        progress(`Retried asset without query string: ${candidate}`);
      }
      return {
        buffer,
        contentType,
        fetchedUrl: candidate
      };
    }

    lastError = new Error(`Invalid ${contentType || 'asset'} response (${buffer.length} bytes) for ${candidate}`);
  }

  throw lastError || new Error(`Could not download ${assetUrl}`);
}

async function downloadAsset(assetUrl, runAssetsDir, assetCache, progress, assetBudget) {
  if (assetCache.has(assetUrl)) {
    return assetCache.get(assetUrl);
  }

  const urlObject = new URL(assetUrl);
  const downloaded = await fetchAssetBuffer(assetUrl, progress);
  const contentType = downloaded.contentType;
  const baseName = safeBaseName(urlObject);
  const ext = extensionFor(urlObject, contentType);
  const baseWithoutExt = path.basename(baseName, path.extname(baseName));
  const fileName = `${hashText(assetUrl)}-${baseWithoutExt}${ext}`;
  const destination = path.join(runAssetsDir, fileName);
  const buffer = downloaded.buffer;
  if (assetBudget && Number.isFinite(assetBudget.maxBytes)) {
    const nextBytes = Number(assetBudget.bytes || 0) + buffer.length;
    if (nextBytes > assetBudget.maxBytes) {
      throw new Error(`Asset limit reached before downloading ${assetUrl}`);
    }
    assetBudget.bytes = nextBytes;
  }

  await fs.mkdir(runAssetsDir, { recursive: true });
  await fs.writeFile(destination, buffer);

  const record = {
    sourceUrl: assetUrl,
    fetchedUrl: downloaded.fetchedUrl,
    path: destination,
    fileName,
    contentType,
    bytes: buffer.length
  };

  assetCache.set(assetUrl, record);
  progress(`Downloaded asset ${fileName}`);
  return record;
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mediaElementHtml(kind, src, label = '') {
  const tagName = kind === 'video' ? 'video' : 'audio';
  const fallbackText = label && !label.includes('/include/') ? label : `Download ${tagName}`;
  return `<${tagName} controls preload="metadata" src="${escapeAttribute(src)}"><a href="${escapeAttribute(src)}">${escapeAttribute(fallbackText)}</a></${tagName}>`;
}

function iframeElementHtml(src, title = 'Embedded media') {
  return `<iframe class="embedded-frame" src="${escapeAttribute(src)}" title="${escapeAttribute(title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

function parseSrcSet(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const segments = part.split(/\s+/);
      return {
        url: segments[0],
        descriptor: segments.slice(1).join(' ')
      };
    });
}

async function rewriteSingleAttribute($, element, attributeName, pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget) {
  const originalValue = $(element).attr(attributeName);
  const resolved = resolveAssetUrl(originalValue, pageUrl);
  if (!resolved) {
    return;
  }

  try {
    const record = await downloadAsset(resolved, runAssetsDir, assetCache, progress, assetBudget);
    assets.push(record);
    const relativePath = toUrlPath(path.relative(pageDir, record.path));
    $(element).attr(attributeName, relativePath);
    if (attributeName === 'src' && ['audio', 'video'].includes(String(element.tagName || '').toLowerCase())) {
      $(element).find('a[href]').attr('href', relativePath);
    }
  } catch (error) {
    progress(`Could not download ${resolved}: ${error.message}`);
  }
}

async function rewriteSrcSet($, element, pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget) {
  const srcset = parseSrcSet($(element).attr('srcset'));
  if (!srcset.length) {
    return;
  }

  const rewritten = [];
  for (const candidate of srcset) {
    const resolved = resolveAssetUrl(candidate.url, pageUrl);
    if (!resolved) {
      rewritten.push([candidate.url, candidate.descriptor].filter(Boolean).join(' '));
      continue;
    }

    try {
      const record = await downloadAsset(resolved, runAssetsDir, assetCache, progress, assetBudget);
      assets.push(record);
      const relativePath = toUrlPath(path.relative(pageDir, record.path));
      rewritten.push([relativePath, candidate.descriptor].filter(Boolean).join(' '));
    } catch (error) {
      progress(`Could not download ${resolved}: ${error.message}`);
      rewritten.push([candidate.url, candidate.descriptor].filter(Boolean).join(' '));
    }
  }

  $(element).attr('srcset', rewritten.join(', '));
}

async function rewriteInlineStyle($, element, pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget) {
  const style = $(element).attr('style');
  if (!style || !style.includes('url(')) {
    return;
  }

  let rewritten = style;
  const matches = [...style.matchAll(/url\((['"]?)(.*?)\1\)/gi)];
  for (const match of matches) {
    const resolved = resolveAssetUrl(match[2], pageUrl);
    if (!resolved) {
      continue;
    }

    try {
      const record = await downloadAsset(resolved, runAssetsDir, assetCache, progress, assetBudget);
      assets.push(record);
      const relativePath = toUrlPath(path.relative(pageDir, record.path));
      rewritten = rewritten.replace(match[0], `url("${relativePath}")`);
    } catch (error) {
      progress(`Could not download ${resolved}: ${error.message}`);
    }
  }

  $(element).attr('style', rewritten);
}

async function rewriteEmbeddedMediaLink($, element, pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget) {
  if ($(element).parents('audio, video').length) {
    return;
  }

  const media = resolveEmbeddedMedia($(element).attr('href'), pageUrl);
  if (!media) {
    return;
  }

  try {
    const record = await downloadAsset(media.url, runAssetsDir, assetCache, progress, assetBudget);
    assets.push(record);
    const relativePath = toUrlPath(path.relative(pageDir, record.path));
    $(element).replaceWith(mediaElementHtml(media.kind, relativePath, $(element).text()));
  } catch (error) {
    progress(`Could not download ${media.url}: ${error.message}`);
  }
}

async function rewriteAssets($, options) {
  const {
    pageUrl,
    runAssetsDir,
    pageDir,
    assetCache,
    progress,
    assetBudget
  } = options;

  const assets = [];
  const elements = $('img, audio, video, source, a[href], [style]').toArray();

  for (const element of elements) {
    const tagName = String(element.tagName || '').toLowerCase();
    if (tagName === 'img') {
      await rewriteSingleAttribute($, element, 'src', pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget);
      await rewriteSrcSet($, element, pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget);
    }

    if (tagName === 'audio' || tagName === 'video' || tagName === 'source') {
      await rewriteSingleAttribute($, element, 'src', pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget);
    }

    if (tagName === 'a') {
      await rewriteEmbeddedMediaLink($, element, pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget);
    }

    await rewriteInlineStyle($, element, pageUrl, runAssetsDir, pageDir, assetCache, assets, progress, assetBudget);
  }

  return assets;
}

module.exports = {
  iframeElementHtml,
  mediaElementHtml,
  resolveEmbeddedFrame,
  resolveEmbeddedMedia,
  rewriteAssets,
  toUrlPath,
  hashText
};
