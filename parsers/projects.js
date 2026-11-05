const num = value => {
  const text = String(value ?? '').trim().replaceAll(',', '');
  if (!/^\d+(?:\.\d+)?%?$/.test(text)) throw new Error('摘要數值空白或格式已變更');
  return Number(text.replace('%', ''));
};
const metric = (label, value, unit = '輛') => ({ label, value: num(value), unit });
function base(title, metrics, meta, asOf = null) {
  return { state: 'ok', title, summary: metrics.map(m => `${m.label} ${m.value.toLocaleString('zh-TW')}${m.unit}`).join('；'), metrics, asOf,
    readAt: meta.readAt || new Date().toISOString(), notes: asOf ? [] : ['原表未標示資料更新日期；讀取時間不代表資料日期。'], sourceUrl: meta.sourceUrl };
}
export function parseRepairs(rows, meta) {
  if (!rows[0]?.includes('>7天未返修數')) throw new Error('返修摘要欄位變更');
  const names = ['台北車機', '新北車機', '2.0E台北車機', '2.0E新北車機', '車鎖'];
  const items = names.map(name => { const row = rows.find(r => r[0] === name); if (!row) throw new Error('返修摘要品項不完整'); return row; });
  const metrics = [2, 3, 4, 5].map(col => ({ label: rows[0][col], value: items.reduce((s, r) => s + num(r[col]), 0), unit: '件' }));
  const result = base('車機車鎖返修紀錄', metrics, meta);
  result.notes.push('合計涵蓋台北／新北 2.0、2.0E 車機及車鎖；各指標期間依原表標示，不互相抵減。');
  return result;
}
export function parseAir(rows, meta) {
  const start = rows.findIndex(r => r[0] === '雙北' && r[1] === '目標數');
  if (start < 0 || rows[start+1]?.[1] !== '當月安裝數' || rows[start+3]?.[1] !== '累進達成率') throw new Error('保氣專案摘要欄位變更');
  const col = rows[0].indexOf('總計');
  if (col < 0) throw new Error('缺少保氣累進總計');
  const target = num(rows[start][col]), done = num(rows[start+1][col]);
  if (done > target) throw new Error('保氣專案已完成超過目標，需人工核對');
  return base('保氣專案', [metric('累進目標', target), metric('累進安裝', done), metric('距目標', target-done), metric('累進達成率', rows[start+3][col], '%')], meta);
}
export function parseSleeves(rows, meta) {
  if (!String(rows[0]?.[0]).includes('熱縮套管') || rows[1]?.[2] !== '已更換') throw new Error('套管摘要欄位變更');
  const row = rows.find(r => r[0] === '雙北'); if (!row) throw new Error('缺少雙北總計');
  if (num(row[2])+num(row[3]) !== num(row[1])) throw new Error('套管進度加總不符');
  return base('防水熱縮套管更換專案', [metric('車輛總數', row[1]), metric('已更換', row[2]), metric('待更換', row[3])], meta);
}
export function parseLocks(rows, meta) {
  if (!String(rows[0]?.[0]).includes('未觸發還車') || rows[1]?.[2] !== '已檢視') throw new Error('車鎖檢視摘要欄位變更');
  const row = rows.find(r => r[0] === '雙北'); if (!row) throw new Error('缺少雙北總計');
  if (num(row[2])+num(row[4]) !== num(row[1])) throw new Error('車鎖檢視進度加總不符');
  const date = rows[0].find(c => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(c));
  const asOf = date ? date.split('/').map((x,i) => i ? x.padStart(2,'0') : x).join('-') : null;
  return base('未觸發還車流程車鎖異常專案', [metric('已檢視', row[2]), metric('待檢視', row[4]), metric('異常數', row[6]), metric('檢視進度', row[5], '%')], meta, asOf);
}
