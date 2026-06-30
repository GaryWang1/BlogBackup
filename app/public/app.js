const inspectForm = document.querySelector('#inspect-form');
const startUrlInput = document.querySelector('#start-url');
const sourceTypeRadios = document.querySelectorAll('input[name="source-type"]');
const incrementalInput = document.querySelector('#incremental');
const includeCommentsInput = document.querySelector('#include-comments');
const includeCommentsRow = document.querySelector('#include-comments-row');
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
const bbsResultsList = document.querySelector('#bbs-results-list');
const bbsSelectAllButton = document.querySelector('#bbs-select-all');
const bbsSelectNoneButton = document.querySelector('#bbs-select-none');
const bbsStartButton = document.querySelector('#bbs-start-button');
const bbsCollectionButton = document.querySelector('#bbs-collection-button');
const bbsCollectionOutput = document.querySelector('#bbs-collection-output');
const openArchiveButton = document.querySelector('#open-archive');
const exportZipButton = document.querySelector('#export-zip');
const progressLog = document.querySelector('#progress');
const statusPill = document.querySelector('#status-pill');
const usageToggle = document.querySelector('#usage-toggle');
const usagePanel = document.querySelector('#usage-panel');

if (usageToggle && usagePanel) {
  usageToggle.dataset.bound = 'true';
  usageToggle.addEventListener('click', (event) => {
    event.preventDefault();
    const shouldShow = usagePanel.hidden;
    usagePanel.hidden = !shouldShow;
    usageToggle.setAttribute('aria-expanded', String(shouldShow));
    if (shouldShow) {
      usagePanel.scrollIntoView({ block: 'nearest' });
    }
  });
}

let activeJobId = null;
let pollTimer = null;
let inspection = null;
let sourceMode = 'blog';
let bbsSearchState = null;
let lastDownloadUrl = null;
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

function updateStartState() {
  startButton.disabled = sourceMode !== 'blog' || !inspection || selectedCategories().length === 0 || Boolean(activeJobId);
  bbsStartButton.disabled = sourceMode !== 'bbs' || selectedBbsResults().length === 0 || Boolean(activeJobId);
  bbsCollectionButton.disabled = sourceMode !== 'bbs' || selectedBbsResults().length === 0 || Boolean(activeJobId);
}

function clearBbsResults() {
  bbsSearchState = null;
  bbsSearchSummary.textContent = '';
  bbsResultsList.textContent = '';
  bbsResultsPanel.hidden = true;
  bbsStartButton.hidden = true;
  bbsCollectionButton.hidden = true;
  bbsCollectionOutput.hidden = true;
  bbsCollectionOutput.textContent = '';
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
  includeCommentsRow.hidden = false;

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
  includeCommentsRow.hidden = true;
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
  return document.querySelector('input[name="bbs-search-mode"]:checked')?.value === 'title' ? 'title' : 'author';
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
    checkbox.checked = true;
    checkbox.addEventListener('change', updateStartState);

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
      result.sourceCreatedAt ? `发布时间 ${result.sourceCreatedAt}` : '',
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
  bbsResultsPanel.hidden = false;
  bbsStartButton.hidden = data.searchMode !== 'author';
  bbsCollectionButton.hidden = data.searchMode !== 'title';
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

inspectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const startUrl = startUrlInput.value.trim();
  nextButton.disabled = true;
  categoryPanel.hidden = true;
  categoryMode.hidden = true;
  bbsMode.hidden = true;
  startButton.hidden = true;
  includeCommentsRow.hidden = false;
  inspection = null;
  bbsSearchState = null;
  progressLog.textContent = '';
  setStatus('running');
  appendSystemLine('正在读取来源页面...');

  try {
    const response = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrl, sourceType: currentSourceType() })
    });
    const data = await response.json();
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
    setStatus('failed');
    appendSystemLine(error.message);
  } finally {
    nextButton.disabled = false;
  }
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

  if (!keyword) {
    appendSystemLine('请输入文学城ID或关键词。');
    bbsKeyword.focus();
    return;
  }

  bbsSearchButton.disabled = true;
  clearBbsResults();
  setStatus('running');
  appendSystemLine(`正在${searchMode === 'author' ? '按作者' : '按标题'}搜索 ${forum.name}...`);

  try {
    const response = await fetch('/api/bbs/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        forumId: forum.id,
        forumName: forum.name,
        keyword,
        searchMode
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || '论坛搜索失败。');
    }

    setStatus('idle');
    appendSystemLine(`找到 ${data.results.length} 条论坛结果。`);
    renderBbsResults(data);
  } catch (error) {
    setStatus('failed');
    appendSystemLine(error.message);
  } finally {
    bbsSearchButton.disabled = false;
  }
});

bbsSelectAllButton.addEventListener('click', () => {
  bbsResultsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = true;
  });
  updateStartState();
});

bbsSelectNoneButton.addEventListener('click', () => {
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

  startArchive([bbsCategoryFromSelection()], true);
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
    const parts = [];
    if (result.forumName) {
      parts.push(`[${result.forumName}]`);
    }
    if (result.author) {
      parts.push(result.author);
    }
    if (Number.isFinite(result.bytes)) {
      parts.push(`(${result.bytes} bytes)`);
    }
    if (result.sourceCreatedAt) {
      parts.push(result.sourceCreatedAt);
    }
    meta.textContent = parts.join(' ');

    item.append(bulletSpan, titleLink, document.createTextNode(' '), meta);
    list.appendChild(item);
  }

  // append and highlight
  bbsCollectionOutput.appendChild(list);
  bbsCollectionOutput.hidden = false;

  // visually highlight each item
  document.querySelectorAll('.collection-list .collection-item').forEach((el) => el.classList.add('highlight'));

  // select the collection HTML for convenience
  try {
    const html = list.outerHTML;
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
    range.selectNodeContents(list);
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

    const archiveLink = document.querySelector('.masthead-actions a[href="/archive/index.html"]');
    if (archiveLink) {
      archiveLink.href = '#progress';
      archiveLink.removeAttribute('target');
      archiveLink.textContent = 'ZIP';
      archiveLink.title = '归档完成后，这里会出现临时 ZIP 下载链接。';
    }
    appendSystemLine('网页版会生成临时 ZIP 文件；下载后可在本机离线阅读。');
  } catch {
    // The portable local server may not expose cloud runtime details.
  }
}

initializeRuntimeMode();

// Initialize source type UI behavior
function updateSourceTypeUI() {
  const type = currentSourceType();
  const urlLabel = document.querySelector('#start-url-label');
  const urlInput = document.querySelector('#start-url');
  urlInput.dataset.originalPlaceholder = urlInput.dataset.originalPlaceholder || urlInput.placeholder || BLOG_URL_PLACEHOLDER;

  if (type === 'bbs') {
    urlLabel.hidden = true;
    urlInput.value = BBS_HOME_URL;
    urlInput.removeAttribute('required');
    includeCommentsRow.hidden = true;
  } else {
    urlLabel.hidden = false;
    urlInput.value = '';
    urlInput.placeholder = urlInput.dataset.originalPlaceholder || BLOG_URL_PLACEHOLDER;
    urlInput.setAttribute('required', '');
    includeCommentsRow.hidden = false;
  }
}

function updateBbsKeywordLabel() {
  const searchMode = currentBbsSearchMode();
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
    updateSourceTypeUI();
    categoryPanel.hidden = true;
    categoryMode.hidden = true;
    bbsMode.hidden = true;
    startButton.hidden = true;
    inspection = null;
    bbsSearchState = null;
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
