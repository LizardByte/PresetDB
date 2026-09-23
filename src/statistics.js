'use strict';

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

function svgFrame(title, description, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc" viewBox="0 0 880 ${height}">` +
    `<title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc>` +
    `<rect width="880" height="${height}" rx="12" fill="#17212d"/>` +
    `<style>text{font-family:Arial,sans-serif;fill:#f8f9fa}.muted{fill:#aeb7c2}.title{font-size:26px;font-weight:bold}.label{font-size:16px}.count{font-size:18px;font-weight:bold}</style>` +
    `<text class="title" x="32" y="48">${escapeXml(title)}</text>${content}</svg>\n`;
}

function contributionHistory(records) {
  return records.flatMap(record => record.presets.flatMap(preset => preset.history || []))
    .filter(item => item && ['add', 'replace'].includes(item.action));
}

function contributorSvg(history) {
  const contributors = new Map();
  for (const item of history) {
    if (!item.author_login) continue;
    const key = item.author_id == null ? item.author_login.toLowerCase() : String(item.author_id);
    const prior = contributors.get(key) || { login: item.author_login, count: 0 };
    prior.login = item.author_login;
    prior.count += 1;
    contributors.set(key, prior);
  }
  const top = [...contributors.values()].sort((a, b) => b.count - a.count || a.login.localeCompare(b.login)).slice(0, 10);
  if (top.length === 0) {
    return svgFrame('Contribution leaderboard', 'No approved contributions yet.', 150,
      '<text class="muted" x="32" y="100">No approved contributions yet</text>');
  }
  const maximum = top[0].count;
  const rows = top.map((item, index) => {
    const y = 91 + index * 47;
    const width = Math.max(4, Math.round(480 * item.count / maximum));
    return `<text class="label" x="32" y="${y + 20}">${escapeXml(item.login)}</text>` +
      `<rect x="300" y="${y}" width="${width}" height="26" rx="4" fill="#ffc107"/>` +
      `<text class="count" x="825" y="${y + 20}" text-anchor="end">${item.count}</text>`;
  }).join('');
  return svgFrame('Contribution leaderboard', 'Approved new and replacement preset submissions by GitHub user.',
    105 + top.length * 47, rows);
}

function growthSvg(history) {
  const additions = history.filter(item => item.action === 'add' && typeof item.approved_at === 'string' &&
    !Number.isNaN(Date.parse(item.approved_at)))
    .sort((a, b) => Date.parse(a.approved_at) - Date.parse(b.approved_at));
  if (additions.length === 0) {
    return svgFrame('Preset growth', 'No approved presets yet.', 300,
      '<text class="muted" x="32" y="155">No approved presets yet</text>');
  }
  const points = additions.map((_, index) => {
    const x = additions.length === 1 ? 440 : 70 + index * 740 / (additions.length - 1);
    const y = 245 - (index + 1) * 145 / additions.length;
    return [Math.round(x), Math.round(y)];
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const dots = points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="#ffc107"/>`).join('');
  const firstDate = additions[0].approved_at.slice(0, 10);
  const lastDate = additions.at(-1).approved_at.slice(0, 10);
  const content = '<line x1="70" y1="245" x2="810" y2="245" stroke="#aeb7c2"/>' +
    `<polyline points="${line}" fill="none" stroke="#ffc107" stroke-width="4"/>${dots}` +
    `<text class="muted" x="70" y="275">${escapeXml(firstDate)}</text>` +
    `<text class="muted" x="810" y="275" text-anchor="end">${escapeXml(lastDate)}</text>` +
    `<text class="count" x="810" y="82" text-anchor="end">${additions.length} presets</text>`;
  return svgFrame('Preset growth', 'Cumulative number of approved new presets by approval date.', 300, content);
}

function buildStatistics(index, records) {
  const history = contributionHistory(records);
  return {
    data: {
      schema_version: 1,
      game_count: index.games.length,
      app_count: index.apps.length,
      preset_count: records.reduce((total, record) => total + record.presets.length, 0),
      contribution_count: history.length
    },
    contributorsSvg: contributorSvg(history),
    growthSvg: growthSvg(history)
  };
}

module.exports = { buildStatistics, contributionHistory, contributorSvg, growthSvg };
