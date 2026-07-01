const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { detailPageDir, finishCategoryArchive, openCategoryArchive, saveDetailPage, updateSavedPageSourceCreatedAt } = require('./archive');
const { iframeElementHtml, mediaElementHtml, resolveEmbeddedFrame, resolveEmbeddedMedia, rewriteAssets } = require('./assets');

function absoluteUrl(value, baseUrl) {
  const source = String(value || '').trim();
  if (!source) {
    return null;
  }

  try {
    return new URL(source, baseUrl).href;
  } catch {
    return null;
  }
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return String(value || '').trim();
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isServerlessRuntime() {
  return Boolean(process.env.NETLIFY || process.env.BLOG_BACKUP_SERVERLESS === '1');
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function launchBrowser() {
  if (isServerlessRuntime()) {
    const { chromium } = require('playwright-core');
    const chromiumPackage = require('@sparticuz/chromium');
    const chromiumBinary = chromiumPackage.default || chromiumPackage;
    return chromium.launch({
      args: chromiumBinary.args,
      executablePath: await chromiumBinary.executablePath(),
      headless: chromiumBinary.headless !== false,
      chromiumSandbox: false
    });
  }

  const { chromium } = require('playwright');
  const executablePath = findPortableChromiumExecutable();
  const launchOptions = {
    headless: true
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    launchOptions.channel = 'msedge';
  }

  return chromium.launch(launchOptions);
}

async function loadPageHtml(browser, url, progress, action = 'Rendering') {
  if (!browser) {
    progress(`${action === 'Rendering' ? 'Fetching' : action} ${url}`);
    return fetchHtml(url);
  }

  const page = await browser.newPage();
  try {
    progress(`${action} ${url}`);
    await gotoWithFallback(page, url, progress);
    return await page.content();
  } finally {
    await page.close();
  }
}

const MORE_BLOG_ARTICLES_MARKER = '\u66f4\u591a\u6211\u7684\u535a\u5ba2\u6587\u7ae0>>>';
const DETAIL_EXCLUDE_SELECTOR = '#userpost, #buzzbox';

function normalizeSourceCreatedAt(value) {
  return cleanText(value);
}

function extractArticleSourceCreatedAt($, element) {
  const selected = $(element);
  const containerSelectors = ['.articleCell', '.blog_title_h', 'li', 'tr'];

  for (const selector of containerSelectors) {
    const container = selected.closest(selector);
    if (!container.length) {
      continue;
    }

    const sourceCreatedAt = normalizeSourceCreatedAt(container.find('.atc_tm').first().text());
    if (sourceCreatedAt) {
      return sourceCreatedAt;
    }
  }

  return normalizeSourceCreatedAt(selected.find('.atc_tm').first().text());
}

function addArticleEntry(entries, element, href, baseUrl, $) {
  const value = String(href || '').trim();
  if (!value || value.startsWith('#')) {
    return;
  }

  const resolved = absoluteUrl(value, baseUrl);
  if (!resolved || !/^https?:\/\//i.test(resolved)) {
    return;
  }

  const normalized = normalizeSourceUrl(resolved);
  const sourceCreatedAt = extractArticleSourceCreatedAt($, element);
  const existing = entries.find((entry) => entry.url === normalized);
  if (existing) {
    existing.sourceCreatedAt = existing.sourceCreatedAt || sourceCreatedAt;
    return;
  }

  entries.push({
    url: normalized,
    sourceCreatedAt
  });
}

function nextPageHrefFromElement($, element) {
  const selected = $(element);
  if (selected.is('a[href]')) {
    return selected.attr('href');
  }

  const nextText = '\u4e0b\u4e00\u9875';
  const preferred = selected.find('a[href]').toArray().find((anchor) => {
    const label = `${cleanText($(anchor).attr('title'))} ${cleanText($(anchor).text())}`.toLowerCase();
    return label.includes('next') || label.includes(nextText);
  });

  if (preferred) {
    return $(preferred).attr('href');
  }

  if (selected.is('.paging, .pagination, [class*="pager"], [class*="pagination"]')) {
    return null;
  }

  return selected.find('a[href]').first().attr('href');
}

async function gotoWithFallback(page, url, progress) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      return;
    } catch (networkIdleError) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        return;
      } catch (domError) {
        lastError = domError;
        if (attempt < 3) {
          progress(`Retrying ${url} after navigation error: ${domError.message}`);
          await sleep(1500 * attempt);
        } else if (networkIdleError && !domError) {
          lastError = networkIdleError;
        }
      }
    }
  }

  throw lastError;
}

function extractArticleEntries($, selector, baseUrl) {
  const entries = [];
  $(selector).each((index, element) => {
    const selected = $(element);
    addArticleEntry(entries, element, selected.attr('href'), baseUrl, $);
    selected.find('a[href]').each((anchorIndex, anchor) => {
      addArticleEntry(entries, anchor, $(anchor).attr('href'), baseUrl, $);
    });
  });
  return entries;
}

function extractNextPage($, selector, baseUrl) {
  if (!selector) {
    return null;
  }
  const element = $(selector).first();
  if (!element.length) {
    return null;
  }
  const href = nextPageHrefFromElement($, element);
  return href ? normalizeSourceUrl(absoluteUrl(href, baseUrl)) : null;
}

function extractTitle($, selector) {
  const selected = cleanText($(selector).first().text());
  return selected || cleanText($('meta[property="og:title"]').attr('content')) || cleanText($('title').first().text()) || 'Untitled page';
}

function extractOptionalText($, selector) {
  return selector ? cleanText($(selector).first().text()) : '';
}

function trimContentAfterMarker($, content, markerText) {
  const marker = content.find('a').toArray()
    .find((element) => cleanText($(element).text()).includes(markerText))
    || content.find('*').toArray()
      .find((element) => cleanText($(element).text()).includes(markerText));

  if (!marker) {
    return false;
  }

  let cutoff = $(marker);
  const parent = cutoff.parent();
  const cutoffText = cleanText(cutoff.text());
  const parentText = cleanText(parent.text());
  if (
    parent.length &&
    !parent.is(content) &&
    parentText &&
    parentText.length <= cutoffText.length + 30
  ) {
    cutoff = parent;
  }

  cutoff.nextAll().remove();
  cutoff.remove();
  return true;
}

function prepareDetailContent($, content) {
  trimContentAfterMarker($, content, MORE_BLOG_ARTICLES_MARKER);
  content.find(`${DETAIL_EXCLUDE_SELECTOR}, #comment, #comments`).remove();
  return content;
}

function cleanExtractedHtml($, content, pageUrl, includeRoot = false) {
  content.find('script, noscript').remove();
  content.find('iframe, embed').each((index, element) => {
    const src = $(element).attr('src');
    if (src) {
      const frame = resolveEmbeddedFrame(src, pageUrl);
      if (frame) {
        $(element).replaceWith(iframeElementHtml(frame.url, frame.title));
        return;
      }

      const media = resolveEmbeddedMedia(src, pageUrl);
      if (media) {
        $(element).replaceWith(mediaElementHtml(media.kind, media.url, src));
        return;
      }

      $(element).replaceWith(`<p><a href="${src}">${src}</a></p>`);
    } else {
      $(element).remove();
    }
  });
  content.find('object').each((index, element) => {
    const data = $(element).attr('data');
    if (data) {
      const frame = resolveEmbeddedFrame(data, pageUrl);
      if (frame) {
        $(element).replaceWith(iframeElementHtml(frame.url, frame.title));
        return;
      }

      const media = resolveEmbeddedMedia(data, pageUrl);
      if (media) {
        $(element).replaceWith(mediaElementHtml(media.kind, media.url, data));
        return;
      }
      $(element).replaceWith(`<p><a href="${data}">${data}</a></p>`);
    } else {
      $(element).remove();
    }
  });

  return includeRoot ? $.html(content) : content.html() || content.toString();
}

function extractContentHtml($, selector, pageUrl) {
  const selected = $(selector).first();
  let content = selected.length ? selected.clone() : $('article').first().clone();

  if (!content.length) {
    content = $('main').first().clone();
  }

  if (!content.length) {
    content = $('body').clone();
  }

  prepareDetailContent($, content);
  return cleanExtractedHtml($, content, pageUrl);
}

function extractCommentsHtml($, selector, pageUrl) {
  // Primary goal: find and extract comments, but NEVER include #userpost or #buzzbox
  
  // Start by removing these containers entirely from consideration
  if (!selector) {
    // If no selector provided, look for common comment containers
    // but ensure we skip bad containers
    let comments = $('#comment').first();
    if (!comments.length || comments.is('#userpost, #buzzbox')) {
      comments = $('#comments').first();
    }
    if (!comments.length || comments.is('#userpost, #buzzbox')) {
      comments = $('.commentlist').first();
    }
    if (!comments.length || comments.is('#userpost, #buzzbox')) {
      comments = $('.comments').first();
    }
    
    if (!comments.length) {
      return '';
    }
    
    // Extra safety: verify the container is not inside bad containers
    if (comments.closest('#userpost').length || comments.closest('#buzzbox').length) {
      return '';
    }
    
    const cloned = comments.clone();
    cloned.addClass('archived-comments');
    cloned.find('script, noscript, form, textarea, input, button').remove();
    cloned.find('.comment_reply, a[href="#addComment"]').remove();
    cloned.find('#userpost, #buzzbox').remove();
    cloned.find('a[href*="/myblog/"]').each((index, element) => {
      const text = $(element).text();
      if (text.includes('更多我的博客文章')) {
        $(element).closest('li, div, p').remove();
      }
    });
    
    return cleanExtractedHtml($, cloned, pageUrl, true);
  }
  
  // If selector provided, try it first but verify it's not a bad container
  const selectors = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  for (const sel of selectors) {
    try {
      const candidate = $(sel).first();
      if (candidate.length && !candidate.is('#userpost, #buzzbox')) {
        if (!candidate.closest('#userpost').length && !candidate.closest('#buzzbox').length) {
          const cloned = candidate.clone();
          cloned.addClass('archived-comments');
          cloned.find('script, noscript, form, textarea, input, button').remove();
          cloned.find('.comment_reply, a[href="#addComment"]').remove();
          cloned.find('#userpost, #buzzbox').remove();
          cloned.find('a[href*="/myblog/"]').each((index, element) => {
            const text = $(element).text();
            if (text.includes('更多我的博客文章')) {
              $(element).closest('li, div, p').remove();
            }
          });
          return cleanExtractedHtml($, cloned, pageUrl, true);
        }
      }
    } catch (e) {
      // ignore malformed selector
      continue;
    }
  }
  
  return '';
}

function extractCleanCommentsHtml($, selector, pageUrl) {
  const selectors = String(selector || '#comments, #comment, .commentlist, .comments')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sel of selectors) {
    try {
      const candidate = $(sel).first();
      if (
        !candidate.length ||
        candidate.is(DETAIL_EXCLUDE_SELECTOR) ||
        candidate.closest(DETAIL_EXCLUDE_SELECTOR).length
      ) {
        continue;
      }

      const cloned = candidate.clone();
      cloned.addClass('archived-comments');
      cloned.find('script, noscript, form, textarea, input, button').remove();
      cloned.find('.comment_reply, a[href="#addComment"]').remove();
      cloned.find(DETAIL_EXCLUDE_SELECTOR).remove();
      return cleanExtractedHtml($, cloned, pageUrl, true);
    } catch {
      continue;
    }
  }

  return '';
}

function findPortableChromiumExecutable() {
  try {
    const entries = fs.readdirSync(paths.browsersDir, { withFileTypes: true });
    const chromiumDirs = entries
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .map((entry) => path.join(paths.browsersDir, entry.name, 'chrome-win', 'chrome.exe'))
      .filter((candidate) => fs.existsSync(candidate))
      .sort();
    return chromiumDirs[chromiumDirs.length - 1] || null;
  } catch {
    return null;
  }
}

async function backupDetailPage(browser, options) {
  const {
    categoryArchive,
    profile,
    sourceUrl,
    sourceCreatedAt,
    assetCache,
    assetBudget,
    includeComments = false,
    progress
  } = options;

  const html = await loadPageHtml(browser, sourceUrl, progress);
  const $ = cheerio.load(html, { decodeEntities: false });
  const title = extractTitle($, profile.selectors.titleSelector);
  const pageDir = detailPageDir(categoryArchive, title, sourceUrl);
  const detailSourceCreatedAt = extractOptionalText($, profile.selectors.sourceCreatedAtSelector);
  const articleHtml = extractContentHtml($, profile.selectors.contentSelector, sourceUrl);
  const commentsHtml = includeComments ? extractCleanCommentsHtml($, profile.selectors.commentsSelector, sourceUrl) : '';
  const contentHtml = commentsHtml ? `${articleHtml}\n${commentsHtml}` : articleHtml;
  const contentDocument = cheerio.load(`<div id="archived-root">${contentHtml}</div>`, { decodeEntities: false });

  const assets = await rewriteAssets(contentDocument, {
    pageUrl: sourceUrl,
    runAssetsDir: categoryArchive.assetsDir,
    pageDir,
    assetCache,
    assetBudget,
    progress
  });

  const rewrittenHtml = contentDocument('#archived-root').html() || '';

  return saveDetailPage(categoryArchive, {
    sourceUrl,
    sourceCreatedAt: detailSourceCreatedAt || sourceCreatedAt,
    title,
    html: rewrittenHtml,
    capturedAt: new Date().toISOString(),
    commentsArchived: Boolean(commentsHtml),
    assets
  });
}

async function backupCategory(browser, options) {
  const {
    categoryArchive,
    profile,
    incremental,
    includeComments = false,
    limits = {},
    limitsState = {},
    assetBudget,
    progress
  } = options;

  const page = browser ? await browser.newPage() : null;
  const seenCategoryUrls = new Set();
  const seenDetailUrls = new Set();
  const archivedUrls = new Set(categoryArchive.manifest.pages.map((entry) => normalizeSourceUrl(entry.sourceUrl)));
  const assetCache = new Map();
  const categoryName = categoryArchive.manifest.category.name;
  let currentUrl = normalizeSourceUrl(categoryArchive.manifest.category.url);
  let categoryPageCount = 0;
  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const categorySafetyLimit = Number(limits.maxCategoryIndexPages || 20000);
  const maxPages = Number(limits.maxPages || Infinity);
  let reachedPageLimit = false;

  try {
    while (currentUrl && categoryPageCount < categorySafetyLimit) {
      if (seenCategoryUrls.has(currentUrl)) {
        progress(`[${categoryName}] Stopped at repeated index page: ${currentUrl}`);
        break;
      }

      seenCategoryUrls.add(currentUrl);
      categoryPageCount += 1;
      progress(`[${categoryName}] Scanning index page ${categoryPageCount}: ${currentUrl}`);

      const html = page
        ? await (async () => {
          await gotoWithFallback(page, currentUrl, progress);
          return page.content();
        })()
        : await fetchHtml(currentUrl);
      const $ = cheerio.load(html);
      const entries = extractArticleEntries($, profile.selectors.articleLinkSelector, currentUrl);
      let newLinksOnPage = 0;

      for (const entry of entries) {
        if (Number(limitsState.pagesSaved || 0) >= maxPages) {
          progress(`[${categoryName}] Reached the ${maxPages} page limit for this web archive job.`);
          reachedPageLimit = true;
          break;
        }

        const normalized = normalizeSourceUrl(entry.url);
        if (seenDetailUrls.has(normalized)) {
          continue;
        }
        seenDetailUrls.add(normalized);

        if (incremental && archivedUrls.has(normalized)) {
          skippedCount += 1;
          updateSavedPageSourceCreatedAt(categoryArchive, normalized, entry.sourceCreatedAt);
          continue;
        }

        newLinksOnPage += 1;
        try {
          await backupDetailPage(browser, {
            categoryArchive,
            profile,
            sourceUrl: normalized,
            sourceCreatedAt: entry.sourceCreatedAt,
            assetCache,
            assetBudget,
            includeComments,
            progress
          });
          archivedUrls.add(normalized);
          savedCount += 1;
          limitsState.pagesSaved = Number(limitsState.pagesSaved || 0) + 1;
          progress(`[${categoryName}] Saved ${savedCount}: ${normalized}`);
        } catch (error) {
          failedCount += 1;
          progress(`[${categoryName}] Failed to save ${normalized}: ${error.message}`);
        }
      }

      progress(`[${categoryName}] Index page ${categoryPageCount} found ${entries.length} link${entries.length === 1 ? '' : 's'}, ${newLinksOnPage} new.`);
      if (reachedPageLimit) {
        break;
      }
      currentUrl = extractNextPage($, profile.selectors.nextPageSelector, currentUrl);
    }
  } finally {
    if (page) {
      await page.close();
    }
  }

  if (categoryPageCount >= categorySafetyLimit) {
    progress(`[${categoryName}] Stopped after ${categorySafetyLimit} index pages to avoid an endless loop.`);
  }

  return {
    savedCount,
    skippedCount,
    failedCount,
    indexPageCount: categoryPageCount
  };
}

async function backupBbsCategory(browser, options) {
  const {
    categoryArchive,
    profile,
    incremental,
    limits = {},
    limitsState = {},
    assetBudget,
    progress
  } = options;

  const selectedPages = Array.isArray(categoryArchive.category.pages) ? categoryArchive.category.pages : [];
  const archivedUrls = new Set(categoryArchive.manifest.pages.map((entry) => normalizeSourceUrl(entry.sourceUrl)));
  const assetCache = new Map();
  const categoryName = categoryArchive.manifest.category.name;
  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const maxPages = Number(limits.maxPages || Infinity);

  for (let index = 0; index < selectedPages.length; index += 1) {
    if (Number(limitsState.pagesSaved || 0) >= maxPages) {
      progress(`[${categoryName}] Reached the ${maxPages} page limit for this web archive job.`);
      break;
    }

    const entry = selectedPages[index];
    const normalized = normalizeSourceUrl(entry.sourceUrl);

    if (incremental && archivedUrls.has(normalized)) {
      skippedCount += 1;
      updateSavedPageSourceCreatedAt(categoryArchive, normalized, entry.sourceCreatedAt);
      progress(`[${categoryName}] Skipped existing BBS item ${index + 1} of ${selectedPages.length}: ${normalized}`);
      continue;
    }

    try {
      progress(`[${categoryName}] Saving BBS item ${index + 1} of ${selectedPages.length}: ${normalized}`);
      await backupDetailPage(browser, {
        categoryArchive,
        profile,
        sourceUrl: normalized,
        sourceCreatedAt: entry.sourceCreatedAt,
        assetCache,
        assetBudget,
        includeComments: true,
        progress
      });
      archivedUrls.add(normalized);
      savedCount += 1;
      limitsState.pagesSaved = Number(limitsState.pagesSaved || 0) + 1;
      progress(`[${categoryName}] Saved ${savedCount}: ${normalized}`);
    } catch (error) {
      failedCount += 1;
      progress(`[${categoryName}] Failed to save ${normalized}: ${error.message}`);
    }
  }

  return {
    savedCount,
    skippedCount,
    failedCount,
    indexPageCount: 1
  };
}

async function runBackup(options) {
  const {
    profile,
    startUrl,
    blog,
    categories,
    incremental = true,
    includeComments = false,
    limits = {},
    progress
  } = options;

  const browser = isServerlessRuntime() ? null : await launchBrowser();

  const selectedCategories = Array.isArray(categories) ? categories : [];
  const limitsState = { pagesSaved: 0 };
  const assetBudget = Number.isFinite(Number(limits.maxAssetBytes))
    ? { bytes: 0, maxBytes: Number(limits.maxAssetBytes) }
    : null;
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  try {
    progress(`Using profile "${profile.name}".`);
    progress(`Incremental mode is ${incremental ? 'on' : 'off'}.`);
    progress(`Comments archive is ${profile.id === 'bbs' || includeComments ? 'on' : 'off'}.`);

    for (let index = 0; index < selectedCategories.length; index += 1) {
      const category = selectedCategories[index];
      progress(`Starting category ${index + 1} of ${selectedCategories.length}: ${category.name}`);
      const categoryArchive = await openCategoryArchive({
        profile,
        homeUrl: startUrl,
        blog,
        category
      });

      const result = profile.id === 'bbs' ? await backupBbsCategory(browser, {
        categoryArchive,
        profile,
        incremental,
        limits,
        limitsState,
        assetBudget,
        progress
      }) : await backupCategory(browser, {
        categoryArchive,
        profile,
        incremental,
        includeComments,
        limits,
        limitsState,
        assetBudget,
        progress
      });
      await finishCategoryArchive(categoryArchive);

      totalSaved += result.savedCount;
      totalSkipped += result.skippedCount;
      totalFailed += result.failedCount;
      progress(`Finished ${category.name}: saved ${result.savedCount}, skipped ${result.skippedCount}, failed ${result.failedCount}.`);
    }

    progress(`Backup complete. Saved ${totalSaved}, skipped ${totalSkipped}, failed ${totalFailed}.`);

    return {
      archiveIndexPath: '/archive/index.html',
      savedCount: totalSaved,
      skippedCount: totalSkipped,
      failedCount: totalFailed
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  runBackup
};
