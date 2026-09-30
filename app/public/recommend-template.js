(function (root) {
  function formatForumTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  }
  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function formatLetter({ date, forum, posts }) {
    const [, , month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) || [];
    if (!month) return '';
    const heading = forum.id === 'romance' ? '星坛' : forum.name;
    const entries = posts.map((p, i) => `${i + 1}，${p.reason || '【请填写推荐原因】'}\n标题：${p.title}\n来源：${p.author || '【请核对作者】'}\n${p.sourceUrl}`);
    return `您好，网管\n\n${Number(month)}月${Number(day)}日的${heading}优秀作品推荐：\n\n${entries.join('\n\n')}\n\n谢谢支持\n${forum.name}。`;
  }
  const api = { localDate, formatLetter, formatForumTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecommendTemplate = api;
})(typeof window === 'undefined' ? globalThis : window);
