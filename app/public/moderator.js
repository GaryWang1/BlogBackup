class ModeratorController {
  constructor(onChange) {
    this.connected = false;
    this.states = new Map();
    this.pending = new Map();
    this.version = 0;
    this.onChange = onChange;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'wxc-moderator-response') return;
      const message = event.data;
      const request = this.pending.get(message.id);
      if (!request) return;
      if (message.result) request.onResult?.(message.result);
      if (message.done) {
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        message.error ? request.reject(new Error(message.error)) : request.resolve(message);
      }
    });
  }
  request(action, forum, urls, onResult) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(action === 'connect' ? '未检测到助手扩展。请先安装扩展并刷新本页。' : '检查超时，请登录文学城后重试。'));
      }, action === 'identity' ? 10000 : action === 'connect' ? 5000 : 65000);
      this.pending.set(id, { resolve, reject, timer, onResult });
      window.postMessage({ channel: 'wxc-moderator-request', id, action, forum, urls }, location.origin);
    });
  }
  cancel(clear = true) {
    this.version++;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('已取消')); }
    this.pending.clear();
    window.postMessage({ channel: 'wxc-moderator-request', id: crypto.randomUUID(), action: 'cancel' }, location.origin);
    if (clear) this.states.clear();
    else for (const [url, state] of this.states) if (state.status === 'checking') this.states.set(url, { status: 'unknown', error: '检查已取消，请重试' });
  }
  async connect(forum) {
    this.cancel();
    await this.request('connect', forum);
    this.connected = true;
  }
  disconnect() {
    this.cancel(); this.connected = false;
    window.postMessage({ channel: 'wxc-moderator-request', id: crypto.randomUUID(), action: 'disconnect' }, location.origin);
    this.onChange();
  }
  blocked(url) { return this.connected && ['checking', 'recommended'].includes(this.states.get(url)?.status); }
  async check(forum, urls) {
    if (!this.connected) return;
    this.cancel(false);
    const version = this.version;
    for (const url of urls) this.states.set(url, { status: 'checking' });
    this.onChange();
    for (let i = 0; i < urls.length && version === this.version; i += 10) {
      const batch = urls.slice(i, i + 10);
      try {
        await this.request('check', forum, batch, (result) => {
          if (version !== this.version || !batch.includes(result.sourceUrl) || !['recommended', 'not-recommended', 'unknown'].includes(result.status)) return;
          this.states.set(result.sourceUrl, { status: result.status, recommendedAt: String(result.recommendedAt || '').slice(0, 40), error: String(result.error || '').slice(0, 150) });
          this.onChange();
        });
      } catch (error) {
        if (version !== this.version) return;
        for (const url of batch) if (this.states.get(url)?.status === 'checking') this.states.set(url, { status: 'unknown', error: error.message });
      }
      if (version !== this.version) return;
      for (const url of batch) if (this.states.get(url)?.status === 'checking') this.states.set(url, { status: 'unknown', error: '未返回检查结果，请重试' });
      this.onChange();
    }
  }
}
