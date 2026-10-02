const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function worker(origin = 'http://localhost:3017/', session = {}) {
  let connect, receive, disconnect, active = 0, maximum = 0;
  const replies = [], calls = [];
  const port = { name: 'moderator', sender: { url: origin, frameId: 0 }, disconnect() { this.rejected = true; }, postMessage(m) { replies.push(m); }, onMessage: { addListener(fn) { receive = fn; } }, onDisconnect: { addListener(fn) { disconnect = fn; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../moderator-extension/background.js'), 'utf8'), {
    URL, importScripts() {}, readModeratorPost() {},
    chrome: { storage: { session: { get: async () => session, set: async (values) => Object.assign(session, values), remove: async (key) => { delete session[key]; } } }, runtime: { onConnect: { addListener(fn) { connect = fn; } } }, tabs: { create: async () => ({ id: 5 }) }, scripting: { executeScript: async ({ args }) => {
      calls.push(args[0]); maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5)); active--;
      return [{ result: { sourceUrl: args[0], status: 'not-recommended' } }];
    } } }
  });
  connect(port);
  return { port, replies, calls, send: (m) => receive(m), disconnect: () => disconnect(), maximum: () => maximum };
}
test('extension rejects unapproved origins and ports', () => {
  for (const origin of ['https://example.com/', 'http://localhost:3000/', 'https://evil.netlify.app/']) assert.equal(worker(origin).port.rejected, true);
});
test('worker restart restores the connected tab without opening another tab', async () => {
  const session = {};
  const first = worker('http://localhost:3017/', session);
  await first.send({ id: 'connect', action: 'connect', forum: 'romance' });
  first.disconnect();
  const restored = worker('http://localhost:3017/', session);
  await restored.send({ id: 'check', action: 'check', forum: 'romance', urls: ['https://bbs.wenxuecity.com/romance/1.html'] });
  assert.equal(restored.calls.length, 1);
  assert.ok(restored.replies.some((m) => m.result));
  await restored.send({ id: 'disconnect', action: 'disconnect' });
  const again = worker('http://localhost:3017/', session);
  await again.send({ id: 'check', action: 'check', forum: 'romance', urls: ['https://bbs.wenxuecity.com/romance/1.html'] });
  assert.ok(again.replies.at(-1).error);
});
test('extension validates forum, URLs, batch size and uses at most two readers', async () => {
  const w = worker();
  await w.send({ id: 'connect', action: 'connect', forum: 'romance' });
  const urls = Array.from({ length: 10 }, (_, i) => `https://bbs.wenxuecity.com/romance/${i}.html`);
  for (const bad of [[...urls, urls[0]], ['https://bbs.wenxuecity.com/music/1.html'], ['https://bbs.wenxuecity.com/romance/moderator/menu/1/']]) {
    await w.send({ id: 'bad', action: 'check', forum: 'romance', urls: bad });
    assert.ok(w.replies.at(-1).error);
  }
  assert.equal(w.calls.length, 0);
  await w.send({ id: 'good', action: 'check', forum: 'romance', urls });
  assert.equal(w.calls.length, 10);
  assert.equal(w.maximum(), 2);
  assert.equal(w.replies.filter((m) => m.id === 'good' && m.result).length, 10);
});
test('cancel and disconnect discard late extension results', async () => {
  const w = worker();
  await w.send({ id: 'connect', action: 'connect', forum: 'romance' });
  const urls = ['https://bbs.wenxuecity.com/romance/1.html'];
  const pending = w.send({ id: 'old', action: 'check', forum: 'romance', urls });
  await w.send({ id: 'cancel', action: 'cancel' });
  await pending;
  assert.equal(w.replies.some((m) => m.id === 'old'), false);
  await w.send({ id: 'disconnect', action: 'disconnect' });
  await w.send({ id: 'new', action: 'check', forum: 'romance', urls });
  assert.ok(w.replies.at(-1).error);
});
