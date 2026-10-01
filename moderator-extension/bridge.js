(() => {
  if (!['https://dainty-praline-c54396.netlify.app', 'http://localhost:3017', 'http://127.0.0.1:3017'].includes(location.origin) || window !== window.top) return;
  let port;
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.channel !== 'wxc-moderator-request') return;
    if (!['connect', 'check', 'cancel', 'disconnect'].includes(message.action) || typeof message.id !== 'string') return;
    try {
      if (!port) {
        port = chrome.runtime.connect({ name: 'moderator' });
        port.onMessage.addListener((reply) => window.postMessage({ ...reply, channel: 'wxc-moderator-response' }, location.origin));
        port.onDisconnect.addListener(() => { port = null; });
      }
      port.postMessage(message);
    } catch {
      window.postMessage({ channel: 'wxc-moderator-response', id: message.id, done: true, error: '扩展连接已断开，请刷新页面。' }, location.origin);
    }
  });
})();
