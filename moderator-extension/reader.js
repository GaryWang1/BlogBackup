// Serialized by chrome.scripting.executeScript; keep this function self-contained.
async function readModeratorPost(sourceUrl) {
  const unknown = (error) => ({ sourceUrl, status: 'unknown', error });
  try {
    const url = new URL(sourceUrl);
    const match = /^\/([a-zA-Z0-9_-]+)\/(\d+)\.html$/.exec(url.pathname);
    if (location.origin !== 'https://bbs.wenxuecity.com' || url.origin !== location.origin || !match || url.search || url.hash) return unknown('帖子地址无效');
    const response = await fetch(url.href, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return unknown('读取失败，请重试');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const menu = doc.querySelector('#adminmenu');
    if (!doc.querySelector('#postmeta') || !doc.querySelector('h1.title') || !menu) return unknown('请登录当前论坛的版主账号后重试');
    const expected = `/${match[1]}/moderator/menu/${match[2]}/`;
    const valid = [...menu.querySelectorAll('a.moderator[href]')].some((a) => {
      const link = new URL(a.getAttribute('href'), url);
      return link.origin === url.origin && link.pathname === expected && a.textContent.trim() === '管理菜单';
    });
    if (!valid) return unknown('无法确认当前论坛的版主权限');
    const text = menu.textContent.replace(/\s+/g, ' ');
    const recommended = /本文于\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*被推荐/.exec(text);
    if (recommended) return { sourceUrl, status: 'recommended', recommendedAt: recommended[1] };
    if (/被推荐/.test(text)) return unknown('推荐标记格式无法识别');
    return { sourceUrl, status: 'not-recommended' };
  } catch { return unknown('读取失败或登录已过期，请重试'); }
}
if (typeof module !== 'undefined') module.exports = readModeratorPost;
function readModeratorIdentity() {
  if (location.origin !== 'https://bbs.wenxuecity.com') return '';
  const anchor = document.querySelector('#toploginbox #login_in_box .username a[href]');
  if (!anchor) return '';
  try {
    const link = new URL(anchor.getAttribute('href'), location.href);
    if (link.origin !== location.origin || link.pathname !== '/members/' || !link.searchParams.get('u')) return '';
    return anchor.textContent.replace(/\s+/g, ' ').trim().slice(0, 100);
  } catch { return ''; }
}
if (typeof module !== 'undefined') module.exports.readModeratorIdentity = readModeratorIdentity;
