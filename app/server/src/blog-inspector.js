const cheerio = require('cheerio');
const { getCategoryArchiveSummary } = require('./archive');
const { inspectBbs } = require('./bbs-inspector');

const WXC_BLOG_TITLE_SUFFIX = /\s*-\s*\u535a\u5ba2\s*\|\s*\u6587\u5b66\u57ce\s*$/i;
const WXC_TITLE_SUFFIX = /\s*[-_]\s*(\u535a\u5ba2\s*\|\s*\u6587\u5b66\u57ce|\u6587\u5b66\u57ce\u535a\u5ba2)\s*$/i;
const WXC_CATEGORY_TITLE = '\u6587\u7ae0\u5206\u7c7b';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

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

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Could not read blog page: HTTP ${response.status}.`);
  }

  return response.text();
}

function blogIdFromUrl(startUrl) {
  try {
    const pathname = new URL(startUrl).pathname;
    const match = pathname.match(/\/(?:myoverview|myblog|myindex)\/(\d+)(?:\/|$)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractWenxuecityBlogId($, startUrl) {
  const fromUrl = blogIdFromUrl(startUrl);
  if (fromUrl) {
    return fromUrl;
  }

  const hidden = $('input#blogId, input[name="blogId"]').first().attr('value');
  if (hidden) {
    return cleanText(hidden);
  }

  const blogHref = $('#blogname a[href], #blognav a[href], a[href*="/myoverview/"], a[href*="/myblog/"]').toArray()
    .map((element) => $(element).attr('href'))
    .find((href) => /\/(?:myoverview|myblog|myindex)\/\d+/i.test(String(href)));

  return blogHref ? blogIdFromUrl(absoluteUrl(blogHref, startUrl)) : null;
}

function extractWenxuecityBloggerName($) {
  const candidates = [
    cleanText($('#username').first().text()),
    cleanText($('#blognamespan').first().text()),
    cleanText($('#blogname').first().text()),
    cleanText($('meta[property="og:title"]').attr('content')).replace(WXC_BLOG_TITLE_SUFFIX, ''),
    cleanText($('title').first().text()).replace(WXC_TITLE_SUFFIX, '')
  ];

  return candidates.find(Boolean) || 'Wenxuecity blogger';
}

function categoryNameFromAnchor($, anchor) {
  const selected = $(anchor);
  const spanName = cleanText(selected.find('span').first().text());
  if (spanName) {
    return spanName;
  }

  const clone = selected.clone();
  clone.find('em').remove();
  return cleanText(clone.text()).replace(/\s*\(\d+\)\s*$/, '') || 'Category';
}

function categoryCountFromAnchor($, anchor) {
  const selected = $(anchor);
  const fromEm = cleanText(selected.find('em').first().text());
  const match = (fromEm || cleanText(selected.text())).match(/\((\d+)\)/);
  return match ? Number(match[1]) : null;
}

function extractWenxuecityCategories($, startUrl, blogId) {
  const categoryContainers = $('#module_category').toArray().filter((element) => {
    const selected = $(element);
    const title = cleanText(selected.find('.BLK_containerHead, .title').first().text());
    if (title.includes(WXC_CATEGORY_TITLE)) {
      return true;
    }

    return selected.find(`a[href*="/myblog/${blogId}/"]`).toArray().some((anchor) => {
      const href = String($(anchor).attr('href') || '');
      return new RegExp(`/myblog/${blogId}/\\d+\\.html(?:[?#].*)?$`).test(href);
    });
  });

  const seen = new Set();
  const categories = [];

  for (const container of categoryContainers) {
    $(container).find('a[href]').each((index, anchor) => {
      const href = $(anchor).attr('href');
      const match = String(href || '').match(new RegExp(`/myblog/${blogId}/(\\d+)\\.html(?:[?#].*)?$`));
      if (!match) {
        return;
      }

      const id = match[1];
      const url = absoluteUrl(href, startUrl);
      if (!url || seen.has(id)) {
        return;
      }

      seen.add(id);
      categories.push({
        id,
        name: categoryNameFromAnchor($, anchor),
        count: categoryCountFromAnchor($, anchor),
        url
      });
    });
  }

  return categories;
}

async function inspectWenxuecityBlog(profile, startUrl) {
  const html = await fetchHtml(startUrl);
  const $ = cheerio.load(html);
  const blogId = extractWenxuecityBlogId($, startUrl);

  if (!blogId) {
    throw new Error('Paste a specific Wenxuecity blog home page, such as https://blog.wenxuecity.com/myoverview/41038/.');
  }

  const blog = {
    id: blogId,
    name: extractWenxuecityBloggerName($),
    homeUrl: absoluteUrl(`/myoverview/${blogId}/`, startUrl) || startUrl,
    profileId: profile.id,
    profileName: profile.name
  };

  const categories = extractWenxuecityCategories($, startUrl, blogId);
  if (!categories.length) {
    throw new Error('No Wenxuecity categories were found on this blog home page.');
  }

  for (const category of categories) {
    const summary = await getCategoryArchiveSummary(blog, category);
    category.archivedCount = summary.archivedCount;
    category.archivePath = summary.archivePath;
    category.lastArchivedAt = summary.lastArchivedAt;
  }

  return {
    profile: {
      id: profile.id,
      name: profile.name
    },
    blog,
    categories
  };
}

async function inspectBlog({ profile, startUrl }) {
  if (profile.id === 'bbs') {
    return inspectBbs(profile, startUrl);
  }

  if (profile.id === 'wenxuecity') {
    return inspectWenxuecityBlog(profile, startUrl);
  }

  throw new Error(`Automatic category discovery is not available for ${profile.name}.`);
}

module.exports = {
  inspectBlog
};
