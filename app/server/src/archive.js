const archiver = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const paths = require('./paths');
const { toUrlPath } = require('./assets');

const BLOGS_FILE = path.join(paths.archiveDataDir, 'blogs.json');
const RUNS_FILE = path.join(paths.archiveDataDir, 'runs.json');
const WENXUECITY_BLOG_NAME_SUFFIX = ' - 文学城博客';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value, fallback = 'page') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 72);
  return slug || fallback;
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
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

function normalizeSourceCreatedAt(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function displayBlogName(blog) {
  const name = String(blog?.name || '').trim();
  if (!name) {
    return name;
  }

  if (blog?.profileId === 'wenxuecity') {
    const hasEnding = name.endsWith(WENXUECITY_BLOG_NAME_SUFFIX);
    return hasEnding ? name : `${name}${WENXUECITY_BLOG_NAME_SUFFIX}`;
  }

  return name;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function blogFolderName(blog) {
  const suffix = blog.id || shortHash(blog.homeUrl || blog.name);
  return `${slugify(blog.name, 'blog')}-${suffix}`;
}

function categoryFolderName(category) {
  const suffix = category.id || shortHash(category.url || category.name);
  return `${slugify(category.name, 'category')}-${suffix}`;
}

function detailPageSlug(title, sourceUrl) {
  return `${slugify(title, 'page')}-${shortHash(sourceUrl)}`;
}

function archiveRelativePath(filePath) {
  return toUrlPath(path.relative(paths.archiveDir, filePath));
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readBlogs() {
  return readJson(BLOGS_FILE, []);
}

async function readLegacyRuns() {
  return readJson(RUNS_FILE, []);
}

async function writeBlogs(blogs) {
  await writeJson(BLOGS_FILE, blogs);
}

function createCategoryArchiveContext({ profile, homeUrl, blog, category }) {
  const blogDirName = blogFolderName(blog);
  const categoryDirName = categoryFolderName(category);
  const blogRootDir = path.join(paths.archiveBlogsDir, blogDirName);
  const categoryRootDir = path.join(blogRootDir, categoryDirName);

  return {
    profile,
    homeUrl,
    blog,
    category,
    blogDirName,
    categoryDirName,
    blogRootDir,
    categoryRootDir,
    pagesDir: path.join(categoryRootDir, 'pages'),
    assetsDir: path.join(categoryRootDir, 'assets'),
    manifestPath: path.join(categoryRootDir, 'manifest.json'),
    blogIndexPath: path.join(blogRootDir, 'index.html'),
    categoryIndexPath: path.join(categoryRootDir, 'index.html')
  };
}

function detailPageDir(categoryArchive, title, sourceUrl) {
  return path.join(categoryArchive.pagesDir, detailPageSlug(title, sourceUrl));
}

function defaultManifest(categoryArchive) {
  const createdAt = new Date().toISOString();
  return {
    version: 2,
    createdAt,
    updatedAt: createdAt,
    profileId: categoryArchive.profile.id,
    profileName: categoryArchive.profile.name,
    homeUrl: categoryArchive.homeUrl,
    blog: {
      id: categoryArchive.blog.id || '',
      name: categoryArchive.blog.name || '博客',
      homeUrl: categoryArchive.blog.homeUrl || categoryArchive.homeUrl,
      archivePath: archiveRelativePath(categoryArchive.blogIndexPath)
    },
    category: {
      id: categoryArchive.category.id || '',
      name: categoryArchive.category.name || '分类',
      url: categoryArchive.category.url,
      count: Number.isFinite(categoryArchive.category.count) ? categoryArchive.category.count : null,
      archivePath: archiveRelativePath(categoryArchive.categoryIndexPath)
    },
    pages: []
  };
}

async function readCategoryManifest(categoryArchive) {
  const manifest = await readJson(categoryArchive.manifestPath, null);
  if (!manifest) {
    return defaultManifest(categoryArchive);
  }

  return {
    ...defaultManifest(categoryArchive),
    ...manifest,
    blog: {
      ...defaultManifest(categoryArchive).blog,
      ...(manifest.blog || {})
    },
    category: {
      ...defaultManifest(categoryArchive).category,
      ...(manifest.category || {})
    },
    pages: Array.isArray(manifest.pages) ? manifest.pages : []
  };
}

function archiveCss() {
  return `
    :root { color-scheme: light; --ink: #222; --muted: #5c6670; --line: #d8dde4; --bg: #f6f7f9; --paper: #fff; --accent: #1769aa; --warm: #9b5d16; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; color: var(--ink); background: var(--bg); }
    header { border-bottom: 1px solid var(--line); background: var(--paper); }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 24px; }
    h1 { font-size: clamp(28px, 5vw, 44px); line-height: 1.08; margin: 0 0 10px; letter-spacing: 0; }
    h2 { font-size: 24px; margin: 28px 0 12px; letter-spacing: 0; }
    p { line-height: 1.6; }
    a { color: var(--accent); }
    .muted { color: var(--muted); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .button { display: inline-flex; align-items: center; min-height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); text-decoration: none; font-weight: 600; }
    .search-panel { max-width: 680px; margin-top: 18px; }
    .search-field { display: flex; align-items: center; min-height: 44px; border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 0 12px; }
    .search-field input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; }
    .search-field input::placeholder { color: var(--muted); }
    .search-status { min-height: 20px; margin-top: 8px; color: var(--muted); font-size: 14px; }
    .search-results { display: grid; gap: 12px; margin-top: 20px; }
    .search-results[hidden], .archive-list[hidden] { display: none; }
    .search-result h2 { font-size: 20px; }
    .list { display: grid; gap: 12px; margin-top: 20px; }
    .item { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .item h2, .item h3 { margin: 0 0 8px; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--muted); font-size: 14px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    article { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: min(5vw, 34px); overflow-wrap: anywhere; }
    article img, article video { max-width: 100%; height: auto; }
    article audio { display: block; width: min(100%, 620px); height: 42px; margin: 12px 0; }
    .archived-content { line-height: 1.65; }
    .archived-content iframe { display: block; width: min(100%, 760px); aspect-ratio: 16 / 9; height: auto; border: 0; margin: 18px 0; background: #000; }
    .archived-content script { display: none !important; }
    .archived-comments { margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--line); }
    .archived-comments .commentsTitle { margin-bottom: 8px; padding: 8px 10px; background: var(--warm); color: #fff; font-weight: 700; }
    .archived-comments .comment { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line); }
    .archived-comments .comment-l img { width: 64px !important; max-width: 64px; height: auto; }
    .archived-comments .comment_username { font-weight: 700; margin-right: 10px; }
    .archived-comments .comment_dateline { color: var(--muted); font-size: 14px; }
    .archived-comments .comment_msgbody { display: block; margin-top: 8px; }
    .archived-comments .BLK_j_linedot1 { display: none; }
    @media (max-width: 560px) { .archived-comments .comment { grid-template-columns: 1fr; } }
    footer { color: var(--muted); font-size: 13px; padding: 28px 0; }
  `;
}

function pageShell({ title, body, extraHead = '' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${archiveCss()}</style>
  ${extraHead}
</head>
<body>
${body}
</body>
</html>
`;
}

function sortByUpdatedAtDescending(items) {
  return items.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function pageDescendingSortKey(page) {
  return normalizeSourceCreatedAt(page.sourceCreatedAt) || String(page.capturedAt || '');
}

function sortPagesByCreatedDescending(pages) {
  return pages.slice().sort((a, b) => {
    const byDate = pageDescendingSortKey(b).localeCompare(pageDescendingSortKey(a));
    if (byDate) {
      return byDate;
    }
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function pageCountLabel(count) {
  return `${count} 个已保存页面`;
}

function assetCountLabel(count) {
  return `${count} 个资源`;
}

function sourceCreatedAtMeta(value) {
  const sourceCreatedAt = normalizeSourceCreatedAt(value);
  return sourceCreatedAt ? `<span>原文时间 ${escapeHtml(sourceCreatedAt)}</span>` : '';
}

function sourceCreatedAtParagraph(value) {
  const sourceCreatedAt = normalizeSourceCreatedAt(value);
  return sourceCreatedAt ? `<p class="muted source-created-at">原文时间 ${escapeHtml(sourceCreatedAt)}</p>` : '';
}

function categoryDisplayName(manifest) {
  return `${displayBlogName(manifest.blog)} - ${manifest.category.name}`;
}

function renderBlogArchiveCard(blog) {
  const categories = Array.isArray(blog.categories) ? blog.categories : [];
  const pageCount = categories.reduce((total, category) => total + Number(category.pageCount || 0), 0);

  return `
      <section class="item">
        <h2><a href="${escapeHtml(blog.archivePath)}">${escapeHtml(displayBlogName(blog))}</a></h2>
        <p class="muted">${escapeHtml(blog.homeUrl)}</p>
        <div class="meta">
          <span>${categories.length} 个分类</span>
          <span>${pageCountLabel(pageCount)}</span>
          <span>更新 ${escapeHtml(blog.updatedAt ? new Date(blog.updatedAt).toLocaleString() : '')}</span>
        </div>
      </section>
    `;
}

function renderLegacyRunCard(run) {
  const pages = Array.isArray(run.pages) ? run.pages : [];
  const updatedAt = run.finishedAt || run.startedAt;

  return `
      <section class="item">
        <h2><a href="${escapeHtml(run.categoryPath)}">${escapeHtml(run.name)}</a></h2>
        <p class="muted">${escapeHtml(run.startUrl)}</p>
        <div class="meta">
          <span>${escapeHtml(run.profileName || '旧版备份')}</span>
          <span>${pageCountLabel(pages.length)}</span>
          <span>旧版归档</span>
          <span>${escapeHtml(updatedAt ? new Date(updatedAt).toLocaleString() : '')}</span>
        </div>
      </section>
    `;
}

function escapeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function buildArchiveSearchItems(blogs) {
  const items = [];

  for (const blog of blogs) {
    const categories = Array.isArray(blog.categories) ? blog.categories : [];
    for (const category of categories) {
      if (!category.manifestPath) {
        continue;
      }

      const manifest = await readJson(path.join(paths.archiveDir, category.manifestPath), null);
      const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
      const categoryArchivePath = category.archivePath || manifest?.category?.archivePath || '';
      const categoryDir = categoryArchivePath ? path.posix.dirname(categoryArchivePath) : path.posix.dirname(category.manifestPath);
      const blogDisplay = displayBlogName({ ...blog, ...(manifest?.blog || {}) });
      const categoryName = manifest?.category?.name || category.name || '';

      for (const page of pages) {
        if (!page?.title || !page?.path) {
          continue;
        }

        items.push({
          title: String(page.title),
          href: toUrlPath(path.posix.join(categoryDir, page.path)),
          blogName: blogDisplay,
          categoryName: String(categoryName),
          sourceUrl: String(page.sourceUrl || ''),
          sourceCreatedAt: normalizeSourceCreatedAt(page.sourceCreatedAt),
          capturedAt: String(page.capturedAt || '')
        });
      }
    }
  }

  return sortPagesByCreatedDescending(items);
}

function buildCategorySearchItems(manifest) {
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  const blogName = displayBlogName(manifest.blog);
  const categoryName = manifest.category?.name || '';

  return sortPagesByCreatedDescending(pages)
    .filter((page) => page?.title && page?.path)
    .map((page) => ({
      title: String(page.title),
      href: String(page.path),
      blogName,
      categoryName: String(categoryName),
      sourceUrl: String(page.sourceUrl || ''),
      sourceCreatedAt: normalizeSourceCreatedAt(page.sourceCreatedAt),
      capturedAt: String(page.capturedAt || '')
    }));
}

function archiveSearchScript(searchItems) {
  return `
    <script id="archive-search-data" type="application/json">${escapeScriptJson(searchItems)}</script>
    <script>
      (() => {
        const input = document.querySelector('#archive-search');
        const results = document.querySelector('#archive-search-results');
        const status = document.querySelector('#archive-search-status');
        const archiveList = document.querySelector('#archive-list');
        const data = document.querySelector('#archive-search-data');
        if (!input || !results || !status || !archiveList || !data) {
          return;
        }

        let pages = [];
        try {
          pages = JSON.parse(data.textContent || '[]');
        } catch {
          pages = [];
        }

        const normalize = (value) => String(value || '').toLocaleLowerCase();

        function appendText(parent, className, text) {
          const element = document.createElement('p');
          element.className = className;
          element.textContent = text;
          parent.appendChild(element);
        }

        function appendMeta(meta, text) {
          if (!text) {
            return;
          }
          const span = document.createElement('span');
          span.textContent = text;
          meta.appendChild(span);
        }

        function renderResult(item) {
          const section = document.createElement('section');
          section.className = 'item search-result';

          const heading = document.createElement('h2');
          const link = document.createElement('a');
          link.href = item.href;
          link.textContent = item.title || '未命名页面';
          heading.appendChild(link);
          section.appendChild(heading);

          const location = [item.blogName, item.categoryName].filter(Boolean).join(' / ');
          if (location) {
            appendText(section, 'muted', location);
          }

          if (item.sourceUrl) {
            appendText(section, 'muted', item.sourceUrl);
          }

          const meta = document.createElement('div');
          meta.className = 'meta';
          appendMeta(meta, item.sourceCreatedAt ? '原文时间 ' + item.sourceCreatedAt : '');
          appendMeta(meta, item.capturedAt ? '归档 ' + new Date(item.capturedAt).toLocaleString() : '');
          if (meta.children.length) {
            section.appendChild(meta);
          }

          return section;
        }

        function renderSearch() {
          const query = normalize(input.value).trim();
          results.replaceChildren();

          if (!query) {
            results.hidden = true;
            archiveList.hidden = false;
            status.textContent = '';
            return;
          }

          const matches = pages.filter((item) => normalize(item.title).includes(query));
          archiveList.hidden = true;
          results.hidden = false;
          status.textContent = matches.length + ' 个标题匹配';

          if (!matches.length) {
            const empty = document.createElement('section');
            empty.className = 'item';
            const heading = document.createElement('h2');
            heading.textContent = '没有匹配的页面标题';
            empty.appendChild(heading);
            results.appendChild(empty);
            return;
          }

          const fragment = document.createDocumentFragment();
          matches.forEach((item) => fragment.appendChild(renderResult(item)));
          results.appendChild(fragment);
        }

        input.addEventListener('input', renderSearch);
        renderSearch();
      })();
    </script>
  `;
}

async function renderArchiveIndex() {
  const blogs = await readBlogs();
  const legacyRuns = (await readLegacyRuns())
    .filter((run) => run && run.categoryPath)
    .map((run) => ({
      ...run,
      updatedAt: run.finishedAt || run.startedAt
    }));
  const searchItems = await buildArchiveSearchItems(blogs);
  const items = [
    ...sortByUpdatedAtDescending(blogs).map(renderBlogArchiveCard),
    ...sortByUpdatedAtDescending(legacyRuns).map(renderLegacyRunCard)
  ].join('');

  const body = `
    <header>
      <div class="wrap">
        <h1>离线阅读归档</h1>
        <p class="muted">保存在本机的离线文章和论坛帖子。</p>
        <div class="search-panel" role="search">
          <label class="sr-only" for="archive-search">搜索页面标题</label>
          <div class="search-field">
            <input id="archive-search" type="search" placeholder="搜索页面标题" autocomplete="off" spellcheck="false">
          </div>
          <div id="archive-search-status" class="search-status" aria-live="polite"></div>
        </div>
      </div>
    </header>
    <main class="wrap">
      <div id="archive-search-results" class="search-results" hidden></div>
      <div id="archive-list" class="list archive-list">
        ${items || '<section class="item"><h2>还没有备份</h2><p class="muted">完成下载后，已保存的分类会显示在这里。</p></section>'}
      </div>
    </main>
    ${archiveSearchScript(searchItems)}
  `;

  await fsp.writeFile(path.join(paths.archiveDir, 'index.html'), pageShell({ title: '离线阅读归档', body }));
}

async function renderBlogIndex(blogSummary) {
  const items = sortByUpdatedAtDescending(blogSummary.categories)
    .map((category) => `
      <section class="item">
        <h2><a href="${escapeHtml(path.posix.relative(path.posix.dirname(blogSummary.archivePath), category.archivePath) || 'index.html')}">${escapeHtml(category.name)}</a></h2>
        <p class="muted">${escapeHtml(category.sourceUrl)}</p>
        <div class="meta">
          <span>${pageCountLabel(category.pageCount)}</span>
          ${Number.isFinite(category.sourceCount) ? `<span>源站列出 ${category.sourceCount} 篇</span>` : ''}
          <span>更新 ${escapeHtml(category.updatedAt ? new Date(category.updatedAt).toLocaleString() : '')}</span>
        </div>
      </section>
    `)
    .join('');

  const body = `
    <header>
      <div class="wrap">
        <h1>${escapeHtml(displayBlogName(blogSummary))}</h1>
        <p class="muted">${escapeHtml(blogSummary.homeUrl)}</p>
        <div class="toolbar">
          <a class="button" href="../../index.html">归档首页</a>
          <a class="button" href="${escapeHtml(blogSummary.homeUrl)}">原博客</a>
        </div>
      </div>
    </header>
    <main class="wrap">
      <div class="list">
        ${items || '<section class="item"><h2>还没有保存分类</h2></section>'}
      </div>
    </main>
  `;

  await fsp.mkdir(path.dirname(path.join(paths.archiveDir, blogSummary.archivePath)), { recursive: true });
  await fsp.writeFile(path.join(paths.archiveDir, blogSummary.archivePath), pageShell({ title: displayBlogName(blogSummary), body }));
}

async function renderCategoryPage(categoryArchive, manifest) {
  const blogIndexHref = toUrlPath(path.relative(categoryArchive.categoryRootDir, categoryArchive.blogIndexPath)) || '../index.html';
  const searchItems = buildCategorySearchItems(manifest);
  const items = sortPagesByCreatedDescending(manifest.pages)
    .map((page) => `
      <section class="item">
        <h2><a href="${escapeHtml(page.path)}">${escapeHtml(page.title)}</a></h2>
        <p class="muted">${escapeHtml(page.sourceUrl)}</p>
        <div class="meta">
          ${sourceCreatedAtMeta(page.sourceCreatedAt)}
          <span>归档 ${escapeHtml(new Date(page.capturedAt).toLocaleString())}</span>
          <span>${assetCountLabel(page.assets.length)}</span>
        </div>
      </section>
    `)
    .join('');

  const body = `
    <header>
      <div class="wrap">
        <h1>${escapeHtml(categoryDisplayName(manifest))}</h1>
        <p class="muted">${escapeHtml(manifest.category.url)}</p>
        <div class="toolbar">
          <a class="button" href="${escapeHtml(blogIndexHref)}">博客目录</a>
          <a class="button" href="${escapeHtml(manifest.category.url)}">原分类</a>
        </div>
        <div class="search-panel" role="search">
          <label class="sr-only" for="archive-search">搜索页面标题</label>
          <div class="search-field">
            <input id="archive-search" type="search" placeholder="搜索页面标题" autocomplete="off" spellcheck="false">
          </div>
          <div id="archive-search-status" class="search-status" aria-live="polite"></div>
        </div>
      </div>
    </header>
    <main class="wrap">
      <div id="archive-search-results" class="search-results" hidden></div>
      <div id="archive-list" class="list archive-list">
        ${items || '<section class="item"><h2>还没有保存页面</h2></section>'}
      </div>
    </main>
    ${archiveSearchScript(searchItems)}
  `;

  await fsp.writeFile(categoryArchive.categoryIndexPath, pageShell({ title: categoryDisplayName(manifest), body }));
}

async function upsertBlogCategory(manifest) {
  const blogs = await readBlogs();
  const blogIndex = blogs.findIndex((candidate) => candidate.id === manifest.blog.id);
  const blogSummary = blogIndex >= 0 ? blogs[blogIndex] : {
    id: manifest.blog.id,
    name: manifest.blog.name,
    homeUrl: manifest.blog.homeUrl,
    profileId: manifest.profileId,
    profileName: manifest.profileName,
    archivePath: manifest.blog.archivePath,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    categories: []
  };

  blogSummary.name = manifest.blog.name;
  blogSummary.homeUrl = manifest.blog.homeUrl;
  blogSummary.profileId = manifest.profileId;
  blogSummary.profileName = manifest.profileName;
  blogSummary.archivePath = manifest.blog.archivePath;
  blogSummary.updatedAt = manifest.updatedAt;

  const categorySummary = {
    id: manifest.category.id,
    name: manifest.category.name,
    sourceUrl: manifest.category.url,
    sourceCount: manifest.category.count,
    archivePath: manifest.category.archivePath,
    manifestPath: `${path.posix.dirname(manifest.category.archivePath)}/manifest.json`,
    pageCount: manifest.pages.length,
    updatedAt: manifest.updatedAt
  };

  const categoryIndex = blogSummary.categories.findIndex((candidate) => candidate.id === categorySummary.id);
  if (categoryIndex >= 0) {
    blogSummary.categories[categoryIndex] = categorySummary;
  } else {
    blogSummary.categories.push(categorySummary);
  }

  blogSummary.categories = sortByUpdatedAtDescending(blogSummary.categories);

  if (blogIndex >= 0) {
    blogs[blogIndex] = blogSummary;
  } else {
    blogs.push(blogSummary);
  }

  await writeBlogs(sortByUpdatedAtDescending(blogs));
  await renderBlogIndex(blogSummary);
  await renderArchiveIndex();
  return blogSummary;
}

async function writeCategoryManifest(categoryArchive, manifest) {
  manifest.updatedAt = new Date().toISOString();
  await writeJson(categoryArchive.manifestPath, manifest);
}

async function syncCategoryArchive(categoryArchive, manifest) {
  manifest.pages = sortPagesByCreatedDescending(manifest.pages);
  await writeCategoryManifest(categoryArchive, manifest);
  await renderCategoryPage(categoryArchive, manifest);
  await upsertBlogCategory(manifest);
}

async function ensureArchiveBase() {
  await paths.ensureDirs();
  if (!fs.existsSync(BLOGS_FILE)) {
    await writeBlogs([]);
  }
  await renderArchiveIndex();
}

async function renderAllCategoryIndexes() {
  const blogs = await readBlogs();

  for (const blog of blogs) {
    const categories = Array.isArray(blog.categories) ? blog.categories : [];
    for (const category of categories) {
      if (!category.manifestPath) {
        continue;
      }

      const manifest = await readJson(path.join(paths.archiveDir, category.manifestPath), null);
      if (!manifest?.category?.archivePath || !manifest?.blog?.archivePath) {
        continue;
      }

      const categoryIndexPath = path.join(paths.archiveDir, manifest.category.archivePath);
      await renderCategoryPage({
        categoryRootDir: path.dirname(categoryIndexPath),
        categoryIndexPath,
        blogIndexPath: path.join(paths.archiveDir, manifest.blog.archivePath)
      }, manifest);
    }
  }
}

async function renderAllBlogIndexes() {
  const blogs = await readBlogs();

  for (const blog of blogs) {
    await renderBlogIndex(blog);
  }
}

async function openCategoryArchive({ profile, homeUrl, blog, category }) {
  await ensureArchiveBase();
  const categoryArchive = createCategoryArchiveContext({ profile, homeUrl, blog, category });

  await fsp.mkdir(categoryArchive.pagesDir, { recursive: true });
  await fsp.mkdir(categoryArchive.assetsDir, { recursive: true });

  const manifest = await readCategoryManifest(categoryArchive);
  manifest.profileId = profile.id;
  manifest.profileName = profile.name;
  manifest.homeUrl = homeUrl;
  manifest.blog = {
    id: blog.id || manifest.blog.id || shortHash(homeUrl),
      name: blog.name || manifest.blog.name || '博客',
    homeUrl: blog.homeUrl || homeUrl,
    archivePath: archiveRelativePath(categoryArchive.blogIndexPath)
  };
  manifest.category = {
    id: category.id || manifest.category.id || shortHash(category.url),
    name: category.name || manifest.category.name || '分类',
    url: category.url,
    count: Number.isFinite(category.count) ? category.count : manifest.category.count,
    archivePath: archiveRelativePath(categoryArchive.categoryIndexPath)
  };

  categoryArchive.manifest = manifest;
  await syncCategoryArchive(categoryArchive, manifest);
  return categoryArchive;
}

async function saveDetailPage(categoryArchive, detail) {
  const manifest = categoryArchive.manifest;
  const pageDir = detailPageDir(categoryArchive, detail.title, detail.sourceUrl);
  await fsp.mkdir(pageDir, { recursive: true });
  const sourceCreatedAt = normalizeSourceCreatedAt(detail.sourceCreatedAt);

  const metadata = {
    sourceUrl: detail.sourceUrl,
    sourceCreatedAt,
    title: detail.title,
    capturedAt: detail.capturedAt,
    profileId: manifest.profileId,
    profileName: manifest.profileName,
    homeUrl: manifest.homeUrl,
    blog: manifest.blog,
    category: manifest.category,
    commentsArchived: Boolean(detail.commentsArchived),
    assets: detail.assets.map((asset) => ({
      sourceUrl: asset.sourceUrl,
      fetchedUrl: asset.fetchedUrl,
      fileName: asset.fileName,
      contentType: asset.contentType,
      bytes: asset.bytes
    }))
  };

  await fsp.writeFile(path.join(pageDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  const categoryHref = toUrlPath(path.relative(pageDir, categoryArchive.categoryIndexPath)) || 'index.html';
  const body = `
    <header>
      <div class="wrap">
        <h1>${escapeHtml(detail.title)}</h1>
        <p class="muted">${escapeHtml(detail.sourceUrl)}</p>
        ${sourceCreatedAtParagraph(sourceCreatedAt)}
        <div class="toolbar">
          <a class="button" href="${escapeHtml(categoryHref)}">分类目录</a>
          <a class="button" href="${escapeHtml(detail.sourceUrl)}">原页面</a>
        </div>
      </div>
    </header>
    <main class="wrap">
      <article>
        <div class="archived-content">
          ${detail.html}
        </div>
      </article>
      <footer>归档于 ${escapeHtml(new Date(detail.capturedAt).toLocaleString())}</footer>
    </main>
  `;

  await fsp.writeFile(path.join(pageDir, 'index.html'), pageShell({ title: detail.title, body }));

  const pageRecord = {
    title: detail.title,
    sourceUrl: detail.sourceUrl,
    sourceCreatedAt,
    capturedAt: detail.capturedAt,
    commentsArchived: Boolean(detail.commentsArchived),
    path: toUrlPath(path.relative(categoryArchive.categoryRootDir, path.join(pageDir, 'index.html'))),
    metadataPath: toUrlPath(path.relative(categoryArchive.categoryRootDir, path.join(pageDir, 'metadata.json'))),
    assets: metadata.assets
  };

  const normalizedDetailUrl = normalizeSourceUrl(detail.sourceUrl);
  const existingIndex = manifest.pages.findIndex((page) => normalizeSourceUrl(page.sourceUrl) === normalizedDetailUrl);
  if (existingIndex >= 0) {
    manifest.pages[existingIndex] = pageRecord;
  } else {
    manifest.pages.push(pageRecord);
  }

  await syncCategoryArchive(categoryArchive, manifest);
  return pageRecord;
}

function updateDetailPageSourceCreatedAtHtml(html, sourceUrl, sourceCreatedAt) {
  const withoutExisting = String(html || '').replace(/\n?\s*<p class="muted source-created-at">[^<]*<\/p>/, '');
  const sourceLine = `<p class="muted">${escapeHtml(sourceUrl)}</p>`;
  if (!sourceCreatedAt || !withoutExisting.includes(sourceLine)) {
    return withoutExisting;
  }

  return withoutExisting.replace(sourceLine, `${sourceLine}\n        ${sourceCreatedAtParagraph(sourceCreatedAt)}`);
}

function updateSavedPageSourceCreatedAt(categoryArchive, sourceUrl, value) {
  const sourceCreatedAt = normalizeSourceCreatedAt(value);
  if (!sourceCreatedAt) {
    return false;
  }

  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  const pageRecord = categoryArchive.manifest.pages.find((page) => normalizeSourceUrl(page.sourceUrl) === normalizedSourceUrl);
  if (!pageRecord || pageRecord.sourceCreatedAt === sourceCreatedAt) {
    return false;
  }

  pageRecord.sourceCreatedAt = sourceCreatedAt;

  const metadataPath = path.join(categoryArchive.categoryRootDir, pageRecord.metadataPath || '');
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.sourceCreatedAt = sourceCreatedAt;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  } catch {
    // Older or partial archives may not have metadata available; keep the manifest update.
  }

  const detailPath = path.join(categoryArchive.categoryRootDir, pageRecord.path || '');
  try {
    const html = fs.readFileSync(detailPath, 'utf8');
    const updatedHtml = updateDetailPageSourceCreatedAtHtml(html, pageRecord.sourceUrl, sourceCreatedAt);
    if (updatedHtml !== html) {
      fs.writeFileSync(detailPath, updatedHtml);
    }
  } catch {
    // Detail HTML is best-effort for skipped pages.
  }

  return true;
}

async function finishCategoryArchive(categoryArchive) {
  await syncCategoryArchive(categoryArchive, categoryArchive.manifest);
}

async function getCategoryArchiveSummary(blog, category) {
  const profile = { id: 'wenxuecity', name: 'Wenxuecity Blog' };
  const context = createCategoryArchiveContext({
    profile,
    homeUrl: blog.homeUrl,
    blog,
    category
  });
  const manifest = await readJson(context.manifestPath, null);

  return {
    archivedCount: Array.isArray(manifest?.pages) ? manifest.pages.length : 0,
    archivePath: archiveRelativePath(context.categoryIndexPath),
    lastArchivedAt: manifest?.updatedAt || null
  };
}

async function exportArchiveZip() {
  await ensureArchiveBase();
  await paths.ensureDir(paths.exportsDir);
  const fileName = `BlogArchive-${nowStamp()}.zip`;
  const destination = path.join(paths.exportsDir, fileName);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('warning', (error) => {
      if (error.code === 'ENOENT') {
        return;
      }
      reject(error);
    });
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(paths.archiveDir, false);
    archive.finalize();
  });

  return {
    fileName,
    path: destination
  };
}

module.exports = {
  ensureArchiveBase,
  openCategoryArchive,
  saveDetailPage,
  finishCategoryArchive,
  exportArchiveZip,
  detailPageDir,
  slugify,
  renderAllCategoryIndexes,
  renderAllBlogIndexes,
  getCategoryArchiveSummary,
  updateSavedPageSourceCreatedAt
};
