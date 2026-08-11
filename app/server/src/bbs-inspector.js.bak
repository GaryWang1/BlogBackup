const cheerio = require('cheerio');

const BBS_HOME_URL = 'https://bbs.wenxuecity.com/';
const DEFAULT_FORUM_ID = 'romance';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value, baseUrl = BBS_HOME_URL) {
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

function postIdFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(/\/([^/]+)\/(\d+)\.html$/i);
    return match ? { forumId: match[1], postId: match[2] } : null;
  } catch {
    return null;
  }
}

function parseSetCookieHeaders(response) {
  try {
    const rawHeaders = typeof response.headers.raw === 'function' ? response.headers.raw() : {};
    return rawHeaders['set-cookie'] || [];
  } catch {
    return [];
  }
}

function updateCookieJar(cookieJar, response) {
  if (!cookieJar) {
    return;
  }

  for (const headerValue of parseSetCookieHeaders(response)) {
    if (!headerValue) {
      continue;
    }

    const [cookiePair] = String(headerValue).split(';');
    const [name, ...valueParts] = cookiePair.split('=');
    if (!name) {
      continue;
    }

    cookieJar.set(name.trim(), valueParts.join('=').trim());
  }
}

function cookieHeader(cookieJar) {
  if (!cookieJar || !cookieJar.size) {
    return '';
  }

  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function fetchHtml(url, referer, cookieJar) {
  const headers = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  };
  if (referer) {
    headers.referer = referer;
  }

  const cookieString = cookieHeader(cookieJar);
  if (cookieString) {
    headers.cookie = cookieString;
  }

  const response = await fetch(url, {
    redirect: 'follow',
    headers
  });

  if (!response.ok) {
    throw new Error(`Could not read BBS page: HTTP ${response.status}.`);
  }

  updateCookieJar(cookieJar, response);
  return response.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlankBbsSearchForm(html) {
  const normalized = String(html || '').replace(/\s+/g, ' ').trim();
  return /<title>文学城论坛内容查询\s*<\/title>/i.test(normalized);
}

async function fetchHtmlWithRetry(url, referer, cookieJar, attempt = 0) {
  const html = await fetchHtml(url, referer, cookieJar);
  if (attempt < 2 && isBlankBbsSearchForm(html)) {
    await sleep(3000);
    return fetchHtmlWithRetry(url, referer, cookieJar, attempt + 1);
  }
  return html;
}

function forumIdFromUrl(value) {
  try {
    const url = new URL(value, BBS_HOME_URL);
    if (url.hostname.toLowerCase() !== 'bbs.wenxuecity.com') {
      return null;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 1 || url.search || url.hash) {
      return null;
    }

    const id = parts[0].trim();
    return id && id !== 'catalog' ? id : null;
  } catch {
    return null;
  }
}

function extractBbsForums($, startUrl) {
  const byId = new Map();

  $('a[href]').each((index, anchor) => {
    const href = $(anchor).attr('href');
    const id = forumIdFromUrl(href);
    const name = cleanText($(anchor).text());
    const url = absoluteUrl(href, startUrl);
    if (!id || !name || !url) {
      return;
    }

    const current = byId.get(id);
    if (!current || name.length > current.name.length || String(href).startsWith('./')) {
      byId.set(id, {
        id,
        name,
        url
      });
    }
  });

  return [...byId.values()].sort((a, b) => {
    if (a.id === DEFAULT_FORUM_ID) {
      return -1;
    }
    if (b.id === DEFAULT_FORUM_ID) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function bbsSearchUrl({ forumId, keyword, searchMode }) {
  const url = new URL('/bbs/archive.php', BBS_HOME_URL);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('username', searchMode === 'author' ? 'on' : '');
  url.searchParams.set('reply', 'on');
  url.searchParams.set('submit1', '查询');
  url.searchParams.set('act', 'index');
  url.searchParams.set('SubID', forumId);
  url.searchParams.set('year', 'current');
  return url.href;
}

function parseResultCount(value) {
  const match = cleanText(value).match(/共\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function searchPageUrls($, searchUrl) {
  const pages = new Map();
  const sourceUrl = new URL(searchUrl);
  const sourceKeyword = cleanText(sourceUrl.searchParams.get('keyword'));
  const sourceSubId = cleanText(sourceUrl.searchParams.get('SubID'));
  const sourceReply = String(sourceUrl.searchParams.get('reply') || 'on');

  $('a[href]').each((index, anchor) => {
    const href = String($(anchor).attr('href') || '').trim();
    const urlText = absoluteUrl(href, searchUrl);
    if (!urlText) {
      return;
    }

    try {
      const pageUrl = new URL(urlText);
      if (!pageUrl.pathname.endsWith('/bbs/archive.php')) {
        return;
      }

      const pageValue = pageUrl.searchParams.get('page');
      if (!pageValue || !/^\d+$/.test(pageValue)) {
        return;
      }

      const pageNumber = Number(pageValue);
      const keyword = cleanText(pageUrl.searchParams.get('keyword'));
      const subId = cleanText(pageUrl.searchParams.get('SubID'));
      const reply = String(pageUrl.searchParams.get('reply') || 'on');
      if (keyword !== sourceKeyword || subId !== sourceSubId || reply !== sourceReply) {
        return;
      }

      if (pageNumber >= 1) {
        pages.set(pageNumber, pageUrl.href);
      }
    } catch {
      return;
    }
  });

  return [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, url]) => url);
}

function searchPageNumber(value) {
  try {
    const url = new URL(value);
    const pageValue = url.searchParams.get('page');
    return pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : null;
  } catch {
    return null;
  }
}

function pagedSearchUrl(searchUrl, pageNumber) {
  const url = new URL(searchUrl);
  url.searchParams.set('page', String(pageNumber));
  return url.href;
}

function searchResultPageCount(totalCount, firstPageResultCount) {
  if (!Number.isFinite(totalCount) || totalCount <= 0 || firstPageResultCount <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(totalCount / firstPageResultCount));
}

function additionalSearchPageUrls($, searchUrl, parsed, maxPages) {
  const pages = new Map();
  for (const pageUrl of searchPageUrls($, searchUrl)) {
    const pageNumber = searchPageNumber(pageUrl);
    if (pageNumber && pageNumber >= 1) {
      pages.set(pageNumber, pageUrl);
    }
  }

  const totalPages = searchResultPageCount(parsed.totalCount, parsed.results.length);
  if (totalPages) {
    for (let pageNumber = 1; pageNumber < totalPages; pageNumber += 1) {
      if (!pages.has(pageNumber)) {
        pages.set(pageNumber, pagedSearchUrl(searchUrl, pageNumber));
      }
    }
  }

  const additionalPageLimit = Number.isFinite(maxPages)
    ? Math.max(0, Math.floor(maxPages) - 1)
    : Infinity;

  return [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, additionalPageLimit)
    .map(([, url]) => url);
}

function parseBbsSearchResults(html, { forumId, forumName, searchUrl }) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const seen = new Set();
  const results = [];
  const pageInfo = $('td.cnLarge').toArray()
    .map((element) => cleanText($(element).text()))
    .find((text) => text.includes('页次') && text.includes('每页')) || '';

  $('td.cnLarge').each((index, cell) => {
    const selected = $(cell);
    const anchors = selected.find('a[href]').toArray()
      .map((anchor) => {
        const href = absoluteUrl($(anchor).attr('href'), searchUrl);
        return {
          href,
          text: cleanText($(anchor).text())
        };
      })
      .filter((anchor) => anchor.href && postIdFromUrl(anchor.href)?.forumId === forumId);

    const titleAnchor = anchors.find((anchor) => anchor.text && anchor.text !== '•');
    if (!titleAnchor || seen.has(titleAnchor.href)) {
      return;
    }

    const ids = postIdFromUrl(titleAnchor.href);
    if (!ids) {
      return;
    }

    seen.add(titleAnchor.href);
    const rowText = cleanText(selected.text());
    const rowForum = (rowText.match(/\[([^\]]+)\]/) || [])[1] || forumName;
    const bytesMatch = rowText.match(/\((\d+)\s*bytes/i);

    results.push({
      id: `${ids.forumId}-${ids.postId}`,
      title: titleAnchor.text,
      sourceUrl: titleAnchor.href,
      sourceCreatedAt: cleanText(selected.find('i').last().text()) || '',
      author: cleanText(selected.find('strong em').first().text()),
      forumId: ids.forumId,
      forumName: rowForum,
      isReply: rowText.includes('#跟帖#'),
      bytes: bytesMatch ? Number(bytesMatch[1]) : null,
      summary: rowText
    });
  });

  return {
    pageInfo,
    totalCount: parseResultCount(pageInfo),
    results
  };
}

async function inspectBbs(profile, startUrl) {
  const html = await fetchHtml(startUrl || BBS_HOME_URL);
  const $ = cheerio.load(html);
  const forums = extractBbsForums($, startUrl || BBS_HOME_URL);
  if (!forums.length) {
    throw new Error('No Wenxuecity BBS forums were found.');
  }

  return {
    mode: 'bbs',
    profile: {
      id: profile.id,
      name: profile.name
    },
    blog: {
      id: 'bbs',
      name: '文学城论坛',
      homeUrl: BBS_HOME_URL,
      profileId: profile.id,
      profileName: profile.name
    },
    forums,
    defaultForumId: forums.some((forum) => forum.id === DEFAULT_FORUM_ID) ? DEFAULT_FORUM_ID : forums[0].id
  };
}

async function searchBbs({ forumId, forumName, keyword, searchMode, maxPages = Infinity, maxResults = Infinity }) {
  const cleanForumId = cleanText(forumId);
  const cleanKeyword = cleanText(keyword);
  const cleanSearchMode = searchMode === 'title' ? 'title' : 'author';
  if (!cleanForumId) {
    throw new Error('Choose a BBS forum.');
  }
  if (!cleanKeyword) {
    throw new Error('Enter a BBS search keyword.');
  }

  const searchUrl = bbsSearchUrl({
    forumId: cleanForumId,
    keyword: cleanKeyword,
    searchMode: cleanSearchMode
  });
  const cookieJar = new Map();
  const html = await fetchHtmlWithRetry(searchUrl, undefined, cookieJar);
  const $ = cheerio.load(html, { decodeEntities: false });
  const parsed = parseBbsSearchResults(html, {
    forumId: cleanForumId,
    forumName: cleanText(forumName),
    searchUrl
  });

  const additionalPageUrls = additionalSearchPageUrls($, searchUrl, parsed, maxPages);
  let pagesFetched = 1;
  for (const pageUrl of additionalPageUrls) {
    if (parsed.results.length >= maxResults) {
      break;
    }
    const pageHtml = await fetchHtmlWithRetry(pageUrl, searchUrl, cookieJar);
    const pageParsed = parseBbsSearchResults(pageHtml, {
      forumId: cleanForumId,
      forumName: cleanText(forumName),
      searchUrl: pageUrl
    });
    parsed.results.push(...pageParsed.results);
    pagesFetched += 1;
  }

  const seenUrls = new Set();
  parsed.results = parsed.results.filter((result) => {
    if (seenUrls.has(result.sourceUrl)) {
      return false;
    }
    seenUrls.add(result.sourceUrl);
    return true;
  }).slice(0, maxResults);

  return {
    searchUrl,
    forumId: cleanForumId,
    forumName: cleanText(forumName),
    keyword: cleanKeyword,
    searchMode: cleanSearchMode,
    pagesFetched,
    ...parsed
  };
}

module.exports = {
  inspectBbs,
  searchBbs
};
