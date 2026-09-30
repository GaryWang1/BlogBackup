const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveGeminiModel, apiError } = require('./gemini-client');

const entry = (name, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods });

test('auto uses only models actually returned for this key and follows pagination', async () => {
  const original = global.fetch;
  const calls = [];
  try {
    global.fetch = async (address, options) => {
      calls.push(address);
      assert.equal(options.headers['x-goog-api-key'], 'test-key');
      assert.ok(!address.includes('test-key'));
      return { ok: true, json: async () => calls.length === 1
        ? { models: [entry('gemini-pro'), entry('gemini-3.8-flash', ['embedContent'])], nextPageToken: 'page2' }
        : { models: [entry('gemini-3.1-flash-lite')] } };
    };
    assert.equal(await resolveGeminiModel('test-key', undefined, 'auto'), 'gemini-3.1-flash-lite');
    assert.equal(calls.length, 2);
    assert.match(calls[1], /pageToken=page2/);
  } finally { global.fetch = original; }
});

test('auto does not silently select paid-only or image models', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ models: [entry('gemini-pro'), entry('gemini-2.5-flash-image')] }) });
    await assert.rejects(resolveGeminiModel('test-key', undefined, 'auto'), /未调用其他付费模型/);
  } finally { global.fetch = original; }
});

test('explicit model supports models prefix and rejects invalid paths', async () => {
  assert.equal(await resolveGeminiModel('test-key', undefined, ' models/gemini-3.1-flash-lite '), 'gemini-3.1-flash-lite');
  await assert.rejects(resolveGeminiModel('test-key', undefined, '../other'), /模型配置无效/);
});

test('404 explains model access, includes provider reason, and redacts secrets', async () => {
  const error = await apiError({ status: 404, json: async () => ({ error: { message: 'Model not available. Key test-secret-key AIzaOtherSecret' } }) }, 'test-secret-key', 'gemini-2.5-flash');
  assert.match(error.message, /GEMINI_MODEL 设为 auto/);
  assert.match(error.message, /Model not available/);
  assert.ok(!error.message.includes('test-secret-key'));
  assert.ok(!error.message.includes('AIzaOtherSecret'));
});

test('invalid credentials fail model discovery without generation or retries', async () => {
  const original = global.fetch;
  let count = 0;
  try {
    global.fetch = async () => { count++; return { ok: false, status: 403, json: async () => ({ error: { message: 'API key blocked' } }) }; };
    await assert.rejects(resolveGeminiModel('test-key', undefined, 'auto'), /没有访问权限.*API key blocked/);
    assert.equal(count, 1);
  } finally { global.fetch = original; }
});

test('non-JSON rate-limit error still gives an actionable message', async () => {
  const error = await apiError({ status: 429, json: async () => { throw Error('not json'); } }, 'test-key');
  assert.match(error.message, /免费额度已用完/);
});
