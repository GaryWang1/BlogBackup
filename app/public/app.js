const inspectForm = document.querySelector('#inspect-form');
const startUrlInput = document.querySelector('#start-url');
const sourceTypeRadios = document.querySelectorAll('input[name="source-type"]');
const incrementalInput = document.querySelector('#incremental');
const includeCommentsInput = document.querySelector('#include-comments');
const downloadOptions = document.querySelector('#download-options');
const nextButton = document.querySelector('#next-button');
const categoryPanel = document.querySelector('#category-panel');
const categoryMode = document.querySelector('#category-mode');
const blogName = document.querySelector('#blog-name');
const profileName = document.querySelector('#profile-name');
const categoryList = document.querySelector('#category-list');
const selectAllButton = document.querySelector('#select-all');
const selectNoneButton = document.querySelector('#select-none');
const startButton = document.querySelector('#start-button');
const bbsMode = document.querySelector('#bbs-mode');
const bbsTitle = document.querySelector('#bbs-title');
const bbsProfileName = document.querySelector('#bbs-profile-name');
const bbsForum = document.querySelector('#bbs-forum');
const bbsKeyword = document.querySelector('#bbs-keyword');
const bbsSearchButton = document.querySelector('#bbs-search-button');
const bbsResultsPanel = document.querySelector('#bbs-results-panel');
const bbsSearchSummary = document.querySelector('#bbs-search-summary');
const bbsSearchWindow = document.querySelector('#bbs-search-window');
const bbsResultsList = document.querySelector('#bbs-results-list');
const bbsSelectAllButton = document.querySelector('#bbs-select-all');
const bbsSelectNoneButton = document.querySelector('#bbs-select-none');
const bbsStartButton = document.querySelector('#bbs-start-button');
const bbsCollectionButton = document.querySelector('#bbs-collection-button');
const bbsCollectionOutput = document.querySelector('#bbs-collection-output');
const bbsRecommendButton = document.querySelector('#bbs-recommend-button');
const bbsRecommendOutput = document.querySelector('#bbs-recommend-output');
const bbsSelectedCount = document.querySelector('#bbs-selected-count');
const recommendDate = document.querySelector('#recommend-date');
const recommendReasons = document.querySelector('#recommend-reasons');
const recommendLetter = document.querySelector('#recommend-letter');
const recommendCopyStatus = document.querySelector('#recommend-copy-status');
const openArchiveButton = document.querySelector('#open-archive');
const exportZipButton = document.querySelector('#export-zip');
const progressLog = document.querySelector('#progress');
const statusPill = document.querySelector('#status-pill');
const usageToggle = document.querySelector('#usage-toggle');
const usagePanel = document.querySelector('#usage-panel');
const runtimeToggle = document.querySelector('#runtime-toggle');
const runtimeNotice = document.querySelector('#runtime-notice');

function bindPanelToggle(toggle, panel) {
  if (!toggle || !panel) {
    return;
  }

  toggle.dataset.bound = 'true';
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    const shouldShow = panel.hidden;
    panel.hidden = !shouldShow;
    toggle.setAttribute('aria-expanded', String(shouldShow));
    if (shouldShow) {
      panel.scrollIntoView({ block: 'nearest' });
    }
  });
}

bindPanelToggle(usageToggle, usagePanel);
bindPanelToggle(runtimeToggle, runtimeNotice);

let activeJobId = null;
let pollTimer = null;
let inspection = null;
let inspectionRequestId = 0;
let sourceMode = 'blog';
let bbsSearchState = null;
let lastDownloadUrl = null;
let bbsRequestId = 0;
let bbsAbortController = null;
let recommendRequestId = 0;
let recommendBusy = false;
let recommendDraft = null;
const BBS_HOME_URL = 'https://bbs.wenxuecity.com/';
const BLOG_URL_PLACEHOLDER = 'https://blog.wenxuecity.com/myoverview/41038/';

function currentSourceType() {
  const el = document.querySelector('input[name="source-type"]:checked');
  return el ? el.value : 'blog';
}

function setStatus(status) {
  const statusLabels = {
    idle: '空闲',
    running: '运行中',
    complete: '完成',
    failed: '失败'
  };
  statusPill.className = `status-pill ${status}`;
  statusPill.textContent = statusLabels[status] || status;
}

function appendSystemLine(message) {
  const line = document.createElement('div');
  line.className = 'progress-line';
  line.textContent = message;
  progressLog.appendChild(line);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function appendDownloadLine(result) {
  if (!result?.downloadUrl || result.downloadUrl === lastDownloadUrl) {
    return;
  }

  lastDownloadUrl = result.downloadUrl;
  const line = document.createElement('div');
  line.className = 'progress-line';

  const link = document.createElement('a');
  link.href = result.downloadUrl;
  link.download = result.fileName || '';
  link.textContent = result.fileName ? `下载 ${result.fileName}` : '下载 ZIP 归档';

  if (Number.isFinite(result.bytes)) {
    line.append(link, document.createTextNode(` (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`));
  } else {
    line.append(link);
  }

  progressLog.appendChild(line);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function renderMessages(messages) {
  progressLog.textContent = '';
  for (const entry of messages) {
    const line = document.createElement('div');
    line.className = 'progress-line';

    const time = document.createElement('span');
    time.className = 'progress-time';
    time.textContent = `[${new Date(entry.time).toLocaleTimeString()}] `;

    line.append(time, entry.message);
    progressLog.appendChild(line);
  }
  progressLog.scrollTop = progressLog.scrollHeight;
}

function selectedCategories() {
  if (!inspection?.categories) {
    return [];
  }

  return [...categoryList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => inspection.categories.find((category) => category.id === input.value))
    .filter(Boolean);
}

function selectedBbsResults() {
  if (!bbsSearchState?.results) {
    return [];
  }

  const selectedUrls = new Set(
    [...bbsResultsList.querySelectorAll('input[type="checkbox"]:checked')]
      .map((input) => input.value)
  );
  return bbsSearchState.results.filter((result) => selectedUrls.has(result.sourceUrl));
}

function bbsResultUserId(result) {
  const author = String(result?.author || '').trim();
  if (author) {
    return author;
  }

  const summary = String(result?.summary || '').replace(/\s+/g, ' ').trim();
  const match = summary.match(/\[[^\]]+\]\s*-\s*([^()]+?)(?=\s*\(\d+\s*bytes\b|\s+\d{4}-\d{2}-\d{2}|$)/i);
  return match ? match[1].trim() : '';
}

function updateStartState() {
  const downloadButton = sourceMode === 'blog' ? startButton : bbsStartButton;
  downloadOptions.hidden = categoryPanel.hidden || downloadButton.hidden;
  if (!downloadOptions.hidden) {
    downloadButton.before(downloadOptions);
  }
  startButton.disabled = sourceMode !== 'blog' || !inspection || selectedCategories().length === 0 || Boolean(activeJobId);
  bbsStartButton.disabled = sourceMode !== 'bbs' || selectedBbsResults().length === 0 || Boolean(activeJobId);
  bbsCollectionButton.disabled = sourceMode !== 'bbs' || selectedBbsResults().length === 0 || Boolean(activeJobId);
  const count = selectedBbsResults().length;
  const recommending = bbsSearchState?.searchMode === 'recommend';
  bbsRecommendButton.disabled = !recommending || count < 1 || count > 5 || recommendBusy || Boolean(activeJobId);
  bbsSelectedCount.hidden = !recommending;
  bbsSelectedCount.textContent = `已选 ${count}/5 篇`;
  bbsSelectAllButton.hidden = recommending;
  bbsResultsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.disabled = recommending && (recommendBusy || (count >= 5 && !checkbox.checked));
  });
}

function clearBbsResults() {
  ++bbsRequestId;
  bbsAbortController?.abort();
  bbsAbortController = null;
  bbsSearchButton.disabled = false;
  resetRecommendDraft();
  bbsSearchState = null;
  bbsSearchSummary.textContent = '';
  bbsSearchWindow.textContent = '';
  bbsSearchWindow.hidden = true;
  bbsResultsList.textContent = '';
  bbsResultsPanel.hidden = true;
  bbsStartButton.hidden = true;
  bbsCollectionButton.hidden = true;
  bbsRecommendButton.hidden = true;
  bbsCollectionOutput.hidden = true;
  bbsCollectionOutput.textContent = '';
  if (!activeJobId) setStatus('idle');
  updateStartState();
}

function renderCategories(data) {
  inspection = data;
  sourceMode = 'blog';
  blogName.textContent = data.blog.name;
  profileName.textContent = data.profile.name;
  categoryList.textContent = '';
  categoryMode.hidden = false;
  bbsMode.hidden = true;

  for (const category of data.categories) {
    const item = document.createElement('label');
    item.className = 'category-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = category.id;
    checkbox.checked = true;
    checkbox.addEventListener('change', updateStartState);

    const text = document.createElement('span');
    text.className = 'category-text';

    const name = document.createElement('strong');
    name.textContent = category.name;

    const meta = document.createElement('span');
    meta.className = 'category-meta';
    const sourceCount = Number.isFinite(category.count) ? `源站 ${category.count} 篇` : '源站数量未知';
    const archivedCount = `已归档 ${category.archivedCount || 0} 篇`;
    meta.textContent = `${sourceCount} | ${archivedCount}`;

    text.append(name, meta);
    item.append(checkbox, text);
    categoryList.appendChild(item);
  }

  categoryPanel.hidden = false;
  startButton.hidden = false;
  updateStartState();
}

function renderBbsSetup(data) {
  inspection = data;
  sourceMode = 'bbs';
  categoryMode.hidden = true;
  bbsMode.hidden = false;
  bbsTitle.textContent = data.blog.name;
  bbsProfileName.textContent = data.profile.name;
  bbsForum.textContent = '';
  bbsKeyword.value = '';
  document.querySelector('input[name="bbs-search-mode"][value="author"]').checked = true;

  for (const forum of data.forums) {
    const option = document.createElement('option');
    option.value = forum.id;
    option.textContent = forum.name;
    option.dataset.url = forum.url;
    bbsForum.appendChild(option);
  }

  bbsForum.value = data.defaultForumId || 'romance';
  clearBbsResults();
  updateBbsKeywordLabel();
  categoryPanel.hidden = false;
}

function selectedForum() {
  const option = bbsForum.options[bbsForum.selectedIndex];
  if (!option) {
    return null;
  }

  return {
    id: option.value,
    name: option.textContent,
    url: option.dataset.url || ''
  };
}

function currentBbsSearchMode() {
  return document.querySelector('input[name="bbs-search-mode"]:checked')?.value || 'author';
}

function renderBbsResults(data) {
  bbsSearchState = data;
  bbsResultsList.textContent = '';

  for (const result of data.results) {
    const item = document.createElement('div');
    item.className = 'category-option result-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = result.sourceUrl;
    checkbox.checked = data.searchMode !== 'recommend';
    checkbox.setAttribute('aria-label', `选择 ${result.title}`);
    checkbox.addEventListener('change', () => {
      if (data.searchMode === 'recommend') resetRecommendDraft();
      updateStartState();
    });

    const text = document.createElement('span');
    text.className = 'category-text';

    const link = document.createElement('a');
    link.href = result.sourceUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = result.title;

    const meta = document.createElement('span');
    meta.className = 'category-meta';
    const metaParts = [
      result.forumName,
      result.author ? `作者 ${result.author}` : '',
      result.sourceCreatedAt ? `发布时间 ${data.searchMode === 'recommend' ? `${RecommendTemplate.formatForumTime(result.publishedAt)}（美西）` : result.sourceCreatedAt}` : '',
      result.isReply ? '跟帖' : ''
    ].filter(Boolean);
    meta.textContent = metaParts.join(' | ');

    text.append(link, meta);
    item.append(checkbox, text);
    bbsResultsList.appendChild(item);
  }

  const total = Number.isFinite(data.totalCount) ? `源站共 ${data.totalCount} 条匹配` : '';
  const pages = Number.isFinite(data.pagesFetched) && data.pagesFetched > 1 ? `，已读取 ${data.pagesFetched} 页` : '，已读取第一页';
  //bbsSearchSummary.textContent = `找到 ${data.results.length} 条结果${pages}${total}。`;
  bbsSearchSummary.textContent = `${total}。`;
  if (data.searchMode === 'recommend') {
    bbsSearchSummary.textContent = `${data.complete ? '最近 36 小时共' : '已读取'} ${data.results.length} 篇主题帖${data.complete ? '' : '（结果尚不完整）'}。`;
  }
  bbsSearchWindow.hidden = data.searchMode !== 'recommend' || !data.windowStart || !data.startedAt;
  bbsSearchWindow.textContent = bbsSearchWindow.hidden ? ''
    : `检索范围：${RecommendTemplate.formatForumTime(data.windowStart)} 至 ${RecommendTemplate.formatForumTime(data.startedAt)}（论坛时间／美西，共 36 小时）。`;
  bbsResultsPanel.hidden = false;
  bbsStartButton.hidden = data.searchMode !== 'author';
  bbsCollectionButton.hidden = data.searchMode !== 'title';
  bbsRecommendButton.hidden = data.searchMode !== 'recommend';
  bbsCollectionOutput.hidden = true;
  bbsCollectionOutput.textContent = '';
  updateStartState();
}

function hashText(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function safeId(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return slug || hashText(value) || 'search';
}

function bbsCategoryFromSelection() {
  const forum = selectedForum();
  const selected = selectedBbsResults();
  const searchMode = bbsSearchState?.searchMode || currentBbsSearchMode();
  const keyword = bbsSearchState?.keyword || bbsKeyword.value.trim();

  return {
    id: `${forum.id}-${searchMode}-${safeId(keyword)}`,
    name: `${forum.name} - ${searchMode === 'author' ? '作者' : '标题'} - ${keyword}`,
    count: selected.length,
    url: bbsSearchState.searchUrl,
    keyword,
    searchMode,
    forum,
    pages: selected
  };
}

async function pollJob() {
  if (!activeJobId) {
    return;
  }

  const response = await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}`);
  if (!response.ok) {
    appendSystemLine('无法读取任务状态。');
    return;
  }

  const job = await response.json();
  setStatus(job.status);
  renderMessages(job.messages);

  if (job.status === 'complete' || job.status === 'failed') {
    clearInterval(pollTimer);
    pollTimer = null;
    activeJobId = null;
    nextButton.disabled = false;
    updateStartState();
    if (job.status === 'complete') {
      appendDownloadLine(job.result);
    }
    if (job.status === 'failed' && job.error) {
      appendSystemLine(job.error);
    }
  }
}

async function startArchive(categories, includeComments) {
  activeJobId = null;
  lastDownloadUrl = null;
  startButton.disabled = true;
  bbsStartButton.disabled = true;
  bbsCollectionButton.disabled = true;
  nextButton.disabled = true;
  progressLog.textContent = '';
  setStatus('running');
  appendSystemLine('开始下载归档...');

  try {
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profileId: inspection.profile.id,
        startUrl: startUrlInput.value.trim(),
        blog: inspection.blog,
        categories,
        incremental: incrementalInput.checked,
        includeComments
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '无法开始下载。');
    }

    activeJobId = data.jobId;
    pollTimer = setInterval(pollJob, 1000);
    pollJob();
  } catch (error) {
    activeJobId = null;
    setStatus('failed');
    nextButton.disabled = false;
    updateStartState();
    appendSystemLine(error.message);
  }
}

async function inspectSource() {
  const requestId = ++inspectionRequestId;
  const sourceType = currentSourceType();
  const startUrl = startUrlInput.value.trim();
  nextButton.disabled = true;
  categoryPanel.hidden = true;
  downloadOptions.hidden = true;
  categoryMode.hidden = true;
  bbsMode.hidden = true;
  startButton.hidden = true;
  inspection = null;
  bbsSearchState = null;
  progressLog.textContent = '';
  setStatus('running');
  appendSystemLine('正在读取来源页面...');

  try {
    const response = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrl, sourceType })
    });
    const data = await response.json();
    if (requestId !== inspectionRequestId) return;
    if (!response.ok) {
      throw new Error(data.error || '无法识别这个来源。');
    }

    setStatus('idle');
    if (data.mode === 'bbs') {
      appendSystemLine(`找到 ${data.blog.name}，共 ${data.forums.length} 个论坛版块。`);
      renderBbsSetup(data);
    } else {
      appendSystemLine(`找到 ${data.blog.name}，共 ${data.categories.length} 个分类。`);
      renderCategories(data);
    }
  } catch (error) {
    if (requestId !== inspectionRequestId) return;
    setStatus('failed');
    appendSystemLine(error.message);
  } finally {
    if (requestId === inspectionRequestId) nextButton.disabled = false;
  }
}

inspectForm.addEventListener('submit', (event) => {
  event.preventDefault();
  inspectSource();
});

selectAllButton.addEventListener('click', () => {
  categoryList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = true;
  });
  updateStartState();
});

selectNoneButton.addEventListener('click', () => {
  categoryList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = false;
  });
  updateStartState();
});

bbsForum.addEventListener('change', clearBbsResults);
bbsKeyword.addEventListener('input', clearBbsResults);
document.querySelectorAll('input[name="bbs-search-mode"]').forEach((radio) => {
  radio.addEventListener('change', clearBbsResults);
});

bbsSearchButton.addEventListener('click', async () => {
  const forum = selectedForum();
  const keyword = bbsKeyword.value.trim();
  const searchMode = currentBbsSearchMode();

  if (!forum) {
    appendSystemLine('请选择一个论坛版块。');
    return;
  }

  if (searchMode !== 'recommend' && !keyword) {
    appendSystemLine('请输入文学城ID或关键词。');
    bbsKeyword.focus();
    return;
  }

  clearBbsResults();
  const requestId = bbsRequestId;
  bbsAbortController = new AbortController();
  const controller = bbsAbortController;
  bbsSearchButton.disabled = true;
  setStatus('running');
  appendSystemLine(searchMode === 'recommend' ? `正在读取 ${forum.name} 最近 36 小时的所有主题帖...` : `正在${searchMode === 'author' ? '按作者' : '按标题'}搜索 ${forum.name}...`);

  try {
    if (searchMode === 'recommend') {
      await searchRecentPosts(forum, requestId, controller);
      return;
    }
    const response = await fetch('/api/bbs/search', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        forumId: forum.id,
        forumName: forum.name,
        keyword,
        searchMode
      })
    });
    const data = await response.json();
    if (requestId !== bbsRequestId) return;
    if (!response.ok) {
      throw new Error(data.error || '论坛搜索失败。');
    }

    setStatus('idle');
    appendSystemLine(`找到 ${data.results.length} 条论坛结果。`);
    renderBbsResults(data);
  } catch (error) {
    if (requestId !== bbsRequestId || error.name === 'AbortError') return;
    setStatus('failed');
    appendSystemLine(error.message);
  } finally {
    if (requestId === bbsRequestId) bbsSearchButton.disabled = false;
  }
});

bbsSelectAllButton.addEventListener('click', () => {
  bbsResultsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = true;
  });
  updateStartState();
});

bbsSelectNoneButton.addEventListener('click', () => {
  if (recommendBusy) return;
  resetRecommendDraft();
  bbsResultsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = false;
  });
  updateStartState();
});

startButton.addEventListener('click', () => {
  const categories = selectedCategories();
  if (!inspection || !categories.length) {
    appendSystemLine('请至少选择一个分类。');
    return;
  }

  startArchive(categories, includeCommentsInput.checked);
});

bbsStartButton.addEventListener('click', () => {
  const selected = selectedBbsResults();
  if (!inspection || !bbsSearchState || !selected.length) {
    appendSystemLine('请至少选择一条论坛结果。');
    return;
  }

  startArchive([bbsCategoryFromSelection()], includeCommentsInput.checked);
});

async function searchRecentPosts(forum, requestId, controller) {
  const posts = new Map();
  const warnings = new Set();
  let page = 1;
  let startedAt;
  let lastData;
  try {
    while (page) {
      const response = await fetch('/api/bbs/search', {
        method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ forumId: forum.id, forumName: forum.name, searchMode: 'recommend', page, startedAt })
      });
      const data = await response.json();
      if (requestId !== bbsRequestId) return;
      if (!response.ok) throw new Error(data.error || '论坛读取失败，请重试。');
      startedAt = data.startedAt;
      data.results.forEach((post) => posts.set(post.sourceUrl, post));
      (data.warnings || []).forEach((warning) => warnings.add(warning));
      lastData = data;
      appendSystemLine(`已读取第 ${page} 页，找到 ${posts.size} 篇最近 36 小时的主题帖。`);
      if (data.nextPage !== null && data.nextPage !== page + 1) throw new Error('分页异常，请重新搜索。');
      page = data.nextPage;
    }
    warnings.forEach(appendSystemLine);
    setStatus(warnings.size ? 'failed' : 'idle');
  } catch (error) {
    if (requestId !== bbsRequestId || controller.signal.aborted) return;
    warnings.add(error.message);
    appendSystemLine(`检索尚未完成：${error.message} 可重新点击“下一步”。`);
    setStatus('failed');
  }
  if (requestId !== bbsRequestId) return;
  renderBbsResults({ ...lastData, searchMode: 'recommend', forumId: forum.id, forumName: forum.name,
    results: [...posts.values()].sort((a, b) => b.publishedAt - a.publishedAt), complete: !page && !warnings.size });
}

function resetRecommendDraft() {
  ++recommendRequestId;
  recommendBusy = false;
  recommendDraft = null;
  bbsRecommendButton.textContent = '推贴';
  bbsRecommendOutput.hidden = true;
  recommendReasons.textContent = '';
  recommendLetter.value = '';
  document.querySelector('#recommend-letter-preview').textContent = '';
  recommendCopyStatus.textContent = '';
}

function syncRecommendLetter() {
  if (!recommendDraft || !recommendDate.value) return;
  recommendLetter.value = RecommendTemplate.formatLetter({ date: recommendDate.value, forum: recommendDraft.forum, posts: recommendDraft.posts });
  document.querySelector('#recommend-letter-preview').innerHTML = RecommendTemplate.letterHtml(recommendLetter.value);
  recommendCopyStatus.textContent = '';
}

function renderRecommendReasons() {
  recommendReasons.textContent = '';
  recommendDraft.posts.forEach((post, index) => {
    const row = document.createElement('div');
    row.className = 'recommend-reason';
    const link = document.createElement('a');
    link.href = post.sourceUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = `${index + 1}，${post.title}`;
    const label = document.createElement('label');
    label.textContent = '推荐原因';
    const input = document.createElement('textarea');
    input.rows = 2;
    input.value = post.reason || '';
    input.placeholder = '读取正文后自动生成，也可手动填写';
    input.disabled = recommendBusy;
    input.addEventListener('input', () => {
      post.reason = input.value;
      syncRecommendLetter();
    });
    label.appendChild(input);
    row.append(link, label);
    if (post.error) {
      const message = document.createElement('p');
      message.className = 'recommend-error';
      message.textContent = post.error;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重试此篇';
      retry.disabled = recommendBusy;
      retry.addEventListener('click', () => generateRecommendation([post]));
      row.append(message, retry);
    }
    recommendReasons.appendChild(row);
  });
}

async function generateRecommendation(posts) {
  if (recommendBusy || !recommendDraft) return;
  const requestId = ++recommendRequestId;
  recommendBusy = true;
  bbsRecommendButton.textContent = '正在阅读并生成…';
  updateStartState();
  renderRecommendReasons();
  setStatus('running');
  appendSystemLine(`正在阅读 ${posts.length} 篇正文并生成推荐原因…`);
  try {
    const response = await fetch('/api/bbs/recommend', {
      method: 'POST', signal: AbortSignal.timeout(55000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forumId: recommendDraft.forum.id, posts: posts.map((post) => ({ sourceUrl: post.sourceUrl })) })
    });
    const data = await response.json();
    if (requestId !== recommendRequestId) return;
    if (!response.ok) throw new Error(data.error || '推贴生成失败，请重试。');
    for (const post of posts) {
      const result = data.results.find((item) => item.sourceUrl === post.sourceUrl);
      if (!result) { post.error = '未收到此篇结果，请重试。'; continue; }
      if (result.title) post.title = result.title;
      if (result.author) post.author = result.author;
      if (result.reason) post.reason = result.reason;
      post.error = result.error || '';
    }
    const hasErrors = recommendDraft.posts.some((post) => post.error);
    setStatus(hasErrors ? 'failed' : 'complete');
    appendSystemLine(hasErrors ? '部分推荐原因未能生成，请查看各篇提示，重试或手动填写。' : '推荐信已生成，请检查后复制。');
  } catch (error) {
    if (requestId !== recommendRequestId) return;
    const message = error.name === 'TimeoutError' ? '生成超时，请重试或手动填写推荐原因。' : error.message;
    posts.forEach((post) => { post.error = message; });
    setStatus('failed');
    appendSystemLine(message);
  } finally {
    if (requestId === recommendRequestId) {
      recommendBusy = false;
      bbsRecommendButton.textContent = '推贴';
      renderRecommendReasons();
      syncRecommendLetter();
      updateStartState();
    }
  }
}

bbsRecommendButton.addEventListener('click', () => {
  const selected = selectedBbsResults();
  if (selected.length < 1 || selected.length > 5 || recommendBusy) return;
  if (!recommendDraft) {
    recommendDraft = { forum: selectedForum(), posts: selected.map((post) => ({ ...post, reason: '', error: '' })), manualLetter: false };
    recommendDate.value = RecommendTemplate.localDate();
    syncRecommendLetter();
  }
  bbsRecommendOutput.hidden = false;
  const pending = recommendDraft.posts.filter((post) => !post.reason);
  if (pending.length) generateRecommendation(pending);
  bbsRecommendOutput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
recommendDate.addEventListener('change', () => syncRecommendLetter());
document.querySelector('#recommend-copy').addEventListener('click', async () => {
  if (!recommendLetter.value) return;
  try {
    if (window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([recommendLetter.value], { type: 'text/plain' }),
          'text/html': new Blob([RecommendTemplate.letterHtml(recommendLetter.value)], { type: 'text/html' })
        })]);
    } else {
      throw new Error('Rich clipboard unavailable');
    }
    recommendCopyStatus.textContent = '推荐信已复制（含超链接），请粘贴到支持富文本的编辑器。';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#recommend-letter-preview'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    recommendCopyStatus.textContent = '自动复制不可用，已选中带链接的推荐信，请按 Ctrl+C 或长按复制，并粘贴到支持富文本的编辑器。';
  }
});

bbsCollectionButton.addEventListener('click', () => {
  const selected = selectedBbsResults();
  if (!selected.length) {
    appendSystemLine('请至少选择一条论坛结果。');
    return;
  }
  bbsCollectionOutput.textContent = '';
  const list = document.createElement('ul');
  list.className = 'collection-list';
  list.style.listStyle = 'none';
  list.style.paddingLeft = '0';

  for (const result of selected) {
    const item = document.createElement('li');
    item.style.listStyle = 'none';
    item.style.marginLeft = '0';
    item.style.paddingLeft = '0';
    item.style.marginBottom = '8px';
    item.className = 'collection-item';
    
    const bulletSpan = document.createElement('span');
    bulletSpan.textContent = '• ';
    bulletSpan.style.marginRight = '4px';

    const titleLink = document.createElement('a');
    titleLink.href = result.sourceUrl;
    titleLink.target = '_blank';
    titleLink.rel = 'noreferrer';
    titleLink.textContent = result.title;
    titleLink.className = 'bbs-collection-title';

    const meta = document.createElement('span');
    meta.className = 'bbs-collection-meta';
    const forumText = result.forumName ? `[${result.forumName}]` : '';
    const userId = bbsResultUserId(result);
    if (forumText) {
      meta.append(document.createTextNode(forumText));
    }
    if (userId) {
      if (meta.childNodes.length) {
        meta.append(document.createTextNode(' - '));
      }
      const userIdText = document.createElement('strong');
      userIdText.className = 'bbs-user-id';
      userIdText.textContent = userId;
      meta.append(userIdText);
    }
    if (result.sourceCreatedAt) {
      if (meta.childNodes.length) {
        meta.append(document.createTextNode(' | '));
      }
      meta.append(document.createTextNode(result.sourceCreatedAt));
    }

    item.append(bulletSpan, titleLink, document.createTextNode(' '), meta);
    list.appendChild(item);
  }

  const collection = document.createElement('div');
  collection.appendChild(list);
  const summary = document.createElement('section');
  summary.className = 'collection-summary';
  const total = document.createElement('p');
  total.textContent = `本合集共 ${selected.length} 个帖子。`;
  const heading = document.createElement('p');
  heading.textContent = '各 ID 在本合集中的发帖数（从多到少）：';
  const counts = new Map();
  for (const result of selected) {
    const userId = bbsResultUserId(result) || '未知 ID';
    counts.set(userId, (counts.get(userId) || 0) + 1);
  }
  const ranking = document.createElement('ol');
  for (const [userId, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))) {
    const row = document.createElement('li');
    row.textContent = `${userId}：${count} 个帖子`;
    ranking.appendChild(row);
  }
  summary.append(total, heading, ranking);
  collection.appendChild(summary);
  bbsCollectionOutput.appendChild(collection);
  bbsCollectionOutput.hidden = false;

  // visually highlight each item
  document.querySelectorAll('.collection-list .collection-item').forEach((el) => el.classList.add('highlight'));

  // select the collection HTML for convenience
  try {
    const html = collection.outerHTML;
    // copy HTML to clipboard as text (for pasting into HTML-mode editors)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).then(() => {
        // show message
        const msg = document.createElement('div');
        msg.className = 'collection-copied-message';
        msg.textContent = '合集已经复制，可粘贴做合集了。';
        bbsCollectionOutput.appendChild(msg);
      }).catch(() => {
        const msg = document.createElement('div');
        msg.className = 'collection-copied-message';
        msg.textContent = '复制失败，请手动复制右侧内容。';
        bbsCollectionOutput.appendChild(msg);
      });
    } else {
      const msg = document.createElement('div');
      msg.className = 'collection-copied-message';
      msg.textContent = '复制不可用，请手动复制右侧内容。';
      bbsCollectionOutput.appendChild(msg);
    }

    // also select the rendered nodes
    const range = document.createRange();
    range.selectNodeContents(collection);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {
    // ignore selection/copy errors
  }

  appendSystemLine(`合集已生成，共 ${selected.length} 条链接。`);
});

if (openArchiveButton) {
  openArchiveButton.addEventListener('click', () => {
    window.open('/archive/index.html', '_blank', 'noreferrer');
  });
}

if (exportZipButton) {
  exportZipButton.addEventListener('click', async () => {
    exportZipButton.disabled = true;
    appendSystemLine('正在创建归档 ZIP...');

    try {
      const response = await fetch('/api/export', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '导出失败。');
      }
      appendSystemLine(`导出完成：${data.fileName}`);
      window.open(data.url, '_blank', 'noreferrer');
    } catch (error) {
      appendSystemLine(error.message);
    } finally {
      exportZipButton.disabled = false;
    }
  });
}

setStatus('idle');
appendSystemLine('准备就绪。');

function formatLimitBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '未限制';
  }

  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function formatLimitCount(value, fallback) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : fallback;
}

function appendRuntimeNoticeItem(list, text) {
  const item = document.createElement('li');
  item.textContent = text;
  list.appendChild(item);
}

function renderNetlifyRuntimeNotice(limits = {}) {
  if (!runtimeNotice) {
    return;
  }

  runtimeNotice.replaceChildren();

  const title = document.createElement('h2');
  title.textContent = '网页公开版限制';

  const summary = document.createElement('p');
  summary.textContent = '网页公开版适合小批量试用，会生成临时 ZIP 下载文件；下载后请解压到本机离线阅读。大量备份建议使用桌面版。';

  const list = document.createElement('ul');
  appendRuntimeNoticeItem(list, '支持来源：文学城博客和文学城论坛。');
  appendRuntimeNoticeItem(list, `每次最多选择 ${formatLimitCount(limits.maxSelectedCategories, 3)} 个博客分类，或 ${formatLimitCount(limits.maxSelectedBbsPosts, 80)} 个论坛帖子。`);
  appendRuntimeNoticeItem(list, `每次任务最多保存 ${formatLimitCount(limits.maxPagesPerJob, 80)} 个页面；每个分类最多读取 ${formatLimitCount(limits.maxCategoryIndexPages, 12)} 个目录页。`);
  appendRuntimeNoticeItem(list, `资源预算约 ${formatLimitBytes(limits.maxAssetBytes)}，ZIP 下载上限约 ${formatLimitBytes(limits.maxZipBytes)}。`);
  appendRuntimeNoticeItem(list, 'Netlify 免费额度会同时计算下载流量、函数运行和部署等，用完后站点会暂停。');

  runtimeNotice.append(title, summary, list);
  runtimeNotice.hidden = true;
  if (runtimeToggle) {
    runtimeToggle.hidden = false;
    runtimeToggle.setAttribute('aria-expanded', 'false');
  }
}

async function initializeRuntimeMode() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const health = await response.json();
    if (health.mode !== 'netlify') {
      return;
    }

    renderNetlifyRuntimeNotice(health.limits || {});

    const archiveLink = document.querySelector('.masthead-actions a[href="/archive/index.html"]');
    if (archiveLink) {
      archiveLink.hidden = true;
    }
    appendSystemLine('网页公开版会生成临时 ZIP 文件；下载并解压后可在本机离线阅读。');
  } catch {
    // The portable local server may not expose cloud runtime details.
  }
}

initializeRuntimeMode();

// Initialize source type UI behavior
function updateSourceTypeUI() {
  const type = currentSourceType();
  nextButton.parentElement.hidden = type === 'bbs';
  const urlLabel = document.querySelector('#start-url-label');
  const urlInput = document.querySelector('#start-url');
  urlInput.dataset.originalPlaceholder = urlInput.dataset.originalPlaceholder || urlInput.placeholder || BLOG_URL_PLACEHOLDER;

  if (type === 'bbs') {
    urlLabel.hidden = true;
    urlInput.value = BBS_HOME_URL;
    urlInput.removeAttribute('required');
  } else {
    urlLabel.hidden = false;
    urlInput.value = '';
    urlInput.placeholder = urlInput.dataset.originalPlaceholder || BLOG_URL_PLACEHOLDER;
    urlInput.setAttribute('required', '');
  }
}

function updateBbsKeywordLabel() {
  const searchMode = currentBbsSearchMode();
  document.querySelector('#bbs-keyword-field').hidden = searchMode === 'recommend';
  document.querySelector('#bbs-recommend-hint').hidden = searchMode !== 'recommend';
  bbsKeyword.disabled = searchMode === 'recommend';
  const label = document.querySelector('#bbs-keyword-label');
  if (!label) {
    return;
  }

  if (searchMode === 'author') {
    label.textContent = '\u6587\u5b66\u57ceID';
  } else {
    label.textContent = '\u5173\u952e\u8bcd';
  }
}

sourceTypeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    ++inspectionRequestId;
    nextButton.disabled = Boolean(activeJobId);
    updateSourceTypeUI();
    categoryPanel.hidden = true;
    categoryMode.hidden = true;
    bbsMode.hidden = true;
    startButton.hidden = true;
    inspection = null;
    sourceMode = currentSourceType();
    clearBbsResults();
    if (sourceMode === 'bbs') inspectSource();
    else if (!activeJobId) setStatus('idle');
  });
});

document.querySelectorAll('input[name="bbs-search-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    updateBbsKeywordLabel();
  });
});

updateSourceTypeUI();
updateBbsKeywordLabel();

// Clear the blog URL box on focus, then restore the placeholder if it stays empty.
startUrlInput.addEventListener('focus', () => {
  if (!startUrlInput.dataset.originalPlaceholder) {
    startUrlInput.dataset.originalPlaceholder = startUrlInput.placeholder || BLOG_URL_PLACEHOLDER;
  }
  if (currentSourceType() === 'blog') {
    startUrlInput.value = '';
    startUrlInput.placeholder = '';
  }
});

startUrlInput.addEventListener('blur', () => {
  if (!startUrlInput.value) {
    startUrlInput.placeholder = startUrlInput.dataset.originalPlaceholder || BLOG_URL_PLACEHOLDER;
  }
});
