const vehicleBook = '1nwSd7m2fPmm4s_CQfJeXDI1Nkqe5HMIoQiTaIK7pvZ0';
const staffingBook = '1whbvCoJLeTv1z2hhOHCVJXLBXY-KWJOQqiV8zmAdw1I';
const sheetUrl = (book, gid) => `https://docs.google.com/spreadsheets/d/${book}/edit?gid=${gid}#gid=${gid}`;
const csvUrl = (book, gid, range) => `https://docs.google.com/spreadsheets/d/${book}/export?format=csv&gid=${gid}&range=${encodeURIComponent(range)}`;

export const fetchSpecs = {
  vehicles: {
    name: '調度車車輛狀況統計', parser: 'vehicles', spreadsheetId: vehicleBook,
    gid: '1103603358', sheetName: '車輛里程總表', range: 'M:U',
    url: csvUrl(vehicleBook, '1103603358', 'M:U'),
    sourceUrl: sheetUrl(vehicleBook, '1103603358')
  },
  staffing: {
    name: '人力缺口', parser: 'staffing', spreadsheetId: staffingBook,
    gid: '978821517', sheetName: '計算', range: 'A1:M55',
    url: csvUrl(staffingBook, '978821517', 'A1:M55'),
    sourceUrl: sheetUrl(staffingBook, '978821517')
  }
};

const text = value => String(value ?? '').trim();

function isoDate(value) {
  const match = text(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

function integer(value) {
  const normalized = text(value).replaceAll(',', '');
  if (!/^\d+$/.test(normalized)) throw new Error('人力摘要缺少有效人數，保留前次快照');
  const result = Number(normalized);
  if (!Number.isSafeInteger(result)) throw new Error('人力摘要人數超出有效範圍');
  return result;
}

export function parseVehicles(rows, {readAt = new Date().toISOString(), sourceUrl = fetchSpecs.vehicles.sourceUrl} = {}) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error('車況摘要沒有表格資料');
  const header = rows[0];
  // Support the restricted M:U response and a full source CSV during independent verification.
  const offset = /車號/.test(text(header[0])) ? 0 : /車號/.test(text(header[12])) ? 12 : -1;
  if (offset < 0 || text(header[offset + 5]) !== '日期' || text(header[offset + 8]) !== '車輛狀態') {
    throw new Error('車況來源欄位已變動，保留前次快照');
  }
  const seen = new Set();
  const dates = [];
  let withStatus = 0;
  let missingDate = 0;
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) throw new Error('車況摘要列格式錯誤');
    const identifier = text(row[offset]);
    const match = identifier.match(/^([A-Z]{2,3}-\d{3,4}|\d{3,4}-[A-Z][A-Z0-9]{1,2})(?:\([^)]*\))?$/);
    if (!match) {
      if (identifier) throw new Error('車況車號欄位無法辨識，保留前次快照');
      continue;
    }
    const plate = match[1];
    if (row.length < offset + 9) throw new Error('車況資料被截斷，保留前次快照');
    if (seen.has(plate)) throw new Error('車況名冊含重複車號，保留前次快照');
    seen.add(plate);
    if (text(row[offset + 8])) withStatus++;
    const rawDate = text(row[offset + 5]);
    if (!rawDate) { missingDate++; continue; }
    const date = isoDate(rawDate);
    if (!date) throw new Error('車況日期無法辨識，保留前次快照');
    dates.push(date);
  }
  if (!seen.size || !dates.length) throw new Error('車況名冊或日期缺失，保留前次快照');
  const asOf = dates.sort().at(-1);
  return {
    state: 'ok', title: '調度車車輛狀況統計',
    summary: `名冊列管 ${seen.size} 輛，${withStatus} 輛填有車況註記；最新里程紀錄日期 ${asOf}。`,
    metrics: [
      {label: '列管車輛', value: seen.size, unit: '輛'},
      {label: '有車況註記', value: withStatus, unit: '輛'},
      {label: '未填車況', value: seen.size - withStatus, unit: '輛'}
    ],
    asOf, readAt,
    notes: [
      '以「車輛里程總表」M欄不重複車號計數，U欄只判斷是否填有註記；註記包含保養、維修與報廢等，不能等同故障數。',
      '未填車況不能視為正常；列管數不能視為目前可用車輛數。',
      '資料截至日期取R欄最新里程紀錄日期，各車紀錄日期不同；不是全表更新時間，也不是表首「今天」。',
      ...(missingDate ? [`另有 ${missingDate} 輛未填里程日期。`] : [])
    ],
    sourceUrl
  };
}

export function parseStaffing(rows, {readAt = new Date().toISOString(), sourceUrl = fetchSpecs.staffing.sourceUrl} = {}) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error('人力摘要沒有表格資料');
  const periodStart = isoDate(rows[0][4]);
  const asOf = isoDate(rows[0][5]);
  if (!periodStart || !asOf || periodStart > asOf) throw new Error('人力摘要期間缺失，保留前次快照');
  const areas = new Set();
  const sections = [];
  let active = null;
  const requiredHeaders = {0: '分區', 1: '需求', 2: '日實際', 3: '夜實際', 4: 'FT缺額', 5: '本週報到', 6: '小計', 7: 'PT缺額', 8: '本週報到', 9: '小計'};
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) throw new Error('人力摘要列格式錯誤');
    const label = text(row[0]);
    if (!row.some(cell => text(cell))) continue;
    if (label === '分區') {
      if (active) throw new Error('人力摘要區塊缺少合計');
      if (!Object.entries(requiredHeaders).every(([column, expected]) => text(row[column]) === expected)) {
        throw new Error('人力摘要欄位已變動，保留前次快照');
      }
      active = {areas: 0, sums: Array(9).fill(0)};
      continue;
    }
    if (!active) throw new Error('人力摘要範圍包含非預期資料');
    if (label === '合計') {
      const totals = row.slice(1, 10).map(integer);
      if (totals.length !== 9 || !active.areas || !totals.every((value, index) => value === active.sums[index])) {
        throw new Error('人力明細與合計無法核對，保留前次快照');
      }
      sections.push(active); active = null; continue;
    }
    if (!/^[A-Z]\d?$/.test(label) || areas.has(label)) throw new Error('人力分區缺失或重複，保留前次快照');
    const values = row.slice(1, 10).map(integer);
    if (values.length !== 9 || values[0] !== values[1] + values[2] + values[3]) {
      throw new Error('人力需求、實際人數與FT缺額無法核對');
    }
    areas.add(label); active.areas++;
    values.forEach((value, index) => { active.sums[index] += value; });
  }
  if (active || sections.length !== 3 || !areas.size) throw new Error('人力摘要區塊不完整，保留前次快照');
  const sums = sections.reduce((all, section) => all.map((value, index) => value + section.sums[index]), Array(9).fill(0));
  const ft = sums[3];
  const pt = sums[6];
  return {
    state: 'ok', title: '人力缺口',
    summary: `${areas.size} 個分區，FT 缺額 ${ft} 人、PT 缺額 ${pt} 人；統計期間 ${periodStart} 至 ${asOf}。`,
    metrics: [
      {label: 'FT缺額', value: ft, unit: '人'},
      {label: 'PT缺額', value: pt, unit: '人'},
      {label: '涵蓋分區', value: areas.size, unit: '區'}
    ],
    asOf, readAt,
    notes: [
      '取「計算」頁三個互斥分區區塊；分別加總E欄FT缺額與H欄PT缺額，與各區塊合計列交叉核對，不重複計入小計。',
      `FT需求 ${sums[0]} 人，日實際 ${sums[1]} 人、夜實際 ${sums[2]} 人；需求減去日夜實際等於FT缺額 ${ft} 人。`,
      'FT與PT分開呈現；資料截至日期取F1統計期間終日。原始目錄連到「排程」，摘要改讀「計算」。'
    ],
    sourceUrl
  };
}
