export const fetchSpec = {
  url: 'https://docs.google.com/spreadsheets/d/1-oGpgxBkYOD1jHXS5imCi1aWJ-OKRrru0AdI1M8kFsk/export?format=csv&gid=0&range=A1:G7',
  parser: 'maintenance'
};

const defaultSourceUrl = 'https://docs.google.com/spreadsheets/d/1-oGpgxBkYOD1jHXS5imCi1aWJ-OKRrru0AdI1M8kFsk/edit?gid=0#gid=0';

function numberCell(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('維護摘要含空白或無效數值');
  return Number(text);
}

function isoDate(value) {
  const match = String(value ?? '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(result)) ? null : result;
}

export function parseMaintenance(rows, {readAt = new Date().toISOString(), sourceUrl = defaultSourceUrl} = {}) {
  if (!Array.isArray(rows) || !rows.some(row => /無助力.*電機/.test(String(row?.[0] ?? '')))) {
    throw new Error('維護表並非無助力更換電機專案');
  }
  const header = rows.find(row => row?.[1] === '異常車輛數' && row?.[2] === '更換電機車輛數' && row?.[3] === '剩餘車輛數');
  const total = rows.find(row => row?.[0] === '總計');
  if (!header || !total) throw new Error('維護表缺少預期摘要欄位或總計');
  const abnormal = numberCell(total[1]);
  const replaced = numberCell(total[2]);
  const remaining = numberCell(total[3]);
  const percentText = String(total[4] ?? '').trim();
  if (!/^\d+(?:\.\d+)?%$/.test(percentText)) throw new Error('維護表缺少有效達成率');
  const percent = Number(percentText.slice(0, -1));
  if (replaced + remaining !== abnormal || percent > 100) throw new Error('維護表總計無法核對');
  const sections = ['3次以上', '2次', '1次'].map(label => {
    const row = rows.find(item => item?.[0] === label);
    if (!row) throw new Error(`維護表缺少${label}分類`);
    return {label, abnormal: numberCell(row[1]), replaced: numberCell(row[2]), remaining: numberCell(row[3]), rate: String(row[4] ?? '').trim(), note: String(row[5] ?? '').trim()};
  });
  for (const key of ['abnormal', 'replaced', 'remaining']) {
    const expected = {abnormal, replaced, remaining}[key];
    if (sections.reduce((sum, row) => sum + row[key], 0) !== expected) throw new Error('維護表分類與總計不一致');
  }
  const dateLabelRow = rows.findIndex(row => row?.some(cell => String(cell).includes('更新日期')));
  const dateLabelColumn = dateLabelRow < 0 ? -1 : rows[dateLabelRow].findIndex(cell => String(cell).includes('更新日期'));
  const asOf = dateLabelColumn < 0 ? null : isoDate(rows[dateLabelRow + 1]?.[dateLabelColumn]);
  return {
    state: 'ok',
    title: '2.0E無助力更換電機專案',
    summary: `已更換 ${replaced.toLocaleString('zh-TW')}／${abnormal.toLocaleString('zh-TW')} 輛，尚餘 ${remaining.toLocaleString('zh-TW')} 輛；原表達成率 ${percentText}。`,
    metrics: [
      {label: '異常車輛', value: abnormal, unit: '輛'},
      {label: '已更換電機', value: replaced, unit: '輛'},
      {label: '剩餘車輛', value: remaining, unit: '輛'},
      {label: '達成率', value: percent, unit: '%'}
    ],
    asOf,
    readAt,
    notes: [
      ...sections.filter(row => row.note).map(row => `${row.label}：${row.note}`),
      '達成率沿用原表顯示值。',
      ...(asOf ? [] : ['來源未提供可辨識的更新日期。'])
    ],
    details: sections.map(row => ({label: row.label, value: `異常 ${row.abnormal} 輛／已更換 ${row.replaced} 輛／剩餘 ${row.remaining} 輛／達成率 ${row.rate}`})),
    sourceUrl
  };
}
