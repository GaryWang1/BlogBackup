importScripts('reader.js');
const allowedOrigins = new Set(['https://dainty-praline-c54396.netlify.app', 'http://localhost:3017', 'http://127.0.0.1:3017']);
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'moderator' || port.sender?.frameId !== 0 || !allowedOrigins.has(new URL(port.sender.url).origin)) { port.disconnect(); return; }
  let tabId, generation = 0, connected = false;
  let running = Promise.resolve();
  const send = (reply) => { try { port.postMessage(reply); } catch {} };
  port.onDisconnect.addListener(() => { generation++; connected = false; });
  port.onMessage.addListener(async (message) => {
    const { id, action, forum, urls } = message;
    if (typeof id !== 'string' || id.length > 100) return;
    if (action === 'cancel' || action === 'disconnect') {
      generation++;
      if (action === 'disconnect') connected = false;
      send({ id, done: true }); return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(forum || '')) { send({ id, done: true, error: '论坛无效' }); return; }
    if (action === 'connect') {
      const token = ++generation;
      try {
        const tab = await chrome.tabs.create({ url: `https://bbs.wenxuecity.com/${forum}/`, active: true });
        if (token !== generation) return;
        tabId = tab.id; connected = true;
        send({ id, done: true });
      } catch { send({ id, done: true, error: '无法打开文学城页面' }); }
      return;
    }
    if (action !== 'check') return;
    if (!connected || !Array.isArray(urls) || urls.length > 10 || !urls.length || urls.some((url) => typeof url !== 'string' || !new RegExp(`^https://bbs\\.wenxuecity\\.com/${forum}/\\d+\\.html$`).test(url))) {
      send({ id, done: true, error: '请重新连接；每次只能检查当前论坛的 1–10 篇帖子' }); return;
    }
    const token = ++generation;
    const previous = running;
    let release;
    running = new Promise((resolve) => { release = resolve; });
    await previous;
    if (token !== generation) { release(); return; }
    let cursor = 0;
    try { await Promise.all(Array.from({ length: Math.min(2, urls.length) }, async () => {
      while (cursor < urls.length && token === generation) {
        const sourceUrl = urls[cursor++];
        let result;
        try {
          const values = await chrome.scripting.executeScript({ target: { tabId }, func: readModeratorPost, args: [sourceUrl] });
          result = values[0]?.result;
        } catch {}
        if (token !== generation) return;
        send({ id, result: result || { sourceUrl, status: 'unknown', error: '请保持文学城标签页打开，登录后重试' } });
      }
    })); } finally { release(); }
    if (token === generation) send({ id, done: true });
  });
});
