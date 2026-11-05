import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCSV, refreshForms, validateExportURL } from '../progress.js';
import { parseMaintenance } from '../parsers/maintenance.js';

test('CSV handles Chinese, BOM, quoted commas, escaped quotes and multiline cells', () => {
  assert.deepEqual(parseCSV('\uFEFF名稱,說明\r\n"車機,車鎖","第一行\n第二行"\r\n"引號""測試",0'), [['名稱','說明'],['車機,車鎖','第一行\n第二行'],['引號"測試','0']]);
  assert.throws(() => parseCSV('"未關閉'), /引號/);
  assert.throws(() => parseCSV('<!doctype html><html>請登入</html>'), /登入/);
});

const maintenanceRows = [['3X無助力更換電機專案','','','','','更新日期：'],['','','','','','2026/11/5'],['','異常車輛數','更換電機車輛數','剩餘車輛數','達成率'],['3次以上','49','48','1','98.00%'],['2次','139','98','41','70.50%'],['1次','465','0','465','0.00%'],['總計','653','146','507','22.40%']];
test('Verified maintenance snapshot balances and a missing value is never zero', () => {
  const result = parseMaintenance(maintenanceRows);
  assert.equal(result.asOf, '2026-11-05');
  assert.deepEqual(result.metrics.map(m=>m.value), [653,146,507,22.4]);
  const missing = structuredClone(maintenanceRows); missing[6][2] = '';
  assert.throws(()=>parseMaintenance(missing), /空白|無效/);
  const changed = structuredClone(maintenanceRows); changed[6][3] = '508';
  assert.throws(()=>parseMaintenance(changed), /核對/);
});

test('A login response preserves the verified snapshot and reports the failure', async () => {
  const source={id:'main',url:'https://docs.google.com/spreadsheets/d/test/edit?gid=0',fetchSpec:{url:'https://docs.google.com/spreadsheets/d/test/export?format=csv&gid=0',parser:'maintenance'},progress:parseMaintenance(maintenanceRows)};
  const [after] = await refreshForms([source],()=>{}, {fetcher:async()=>({ok:true,text:async()=>'<html>登入</html>'})});
  assert.deepEqual(after.progress,source.progress);
  assert.match(after.refreshError,/保留上次/);
  assert.equal(source.refreshError,undefined);
});

test('Only approved Google CSV exports are refreshed; private snapshots are untouched', async () => {
  assert.throws(()=>validateExportURL('https://docs.google.com.example.org/spreadsheets/d/test/export?format=csv'));
  assert.throws(()=>validateExportURL('javascript:alert(1)'));
  let fetched = false;
  const source = {id:'private',progress:{state:'ok',metrics:[{label:'原表本週來電（部分）',value:44}],readAt:'2026-11-05'}};
  const [after]=await refreshForms([source],()=>{}, {fetcher:()=>{fetched=true;throw Error();}});
  assert.equal(fetched,false); assert.deepEqual(after,source);
});

test('Directory has unique IDs, all 3 groups, safe links and explicit missing data', async () => {
  const data=JSON.parse(await readFile(new URL('../data/dashboard.json',import.meta.url),'utf8'));
  assert.equal(new Set(data.forms.map(f=>f.id)).size,data.forms.length);
  assert.equal(data.forms.length,58);
  assert.deepEqual(data.groups.map(g=>g.name),['調度','維護','客服']);
  for (const group of data.groups) for(const id of [...group.formIds,...group.focusIds]) assert.ok(data.forms.some(f=>f.id===id&&f.group===group.name));
  for(const form of data.forms) {
    if(form.url){ const url=new URL(form.url); assert.equal(url.hostname,'docs.google.com');assert.equal(url.searchParams.has('sharingaction'),false); }
    if(form.progress.state === 'offline'){assert.equal(form.url,null);assert.deepEqual(form.progress.metrics,[]);}
    for(const metric of form.progress.metrics) if(typeof metric.value==='number') assert.ok(Number.isFinite(metric.value));
  }
});
