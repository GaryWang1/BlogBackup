const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');

let browser, server, origin;
const posts = Array.from({ length: 7 }, (_, i) => ({
  id: `romance-${i + 1}`, title: `中秋记忆 ${i + 1}`, author: `作者${i + 1}`,
  sourceUrl: `https://bbs.wenxuecity.com/romance/${i + 1}.html`,
  publishedAt: Date.parse('2026-09-29T01:00:00Z') - i * 1000,
  sourceCreatedAt: '2026-09-29T01:00:00Z', forumId: 'romance', forumName: '爱的星空'
}));
const inspection = { mode: 'bbs', profile: { id: 'bbs', name: 'Wenxuecity BBS' }, blog: { name: '文学城论坛' }, forums: [{ id: 'romance', name: '爱的星空', url: 'https://bbs.wenxuecity.com/romance/' }, { id: 'music', name: '音乐快递', url: 'https://bbs.wenxuecity.com/music/' }], defaultForumId: 'romance' };

before(async () => {
  server = http.createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = name === '/' ? 'index.html' : name.slice(1);
    if (!['index.html', 'app.js', 'styles.css', 'recommend-template.js'].includes(file)) { res.writeHead(404).end(); return; }
    const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
    res.setHeader('content-type', `${types[file.split('.').pop()]}; charset=utf-8`);
    res.end(await fs.readFile(path.join(__dirname, '../app/public', file)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || chromium.executablePath() });
});
after(async () => { await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); });

async function setup(t, overrides = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  const searches = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    const json = (value) => route.fulfill({ json: value });
    if (pathname === '/api/health') return json({ ok: true });
    if (pathname === '/api/inspect') return json(inspection);
    if (pathname === '/api/bbs/search') {
      searches.push(body);
      if (overrides.search) return overrides.search(route, body);
      if (body.searchMode !== 'recommend') return json({ ...body, results: posts, totalCount: 7 });
      return json({ ...body, results: body.page === 1 ? posts : [], startedAt: '2026-09-29T19:00:00Z', windowStart: '2026-09-28T07:00:00Z', nextPage: body.page === 1 ? 2 : null, warnings: [] });
    }
    if (pathname === '/api/bbs/recommend') {
      if (overrides.recommend) return overrides.recommend(route, body);
      return json({ results: body.posts.map((p) => ({ ...posts.find((x) => x.sourceUrl === p.sourceUrl), reason: '以月饼和家人团聚的细节寄托乡愁，温暖细腻', error: '' })) });
    }
    return json({});
  });
  await page.goto(origin);
  await page.locator('input[name="source-type"][value="bbs"]').check();
  await page.locator('#bbs-forum').waitFor({ state: 'visible' });
  await page.locator('input[value="recommend"]').check();
  t.after(() => assert.deepEqual(errors, []));
  return { page, context, searches };
}

test('no search term required; all pages load; select 1–5; generate, edit and copy', async (t) => {
  const { page, context, searches } = await setup(t);
  assert.equal(await page.locator('#bbs-keyword-field').isVisible(), false);
  await page.locator('#bbs-search-button').click();
  await page.locator('#bbs-results-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bbs-results-list input').count(), 7);
  assert.equal(searches.length, 2);
  assert.ok(searches.every((r) => !r.keyword));
  assert.match(await page.locator('#bbs-search-summary').innerText(), /最近 36 小时共 7/);
  assert.equal(await page.locator('#bbs-search-window').innerText(), '检索范围：2026-09-28 00:00:00 至 2026-09-29 12:00:00（论坛时间／美西，共 36 小时）。');
  assert.match(await page.locator('#bbs-results-list .category-meta').first().innerText(), /2026-09-28 18:00:00（美西）/);
  assert.equal(await page.locator('#bbs-recommend-button').isDisabled(), true);
  for (let i = 0; i < 5; i++) await page.locator('#bbs-results-list input').nth(i).check();
  assert.equal(await page.locator('#bbs-results-list input').nth(5).isDisabled(), true);
  await page.locator('#bbs-results-list input').nth(4).uncheck();
  assert.equal(await page.locator('#bbs-results-list input').nth(5).isDisabled(), false);
  await page.locator('#bbs-recommend-button').click();
  await page.waitForFunction(() => document.querySelector('#recommend-letter').value.includes('温暖细腻'));
  assert.equal(await page.locator('#recommend-reasons textarea').count(), 4);
  await page.locator('#recommend-date').fill('2026-09-26');
  await page.locator('#recommend-date').dispatchEvent('change');
  await page.locator('#recommend-reasons textarea').first().fill('手动修改的推荐原因');
  let letter = await page.locator('#recommend-letter').inputValue();
  assert.match(letter, /9月26日的星坛优秀作品推荐/);
  assert.match(letter, /1，手动修改的推荐原因/);
  assert.equal(await page.locator('#recommend-letter').isVisible(), false);
  await page.locator('#recommend-reasons textarea').first().fill('稍后修改的原因');
  letter = await page.locator('#recommend-letter').inputValue();
  assert.match(letter, /稍后修改的原因/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#recommend-copy').click();
  await page.waitForFunction(() => document.querySelector('#recommend-copy-status').textContent.includes('已复制'));
  assert.equal(await page.locator('#recommend-letter-preview a').first().getAttribute('href'), 'https://bbs.wenxuecity.com/romance/1.html');
  const copiedHtml = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await items[0].getType('text/html')).text();
  });
  assert.match(copiedHtml, /href="https:\/\/bbs\.wenxuecity\.com\/romance\/1\.html"/);
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), letter);
  await fs.mkdir(path.join(__dirname, '../logs'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '../logs/recommend-desktop.png'), fullPage: true });
});

test('AI failure supports per-post retry and manual reason without losing text', async (t) => {
  let attempts = 0;
  const { page } = await setup(t, { recommend: (route, body) => route.fulfill({ json: { results: body.posts.map((p) => ({ sourceUrl: p.sourceUrl, reason: '', error: ++attempts === 1 ? '尚未配置 Gemini 免费层密钥' : '免费额度已用完' })) } }) });
  await page.locator('#bbs-search-button').click();
  await page.locator('#bbs-results-list input').first().check();
  await page.locator('#bbs-recommend-button').click();
  await page.locator('.recommend-error').waitFor();
  await page.locator('#recommend-reasons textarea').fill('手动保留的推荐原因');
  await page.getByText('重试此篇', { exact: true }).click();
  await page.getByText('免费额度已用完', { exact: true }).waitFor();
  assert.equal(await page.locator('#recommend-reasons textarea').inputValue(), '手动保留的推荐原因');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied'); } } }));
  await page.locator('#recommend-copy').click();
  await page.waitForFunction(() => document.querySelector('#recommend-copy-status').textContent.includes('Ctrl+C'));
});

test('keyword and author flows still show input and their original actions', async (t) => {
  const { page } = await setup(t);
  for (const [mode, action] of [['author', '#bbs-start-button'], ['title', '#bbs-collection-button']]) {
    await page.locator(`input[name="bbs-search-mode"][value="${mode}"]`).check();
    assert.equal(await page.locator('#bbs-keyword-field').isVisible(), true);
    await page.locator('#bbs-keyword').fill('作者');
    await page.locator('#bbs-search-button').click();
    await page.locator(action).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#bbs-results-list input:checked').count(), 7);
    assert.equal(await page.locator('#bbs-recommend-button').isVisible(), false);
  }
});

test('collection counts selected posts by ID and includes statistics in copied HTML', async (t) => {
  const { page } = await setup(t, { search: (route, body) => route.fulfill({ json: {
    ...body,
    results: posts.map((post, i) => ({ ...post, author: i < 4 ? '多帖作者' : '少帖作者' })), totalCount: 7
  } }) });
  await page.locator('input[name="bbs-search-mode"][value="title"]').check();
  await page.locator('#bbs-keyword').fill('中秋');
  await page.locator('#bbs-search-button').click();
  await page.locator('#bbs-results-list input').last().uncheck();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (html) => { window.collectionCopy = html; } } }));
  await page.locator('#bbs-collection-button').click();
  await page.waitForFunction(() => document.querySelector('.collection-copied-message')?.textContent.includes('已经复制'));
  assert.match(await page.locator('.collection-summary').innerText(), /本合集共 6 个帖子/);
  assert.deepEqual(await page.locator('.collection-summary li').allTextContents(), ['多帖作者：4 个帖子', '少帖作者：2 个帖子']);
  const copied = await page.evaluate(() => window.collectionCopy);
  assert.match(copied, /本合集共 6 个帖子/);
  assert.match(copied, /多帖作者：4 个帖子/);
});

test('a failed later page is shown as incomplete, with earlier results retained', async (t) => {
  const { page } = await setup(t, { search: (route, body) => body.page === 1
    ? route.fulfill({ json: { results: posts, nextPage: 2, startedAt: '2026-09-29T12:00:00Z', warnings: [] } })
    : route.fulfill({ status: 400, json: { error: '源站读取失败' } }) });
  await page.locator('#bbs-search-button').click();
  await page.locator('#bbs-results-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bbs-results-list input').count(), 7);
  assert.match(await page.locator('#bbs-search-summary').innerText(), /结果尚不完整/);
});

test('switching forum discards an in-flight result', async (t) => {
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  const { page } = await setup(t, { search: async (route) => { await paused; await route.fulfill({ json: { results: posts, nextPage: null, warnings: [] } }).catch(() => {}); } });
  await page.locator('#bbs-search-button').click();
  await page.locator('#bbs-forum').selectOption('music');
  release();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#bbs-results-panel').isVisible(), false);
  assert.equal(await page.locator('#bbs-search-button').isDisabled(), false);
});

test('narrow layout keeps mode choices and letter within viewport', async (t) => {
  const { page } = await setup(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#bbs-search-button').click();
  await page.locator('#bbs-results-list input').first().check();
  await page.locator('#bbs-recommend-button').click();
  await page.waitForFunction(() => document.querySelector('#recommend-letter').value.includes('温暖细腻'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await fs.mkdir(path.join(__dirname, '../logs'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '../logs/recommend-mobile.png'), fullPage: true });
});

test('switching modes discards an in-flight recommendation', async (t) => {
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  const { page } = await setup(t, { recommend: async (route, body) => {
    await paused;
    await route.fulfill({ json: { results: body.posts.map((p) => ({ ...p, reason: '不应显示的旧论坛推荐原因', error: '' })) } });
  } });
  await page.locator('#bbs-search-button').click();
  await page.locator('#bbs-results-list input').first().check();
  const pending = page.waitForRequest('**/api/bbs/recommend');
  await page.locator('#bbs-recommend-button').click();
  await pending;
  await page.locator('input[name="bbs-search-mode"][value="author"]').check();
  release();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#bbs-recommend-output').isVisible(), false);
  assert.equal(await page.locator('#recommend-letter').inputValue(), '');
  assert.equal(await page.locator('#status-pill').innerText(), '空闲');
});
