const API = 'https://generativelanguage.googleapis.com/v1beta';

// Text models with a published free tier. Never select an arbitrary Pro, image,
// preview, or paid-only model merely because it appears in ListModels.
// Availability and free-tier quota still depend on the user's Google project.
const FREE_TEXT_MODELS = [
  'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite', 'gemini-2.5-flash'
];

async function apiError(response, key, model = '') {
  let detail = '';
  try {
    const data = await response.json();
    detail = String(data.error?.message || '').split(key).join('[密钥已隐藏]')
      .replace(/AIza[\w-]+/g, '[密钥已隐藏]').replace(/\s+/g, ' ').slice(0, 450);
  } catch { /* Some proxies return HTML instead of Google's JSON error. */ }
  let message;
  if (response.status === 404) {
    message = model
      ? `Gemini 模型 ${model} 不存在或当前项目不可用（HTTP 404）。请将 GEMINI_MODEL 设为 auto 后重启服务。`
      : '无法读取 Gemini 模型列表（HTTP 404）。请确认使用的是 Google AI Studio 的 Gemini API 密钥。';
  } else if (response.status === 429) {
    message = 'Gemini 免费额度已用完或请求过于频繁，请稍后重试，或手动填写推荐原因。';
  } else if ([401, 403].includes(response.status)) {
    message = `Gemini 密钥或项目没有访问权限（HTTP ${response.status}）。请在 Google AI Studio 检查密钥、API 限制及地区支持。`;
  } else {
    message = `Gemini 请求失败（HTTP ${response.status}${model ? `，模型 ${model}` : ''}）。`;
  }
  return new Error(message + (detail ? ` Google 返回：${detail}` : ''));
}

async function resolveGeminiModel(key, signal, configured = process.env.GEMINI_MODEL) {
  const requested = String(configured || 'auto').trim().replace(/^models\//, '');
  if (requested && requested !== 'auto') {
    if (!/^[a-zA-Z0-9.-]+$/.test(requested)) throw new Error('Gemini 模型配置无效，请将 GEMINI_MODEL 设为 auto。');
    return requested;
  }
  const available = new Set();
  const seenTokens = new Set();
  let nextPageToken = '';
  do {
    const url = new URL(`${API}/models`);
    url.searchParams.set('pageSize', '1000');
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
    const response = await fetch(url.href, { headers: { 'x-goog-api-key': key }, signal, redirect: 'error' });
    if (!response.ok) throw await apiError(response, key);
    const data = await response.json();
    for (const model of data.models || []) {
      if (model.supportedGenerationMethods?.includes('generateContent')) {
        available.add(String(model.name).replace(/^models\//, ''));
      }
    }
    nextPageToken = data.nextPageToken || '';
    if (nextPageToken && seenTokens.has(nextPageToken)) throw new Error('Gemini 模型列表分页异常，请稍后重试。');
    seenTokens.add(nextPageToken);
  } while (nextPageToken);
  const selected = FREE_TEXT_MODELS.find((name) => available.has(name));
  if (!selected) throw new Error('当前密钥未列出应用支持的免费层文本模型，请在 Google AI Studio 检查项目的可用模型。未调用其他付费模型。');
  return selected;
}

module.exports = { API, resolveGeminiModel, apiError };
