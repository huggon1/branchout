import { load } from 'cheerio';
const periods = new Set(['daily', 'weekly', 'monthly']);
export class SourceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function count(value) {
  const text = value?.trim().replaceAll(',', '');
  return /^\d+$/.test(text ?? '') ? Number(text) : null;
}
export function parseTrending(html, period) {
  if (!periods.has(period)) throw new SourceError('invalid_config', '请选择日、周或月榜');
  const $ = load(html);
  const materials = [];
  $('article.Box-row').each((_, article) => {
    const row = $(article);
    const href = row.find('h2 a').attr('href');
    if (!/^\/[\w.-]+\/[\w.-]+$/.test(href ?? '')) return;
    const repo = href.slice(1);
    const description = row.find('p').first().text().trim();
    const gain = row.find('.float-sm-right').text().trim().match(/^([\d,]+)\s+stars?\s+(today|this week|this month)$/);
    materials.push({
      schemaVersion: 1, source: 'github', sourceId: repo.toLowerCase(),
      canonicalUrl: `https://github.com/${repo}`, title: repo, author: repo.split('/')[0],
      text: description, completeness: 'partial', publishedAt: null,
      metrics: { stars: count(row.find(`a[href="${href}/stargazers"]`).text()), forks: count(row.find(`a[href="${href}/forks"]`).text()), periodStars: gain ? count(gain[1]) : null },
      context: { period, rank: materials.length + 1 },
    });
  });
  if (!materials.length) throw new SourceError('source_changed', '未识别到 Trending 仓库列表，请检查平台页面是否变化');
  return materials;
}
export function selectMaterials(materials, { limit, thresholds = {} }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new SourceError('invalid_config', '每个平台的上限须为 1～100');
  for (const [name, value] of Object.entries(thresholds)) {
    if (!['stars', 'forks', 'periodStars'].includes(name) || !Number.isFinite(value) || value < 0) throw new SourceError('invalid_config', '筛选指标无效');
  }
  return materials.filter(item => Object.entries(thresholds).every(([name, min]) => Number.isFinite(item.metrics[name]) && item.metrics[name] >= min)).slice(0, limit);
}
export async function fetchTrending({ period = 'daily', limit = 20, thresholds = {}, signal } = {}) {
  if (!periods.has(period)) throw new SourceError('invalid_config', '无效榜单周期');
  const response = await fetch(`https://github.com/trending?since=${period}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000), headers: { 'User-Agent': 'Feedloom/0.1', Accept: 'text/html' } });
  if (!response.ok) throw new SourceError(response.status === 429 ? 'rate_limited' : 'unavailable', `GitHub 请求失败（${response.status}）`);
  const html = await response.text();
  if (html.length > 5_000_000) throw new SourceError('invalid_response', '平台响应过大');
  const all = parseTrending(html, period);
  return { schemaVersion: 1, platform: 'github', status: 'success', period, discovered: all.length, materials: selectMaterials(all, { limit, thresholds }) };
}
