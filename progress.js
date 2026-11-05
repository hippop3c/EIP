import { parseMaintenance } from './parsers/maintenance.js';
import { parseVehicles, parseStaffing } from './parsers/dispatch.js';
import { parseRepairs, parseAir, parseSleeves, parseLocks } from './parsers/projects.js';

export function parseCSV(text) {
  if (/<(?:!doctype|html)[\s>]/i.test(text.slice(0, 200))) throw new Error('來源要求登入，未取得 CSV 資料');
  const rows = []; let row = [], field = '', quoted = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === '') quoted = !quoted;
      else field += c;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV 引號不完整');
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.some(r => r.some(v => v.trim()))) throw new Error('來源沒有資料');
  return rows;
}

export function validateExportURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' ||
      !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/export$/.test(url.pathname) ||
      url.searchParams.get('format') !== 'csv') throw new Error('不是已核對的 Google 試算表 CSV 來源');
  return url.href;
}

const parsers = { maintenance: parseMaintenance, vehicles: parseVehicles, staffing: parseStaffing, repairs: parseRepairs, air: parseAir, sleeves: parseSleeves, locks: parseLocks };

export async function refreshForms(forms, onUpdate = () => {}, options = {}) {
  const fetcher = options.fetcher || fetch;
  const output = forms.map(f => ({ ...f }));
  let done = 0, next = 0;
  async function worker() {
    while (next < output.length) {
      const i = next++, form = output[i];
      if (form.fetchSpec) {
        try {
          const url = validateExportURL(form.fetchSpec.url);
          const parser = parsers[form.fetchSpec.parser];
          if (!parser) throw new Error('此表尚未建立經核對的進度解析規則');
          const response = await fetcher(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error(`來源回應 ${response.status}，可能需要登入`);
          const body = await response.text();
          if (body.length > 4_000_000) throw new Error('摘要超出預期大小，保留已核對資料');
          const progress = parser(parseCSV(body), { readAt: new Date().toISOString(), sourceUrl: form.url });
          form.progress = { ...progress, state: 'ok' };
          form.refreshError = null;
        } catch (error) {
          form.refreshError = `本次未更新：${error.message}。保留上次已核對資料。`;
        }
      }
      onUpdate(form, ++done, output.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, output.length) }, worker));
  return output;
}
