import { refreshForms } from './progress.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`eip_dashboard_${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`eip_dashboard_${key}`, JSON.stringify(value)); } catch { /* The current session remains usable. */ } }
};
const state = { data: null, forms: [], group: 'all', keyword: '', favoritesOnly: false, selected: new Set(storage.get('selected', [])), favorites: new Set(storage.get('favorites', [])), recent: storage.get('recent', []), refreshing: false };
const groupStyle = { '調度': { symbol: '↗', english: 'DISPATCH', index: '01', subtitle: '車輛狀況與人力調度' }, '維護': { symbol: '⚙', english: 'MAINTENANCE', index: '02', subtitle: '維修專案與執行進度' }, '客服': { symbol: '◎', english: 'CUSTOMER SERVICE', index: '03', subtitle: '全台異常追蹤與服務作業' } };
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; } };
const dateLabel = value => { if (!value) return '來源未標示日期'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',...(String(value).includes('T') ? {hour:'2-digit',minute:'2-digit',hour12:false} : {}) }).format(parsed); };
const numberLabel = value => typeof value === 'number' ? value.toLocaleString('zh-TW', {maximumFractionDigits:2}) : String(value ?? '—');
function notice(message, warning = false) { $('notice').textContent = message; $('notice').hidden = !message; $('notice').classList.toggle('warning', warning); }
function progressOf(form) { return form.progress || {state:form.url ? 'unavailable' : 'offline',title:form.name,summary:form.url ? '尚未取得可驗證的最新進度，請開啟原表單查看。' : '原始清單標示為線下表單，尚未提供最新進度。',metrics:[],notes:[]}; }
function refreshWarning(form) { return form.refreshError ? `<p class="freshness-warning" role="note">${esc(form.refreshError)}</p>` : ''; }
function importantNotes(form) { const notes = form.group === '客服' ? (progressOf(form).notes || []).filter(note => /差異|差額|不一致|不符|矛盾|口徑|對不上|相差|勾稽/.test(note)).slice(0, 1) : []; return notes.length ? `<p class="data-caveat" role="note">${notes.map(esc).join('；')}</p>` : ''; }
function progressStateLabel(progress) { return ({ok:'已讀取來源',offline:'線下表單',empty:'尚無填報資料',restricted:'需要存取權'})[progress.state] || '待確認進度'; }
function stateTag(progress) { return `<span class="state-tag ${esc(progress.state)}">${progressStateLabel(progress)}</span>`; }
function metricMarkup(progress, limit = 4) { return (progress.metrics || []).length ? `<div class="metrics">${progress.metrics.slice(0, limit).map(metric => `<div class="metric"><div class="metric-value">${esc(numberLabel(metric.value))}${metric.unit ? `<span class="metric-unit">${esc(metric.unit)}</span>` : ''}</div><div class="metric-label">${esc(metric.label)}</div></div>`).join('')}</div>` : ''; }
function sourceLink(form, label = '查看原表 ↗') { const url = safeUrl(progressOf(form).sourceUrl || form.url); return url ? `<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(form.id)}">${label}</a>` : ''; }
function matches(form) { const progress = progressOf(form); return (state.group === 'all' || form.group === state.group) && (!state.favoritesOnly || state.favorites.has(form.id)) && (!state.keyword || `${form.name} ${form.group} ${form.purpose || ''} ${progress.summary || ''}`.toLocaleLowerCase().includes(state.keyword)); }
function visibleForms() { return state.forms.filter(matches); }
function focusMarkup(form) { const progress = progressOf(form); return `<div class="focus-item"><div class="focus-title"><span>${esc(progress.title || form.name)}</span>${sourceLink(form)}</div>${refreshWarning(form)}${metricMarkup(progress)}<p class="progress-summary">${esc(progress.summary)}</p>${importantNotes(form)}${(progress.notes || []).length ? `<details class="progress-details"><summary>資料說明</summary><ul class="progress-notes">${progress.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul></details>` : ''}<p class="progress-date">${progress.asOf ? `資料期間：${esc(dateLabel(progress.asOf))}` : '來源未標示統計日期'}${progress.readAt ? ` · 擷取 ${esc(dateLabel(progress.readAt))}` : ''}</p></div>`; }
function rowMarkup(form) {
  const progress = progressOf(form), url = safeUrl(form.url), selected = state.selected.has(form.id), favorite = state.favorites.has(form.id);
  return `<li class="form-row${selected ? ' selected' : ''}"><input id="check-${esc(form.id)}" class="form-checkbox" type="checkbox" data-select="${esc(form.id)}" ${selected ? 'checked' : ''} aria-label="選取 ${esc(form.name)}"><div class="form-content"><div class="form-name">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(form.id)}">${esc(form.name)}<span class="external-mark" aria-hidden="true">↗</span></a>` : `<label for="check-${esc(form.id)}">${esc(form.name)}</label>`}</div><p class="form-purpose">${esc(form.purpose || '專案追蹤與進度管理')}</p><div class="form-labels">${stateTag(progress)}${progress.asOf ? `<span class="mini-time">${esc(dateLabel(progress.asOf))}</span>` : ''}</div></div><button class="favorite-button" type="button" data-favorite="${esc(form.id)}" aria-label="${favorite ? '移除最愛' : '加入最愛'}：${esc(form.name)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button></li>`;
}
function renderGroups() {
  const names = ['調度', '維護', '客服']; const visible = visibleForms();
  $('groupCards').classList.toggle('filtered', state.group !== 'all');
  $('formCount').textContent = `${visible.length} / ${state.forms.length} 份表單`;
  $('selectVisible').disabled = !visible.length;
  $('groupCards').innerHTML = names.filter(name => state.group === 'all' || name === state.group).map(name => {
    const style = groupStyle[name], all = state.forms.filter(form => form.group === name), list = visible.filter(form => form.group === name);
    const group = state.data.groups?.find(group => group.name === name); const ids = group?.focusIds || [];
    const focus = ids.map(id => all.find(form => form.id === id)).filter(Boolean);
    return `<article class="group-card" data-group="${name}"><div class="group-card-head"><span class="group-symbol" aria-hidden="true">${style.symbol}</span><div><h2>${name}組</h2><p>${style.english}</p></div><span class="group-index">${style.index}</span></div><div class="focus-progress">${focus.length ? focus.map(focusMarkup).join('') : `<p class="progress-summary">${esc(group?.subtitle || style.subtitle)}</p>`}</div><div class="group-directory"><div class="list-heading">${name}組表單<span>${list.length === all.length ? `${all.length} 份表單` : `顯示 ${list.length} / ${all.length}`}</span></div><ul class="form-list">${list.length ? list.map(rowMarkup).join('') : '<li class="empty-list">沒有符合條件的表單</li>'}</ul></div></article>`;
  }).join('');
}
function renderSelection() {
  const list = state.forms.filter(form => state.selected.has(form.id));
  $('selectedCount').textContent = String(list.length); $('dockCount').textContent = String(list.length);
  $('selectionDock').hidden = !list.length;
  ['copyButton','csvButton','clearSelection'].forEach(id => $(id).disabled = !list.length);
  $('selectedProgress').innerHTML = list.length ? list.map(form => { const progress = progressOf(form); return `<article class="selected-card"><div class="selected-card-top"><span>${esc(form.group)}組 · ${stateTag(progress)}</span><button type="button" class="remove-selection" data-remove="${esc(form.id)}" aria-label="取消選取 ${esc(form.name)}">×</button></div><h3>${esc(form.name)}</h3>${refreshWarning(form)}${metricMarkup(progress, 6)}<p class="progress-summary">${esc(progress.summary)}</p>${importantNotes(form)}${(progress.notes || []).length ? `<ul class="progress-notes">${progress.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}${progress.details?.length ? `<details class="progress-details"><summary>查看統計明細</summary><dl>${progress.details.map(detail => `<dt>${esc(detail.label)}</dt><dd>${esc(numberLabel(detail.value))}</dd>`).join('')}</dl></details>` : ''}<div class="selected-card-footer"><p class="progress-date">${progress.asOf ? `資料：${esc(dateLabel(progress.asOf))}` : '來源未標示日期'}${progress.readAt ? ` · 擷取 ${esc(dateLabel(progress.readAt))}` : ''}</p>${sourceLink(form)}</div></article>`; }).join('') : '<div class="selection-empty"><span class="empty-icon" aria-hidden="true">☑</span><strong>建立你的進度摘要</strong><p>選取需要關注的表單，跨組進度也能一起檢視。</p></div>';
}
function renderRecent() {
  const list = state.recent.map(id => state.forms.find(form => form.id === id)).filter(form => form && safeUrl(form.url));
  $('recentSection').hidden = !list.length;
  $('recentLinks').innerHTML = list.map(form => `<a href="${esc(safeUrl(form.url))}" target="_blank" rel="noopener noreferrer" data-open="${esc(form.id)}">${esc(form.name)}</a>`).join('');
}
function persistSelection() { storage.set('selected', [...state.selected]); }
function refreshSelectionRows() { document.querySelectorAll('[data-select]').forEach(input => { input.checked = state.selected.has(input.dataset.select); input.closest('.form-row').classList.toggle('selected', input.checked); }); renderSelection(); }
function selectedText() { return state.forms.filter(form => state.selected.has(form.id)).map(form => { const progress = progressOf(form); return [`【${form.group}組】${form.name}`,...(form.refreshError ? [form.refreshError] : []),progress.summary,...(progress.metrics || []).map(metric => `${metric.label}：${numberLabel(metric.value)}${metric.unit || ''}`),`資料期間：${progress.asOf ? dateLabel(progress.asOf) : '未標示'}`,...(progress.notes || []),safeUrl(progress.sourceUrl || form.url) || '線下表單'].join('\n'); }).join('\n\n'); }
async function load() {
  try {
    const response = await fetch('./data/dashboard.json', {cache:'no-store'}); if (!response.ok) throw new Error('資料檔暫時無法讀取');
    const data = await response.json(); if (!Array.isArray(data.forms)) throw new Error('資料格式不完整');
    state.data = data; state.forms = data.forms;
    const ids = new Set(state.forms.map(form => form.id)); state.selected = new Set([...state.selected].filter(id => ids.has(id))); persistSelection();
    $('updatedAt').textContent = `快照擷取 ${dateLabel(data.generatedAt)} · 台北時間`;
    $('sourceInfo').textContent = `${String(data.sourceFile || '北營處統計報表連結').split(/[\\/]/).pop()}${data.catalogModifiedAt ? `；目錄修改時間 ${dateLabel(data.catalogModifiedAt)}` : ''}。目錄修改時間與各表單的統計日期分別顯示。`;
    const dataNotes = Array.isArray(data.notes) ? data.notes : data.notes ? [data.notes] : []; $('dataNotes').textContent = dataNotes.join('；'); $('dataNotes').hidden = !dataNotes.length;
    renderGroups(); renderSelection(); renderRecent();
  } catch (error) { $('groupCards').innerHTML = '<div class="loading-state">資料暫時無法載入。請稍後重新整理頁面。</div>'; $('updatedAt').textContent = '讀取失敗'; notice(error.message, true); $('refreshButton').disabled = true; }
}
document.addEventListener('change', event => { const id = event.target.dataset.select; if (!id) return; event.target.checked ? state.selected.add(id) : state.selected.delete(id); persistSelection(); refreshSelectionRows(); });
document.addEventListener('click', event => {
  const favorite = event.target.closest('[data-favorite]'); if (favorite) { const id = favorite.dataset.favorite; state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); storage.set('favorites', [...state.favorites]); renderGroups(); }
  const remove = event.target.closest('[data-remove]'); if (remove) { state.selected.delete(remove.dataset.remove); persistSelection(); refreshSelectionRows(); }
  const open = event.target.closest('[data-open]'); if (open) { const id = open.dataset.open; state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, 5); storage.set('recent', state.recent); queueMicrotask(renderRecent); }
  const tab = event.target.closest('[data-group].group-tab'); if (tab) { state.group = tab.dataset.group; document.querySelectorAll('.group-tab').forEach(button => { const active = button === tab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); if (state.data) renderGroups(); }
});
$('searchInput').addEventListener('input', event => { state.keyword = event.target.value.trim().toLocaleLowerCase(); if (state.data) renderGroups(); });
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) { event.preventDefault(); $('searchInput').focus(); } });
$('favoriteFilter').addEventListener('click', () => { state.favoritesOnly = !state.favoritesOnly; $('favoriteFilter').setAttribute('aria-pressed', String(state.favoritesOnly)); if (state.data) renderGroups(); });
$('selectVisible').addEventListener('click', () => { visibleForms().forEach(form => state.selected.add(form.id)); persistSelection(); refreshSelectionRows(); });
$('clearSelection').addEventListener('click', () => { state.selected.clear(); persistSelection(); refreshSelectionRows(); });
$('copyButton').addEventListener('click', async () => { try { await navigator.clipboard.writeText(selectedText()); notice('已複製選取表單的進度摘要。'); } catch { notice('瀏覽器未允許複製，請改用「下載 CSV」儲存進度。', true); } });
$('csvButton').addEventListener('click', () => {
  const rows = [['組別','表單名稱','資料狀態','最新進度','統計期間','擷取時間','統計指標','補充說明','本次更新限制','來源連結'],...state.forms.filter(form => state.selected.has(form.id)).map(form => { const progress = progressOf(form); return [form.group,form.name,progressStateLabel(progress),progress.summary,progress.asOf || '',progress.readAt || '',(progress.metrics || []).map(metric => `${metric.label}：${numberLabel(metric.value)}${metric.unit || ''}`).join('；'),(progress.notes || []).join('；'),form.refreshError || '',safeUrl(progress.sourceUrl || form.url) || '']; })];
  const quote = value => `"${String(value ?? '').replace(/^[=+@-]/, match => `'${match}`).replaceAll('"','""')}"`;
  const blob = new Blob(['\uFEFF',rows.map(row => row.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `EIP_專案進度_${new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei'}).format(new Date())}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notice('已下載選取表單的進度 CSV。');
});
$('refreshButton').addEventListener('click', async () => {
  if (!state.data || state.refreshing) return; state.refreshing = true; $('refreshButton').disabled = true; $('refreshButton').innerHTML = '<span aria-hidden="true">↻</span> 更新中…'; notice('正在讀取來源表單；無法存取的表單會保留上次快照。');
  try { const forms = await refreshForms(state.forms, (form, completed, total) => { if (form?.id && form.progress) { const index = state.forms.findIndex(item => item.id === form.id); if (index >= 0) state.forms[index] = form; } if (completed && total) $('updatedAt').textContent = `正在檢查 ${completed} / ${total}`; }); if (Array.isArray(forms)) state.forms = forms; const attempted = state.forms.filter(form => form.fetchSpec), failed = attempted.filter(form => form.refreshError).length, succeeded = attempted.length - failed, retained = state.forms.length - attempted.length; renderGroups(); renderSelection(); $('updatedAt').textContent = `本次檢查 ${dateLabel(new Date().toISOString())} · 台北時間`; notice(`本次成功更新 ${succeeded} 份、未更新 ${failed} 份；其餘 ${retained} 份保留既有快照或線下資料狀態。`, failed > 0); }
  catch { notice('目前無法更新來源，畫面保留上次可用的進度快照。', true); }
  finally { state.refreshing = false; $('refreshButton').disabled = false; $('refreshButton').innerHTML = '<span aria-hidden="true">↻</span> 更新進度'; }
});
const dark = storage.get('theme', 'light') === 'dark'; document.documentElement.classList.toggle('dark', dark);
function updateThemeLabel() { const isDark = document.documentElement.classList.contains('dark'); $('themeToggle').setAttribute('aria-label', isDark ? '切換淺色模式' : '切換深色模式'); $('themeToggle').title = isDark ? '切換淺色模式' : '切換深色模式'; }
updateThemeLabel(); $('themeToggle').addEventListener('click', () => { const isDark = document.documentElement.classList.toggle('dark'); storage.set('theme', isDark ? 'dark' : 'light'); updateThemeLabel(); });
load();
