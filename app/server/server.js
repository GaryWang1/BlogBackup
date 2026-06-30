const childProcess = require('child_process');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

const paths = require('./src/paths');
const { listProfiles, getProfile, getProfileForUrl } = require('./src/profiles');
const { inspectBlog } = require('./src/blog-inspector');
const { searchBbs } = require('./src/bbs-inspector');
const { ensureArchiveBase, exportArchiveZip } = require('./src/archive');
const { createJobStore } = require('./src/jobs');

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || paths.browsersDir;

const app = express();
const port = Number(process.env.BLOG_BACKUP_PORT || 3000);
const jobs = createJobStore();

const serverLog = path.join(paths.logsDir, `server-${new Date().toISOString().slice(0, 10)}.log`);

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFile(serverLog, `${line}\n`, () => {});
}

function openBrowser(url) {
  const quotedUrl = url.replace(/"/g, '');
  try {
    if (process.platform === 'win32') {
      childProcess.exec(`start "" "${quotedUrl}"`);
    } else if (process.platform === 'darwin') {
      childProcess.exec(`open "${quotedUrl}"`);
    } else {
      childProcess.exec(`xdg-open "${quotedUrl}"`);
    }
  } catch (error) {
    log(`Could not open browser automatically: ${error.message}`);
  }
}

function readExistingHealth(url) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/health`, { timeout: 1500 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => {
      resolve(null);
    });
  });
}

function isThisBlogBackupInstance(health) {
  return Boolean(
    health &&
    health.ok === true &&
    path.resolve(String(health.archiveDir || '')) === paths.archiveDir
  );
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

  if (profile.id === 'bbs') {
    const pages = Array.isArray(category.pages) ? category.pages : [];
    sanitized.keyword = String(category.keyword || '').trim();
    sanitized.searchMode = category.searchMode === 'title' ? 'title' : 'author';
    sanitized.forum = category.forum && typeof category.forum === 'object' ? {
      id: String(category.forum.id || '').trim(),
      name: String(category.forum.name || '').trim(),
      url: String(category.forum.url || '').trim()
    } : null;
    sanitized.pages = pages.map(sanitizeBbsPage);
    sanitized.count = sanitized.pages.length;
  }

  return sanitized;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use('/', express.static(paths.publicDir));
app.use('/archive', express.static(paths.archiveDir, {
  extensions: ['html']
}));
app.use('/exports', express.static(paths.exportsDir));

app.get('/api/profiles', async (req, res) => {
  try {
    res.json({ profiles: await listProfiles() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inspect', async (req, res) => {
  try {
    const startUrl = String(req.body.startUrl || '').trim();
    if (!startUrl || !isHttpUrl(startUrl)) {
      return res.status(400).json({ error: 'Enter a full http:// or https:// URL.' });
    }

    const profile = await getProfileForUrl(startUrl);
    if (!profile) {
      return res.status(400).json({ error: 'No backup profiles are available.' });
    }

    const result = await inspectBlog({ profile, startUrl });
    res.json(result);
  } catch (error) {
    log(`Inspect failed: ${error.stack || error.message}`);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/bbs/search', async (req, res) => {
  try {
    const result = await searchBbs({
      forumId: req.body.forumId,
      forumName: req.body.forumName,
      keyword: req.body.keyword,
      searchMode: req.body.searchMode
    });
    res.json(result);
  } catch (error) {
    log(`BBS search failed: ${error.stack || error.message}`);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/start', async (req, res) => {
  try {
    const startUrl = String(req.body.startUrl || '').trim();
    const profile = req.body.profileId ? await getProfile(req.body.profileId) : await getProfileForUrl(startUrl);
    const categories = Array.isArray(req.body.categories) ? req.body.categories : [];
    const blog = req.body.blog && typeof req.body.blog === 'object' ? req.body.blog : null;
    const incremental = req.body.incremental !== false;
    const includeComments = req.body.includeComments === true;

    if (!startUrl || !isHttpUrl(startUrl)) {
      return res.status(400).json({ error: 'Enter a full http:// or https:// URL.' });
    }

    if (!profile) {
      return res.status(400).json({ error: 'No backup profiles are available.' });
    }

    if (!blog || !blog.name) {
      return res.status(400).json({ error: 'Inspect the source before starting a backup.' });
    }

    if (!categories.length) {
      return res.status(400).json({ error: 'Choose at least one category to back up.' });
    }

    const sanitizedCategories = categories.map((category) => sanitizeCategory(category, profile));

    if (sanitizedCategories.some((category) => !isHttpUrl(category.url))) {
      return res.status(400).json({ error: 'Every selected category needs a full http:// or https:// URL.' });
    }

    if (profile.id === 'bbs' && sanitizedCategories.some((category) => !category.pages.length)) {
      return res.status(400).json({ error: 'Choose at least one BBS search result to archive.' });
    }

    const job = jobs.start({
      profile,
      startUrl,
      blog,
      categories: sanitizedCategories,
      incremental,
      includeComments,
      log
    });
    res.json({ jobId: job.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  res.json(job.toJSON());
});

app.post('/api/export', async (req, res) => {
  try {
    const result = await exportArchiveZip();
    res.json({
      fileName: result.fileName,
      url: `/exports/${encodeURIComponent(result.fileName)}`
    });
  } catch (error) {
    log(`Export failed: ${error.stack || error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    port,
    archiveDir: paths.archiveDir,
    browsersDir: paths.browsersDir
  });
});

async function startServer() {
  await ensureArchiveBase();
  await paths.ensureDir(paths.logsDir);
  await paths.ensureDir(paths.exportsDir);

  const httpServer = app.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    log(`Blog Backup Tool listening on ${url}`);
    if (process.env.BLOG_BACKUP_NO_OPEN !== '1') {
      openBrowser(url);
    }
  });

  httpServer.on('error', async (error) => {
    if (error.code === 'EADDRINUSE') {
      const url = `http://localhost:${port}`;
      const health = await readExistingHealth(url);
      if (isThisBlogBackupInstance(health)) {
        log(`Blog Backup Tool is already running at ${url}`);
        if (process.env.BLOG_BACKUP_NO_OPEN !== '1') {
          openBrowser(url);
        }
        process.exitCode = 0;
        return;
      }

      log(`Server failed to start: ${error.message}`);
      console.error(`Port ${port} is already in use. Close the other app and start Blog Backup again.`);
      process.exitCode = 1;
      return;
    }

    log(`Server failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

startServer().catch((error) => {
  console.error(`Blog Backup cannot start: ${error.message}`);
  process.exit(1);
});
