const MAX_SELECTED_CATEGORIES = Number(process.env.BLOG_BACKUP_MAX_CATEGORIES || 3);
const MAX_SELECTED_BBS_POSTS = Number(process.env.BLOG_BACKUP_MAX_BBS_POSTS || 80);
const MAX_PAGES_PER_JOB = Number(process.env.BLOG_BACKUP_MAX_PAGES || 80);
const MAX_CATEGORY_INDEX_PAGES = Number(process.env.BLOG_BACKUP_MAX_INDEX_PAGES || 12);
const MAX_ASSET_BYTES = Number(process.env.BLOG_BACKUP_MAX_ASSET_BYTES || 16 * 1024 * 1024);
const MAX_ZIP_BYTES = Number(process.env.BLOG_BACKUP_MAX_ZIP_BYTES || 18 * 1024 * 1024);
const MAX_BBS_SEARCH_PAGES = Number(process.env.BLOG_BACKUP_MAX_BBS_SEARCH_PAGES || 3);
const MAX_JOBS_PER_HOUR = Number(process.env.BLOG_BACKUP_MAX_JOBS_PER_HOUR || 10);
const JOB_TTL_MS = Number(process.env.BLOG_BACKUP_JOB_TTL_MS || 24 * 60 * 60 * 1000);

const SUPPORTED_HOSTS = new Set([
  'blog.wenxuecity.com',
  'bbs.wenxuecity.com'
]);

function isSupportedUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    return SUPPORTED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function assertSupportedUrl(value) {
  if (!isSupportedUrl(value)) {
    throw new Error('Only Wenxuecity blog and BBS URLs are supported by the public web version.');
  }
}

function limitSummary() {
  return {
    maxSelectedCategories: MAX_SELECTED_CATEGORIES,
    maxSelectedBbsPosts: MAX_SELECTED_BBS_POSTS,
    maxPagesPerJob: MAX_PAGES_PER_JOB,
    maxCategoryIndexPages: MAX_CATEGORY_INDEX_PAGES,
    maxAssetBytes: MAX_ASSET_BYTES,
    maxZipBytes: MAX_ZIP_BYTES,
    maxBbsSearchPages: MAX_BBS_SEARCH_PAGES
  };
}

module.exports = {
  JOB_TTL_MS,
  MAX_ASSET_BYTES,
  MAX_BBS_SEARCH_PAGES,
  MAX_CATEGORY_INDEX_PAGES,
  MAX_JOBS_PER_HOUR,
  MAX_PAGES_PER_JOB,
  MAX_SELECTED_BBS_POSTS,
  MAX_SELECTED_CATEGORIES,
  MAX_ZIP_BYTES,
  assertSupportedUrl,
  isSupportedUrl,
  limitSummary
};
