/* ---------- state ---------- */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];   // Monday first
const HOUR_H = 48;

const state = {
  categories: structuredClone(DEFAULT_CATS),
  fallback: 'private',
  smart: false,
  tasks: [],
  events: [],
  mode: 'loading',         // loading | local
  loaded: false,
  view: 'overview',        // overview | calendar | cat:<id>
  calMode: 'week',         // week | month
  weekStart: mondayOf(startOfToday()),
  calMonth: (() => { const d = startOfToday(); d.setDate(1); return d; })(),
  calSel: todayStr(),
  hidden: new Set(),
  editing: null,
  editDraft: null,
  sorting: new Set(),
  draft: {},
  confirmDel: null,
  evEdit: null,
  wkScrollFor: null,
};

try { const v = localStorage.getItem('sortbox.view'); if (v) state.view = v; } catch (e) {}
try { const v = localStorage.getItem('sortbox.calMode'); if (v === 'week' || v === 'month') state.calMode = v; } catch (e) {}
try { const h = JSON.parse(localStorage.getItem('sortbox.hidden') || '[]'); state.hidden = new Set(h); } catch (e) {}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catById = id => state.categories.find(c => c.id === id) || state.categories.find(c => c.id === state.fallback) || state.categories[0];
const cvar = c => `--c: var(--cat-${c?.color || 1})`;
const toMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = n => { n = Math.max(0, Math.min(1439, Math.round(n))); return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`; };
const capEnd = e => (e === '24:00' ? '23:59' : e);
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  gcal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  rep: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="repeats"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 01-4 4H4"/></svg>',
};

/* ---------- labels ---------- */
function dueLabel(due) {
  const diff = daysBetween(todayStr(), due);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = parseYmd(due);
  const base = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  return d.getFullYear() !== new Date().getFullYear() ? `${base} ${d.getFullYear()}` : base;
}
function dueClass(t) {
  if (!t.due || t.done) return '';
  const diff = daysBetween(todayStr(), t.due);
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : '';
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function repeatLabel(ev) {
  if (ev.repeat === 'daily') return 'every day';
  if (ev.repeat === 'weekdays') return 'weekdays';
  if (ev.repeat === 'weekly') {
    const ds = (ev.days && ev.days.length ? ev.days : [parseYmd(ev.date).getDay()]);
    return 'every ' + WEEK_ORDER.filter(d => ds.includes(d)).map(d => DOW[d]).join(', ');
  }
  return '';
}

function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    if (a.time !== b.time) return (a.time || '') < (b.time || '') ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}
const openTasks = () => state.tasks.filter(t => !t.done);
const tasksOf = id => state.tasks.filter(t => (catById(t.cat)?.id) === id);
const visibleCat = id => !state.hidden.has(catById(id).id);

/* ---------- recurring events ---------- */
function occursOn(ev, ds) {
  if (!ev.date || ds < ev.date) return false;
  if (ev.until && ds > ev.until) return false;
  if ((ev.skip || []).includes(ds)) return false;
  const dow = parseYmd(ds).getDay();
  switch (ev.repeat) {
    case 'daily': return true;
    case 'weekdays': return dow >= 1 && dow <= 5;
    case 'weekly': return (ev.days && ev.days.length ? ev.days : [parseYmd(ev.date).getDay()]).includes(dow);
    default: return ds === ev.date;
  }
}
const eventsOn = ds => state.events.filter(ev => occursOn(ev, ds)).sort((a, b) => toMin(a.start) - toMin(b.start));
function firstOccurrence(ev) {
  for (let i = 0; i < 400; i++) { const ds = ymd(addDays(parseYmd(ev.date), i)); if (occursOn(ev, ds)) return ds; }
  return ev.date;
}
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function rrule(ev) {
  if (!ev.repeat || ev.repeat === 'none') return '';
  let r;
  if (ev.repeat === 'daily') r = 'FREQ=DAILY';
  else if (ev.repeat === 'weekdays') r = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  else r = 'FREQ=WEEKLY;BYDAY=' + (ev.days && ev.days.length ? ev.days : [parseYmd(ev.date).getDay()]).map(d => BYDAY[d]).join(',');
  if (ev.until) r += `;UNTIL=${ev.until.replace(/-/g, '')}T225959Z`;
  return 'RRULE:' + r;
}

/* ---------- Google Calendar + .ics ---------- */
const compact = (ds, t) => `${ds.replace(/-/g, '')}T${t.replace(':', '')}00`;
function gcalUrl(t) {
  const c = catById(t.cat);
  const d = t.due.replace(/-/g, '');
  let dates;
  if (t.time) {
    const e = fromMin(Math.min(toMin(t.time) + 60, 1439));
    dates = `${compact(t.due, t.time)}/${compact(t.due, e)}`;
  } else {
    dates = `${d}/${ymd(addDays(parseYmd(t.due), 1)).replace(/-/g, '')}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: t.title, dates, details: `Category: ${c.name} · from Sortbox`, ctz: 'Europe/Zagreb' });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function gcalEventUrl(ev) {
  const c = catById(ev.cat);
  const first = firstOccurrence(ev);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${compact(first, ev.start)}/${compact(first, ev.end)}`, details: `Category: ${c.name} · from Sortbox`, ctz: 'Europe/Zagreb' });
  const r = rrule(ev);
  if (r) p.set('recur', r);
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function buildIcs(tasks, events) {
  const e = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sortbox//Planner//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Sortbox'];
  for (const t of tasks) {
    const c = catById(t.cat);
    const d = t.due.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${t.id}@sortbox`, `DTSTAMP:${stamp}`);
    if (t.time) {
      lines.push(`DTSTART;TZID=Europe/Zagreb:${compact(t.due, t.time)}`, `DTEND;TZID=Europe/Zagreb:${compact(t.due, fromMin(Math.min(toMin(t.time) + 60, 1439)))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${ymd(addDays(parseYmd(t.due), 1)).replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${e(t.title)}`, `CATEGORIES:${e(c.name)}`, `DESCRIPTION:${e('Task · ' + c.name + ' · from Sortbox')}`, 'END:VEVENT');
  }
  for (const ev of events) {
    const c = catById(ev.cat);
    const first = firstOccurrence(ev);
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@sortbox`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Zagreb:${compact(first, ev.start)}`, `DTEND;TZID=Europe/Zagreb:${compact(first, ev.end)}`);
    const r = rrule(ev);
    if (r) lines.push(r);
    for (const s of ev.skip || []) lines.push(`EXDATE;TZID=Europe/Zagreb:${compact(s, ev.start)}`);
    lines.push(`SUMMARY:${e(ev.title)}`, `CATEGORIES:${e(c.name)}`, `DESCRIPTION:${e(c.name + ' · from Sortbox')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
async function exportIcs() {
  const tasks = state.tasks.filter(t => !t.done && t.due && !t.example);
  const events = state.events.filter(ev => !ev.example);
  if (!tasks.length && !events.length) { toast('Nothing with a date to export yet.'); return; }
  const ok = await saveFile(`sortbox-${todayStr()}.ics`, buildIcs(tasks, events), 'text/calendar');
  if (ok) toast(`Exported ${plural(tasks.length + events.length, 'item')}. In Google Calendar: Settings → Import & export.`);
}
async function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  // phones: hand the file to the share sheet, so it can go to Files, Drive or another app
  try {
    const file = new File([blob], name, { type });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

/* ---------- persistence (on this device) ---------- */
const STORE_KEY = 'sortbox.data.v1';
const newId = p => (p || 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let storageOk = true;
function snapshot() {
  return { app: 'sortbox', v: 1, savedAt: new Date().toISOString(), categories: state.categories, fallback: state.fallback, tasks: state.tasks, events: state.events };
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(snapshot()));
    if (!storageOk) { storageOk = true; setBanner(''); }
  } catch (e) {
    storageOk = false;
    setBanner('<span>This device isn’t letting Sortbox save (storage full, or a private window). Changes will be lost when you close it. Export a backup from Settings.</span>');
  }
}
function loadStored() {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function applyData(d) {
  if (Array.isArray(d.categories) && d.categories.length) state.categories = d.categories;
  if (typeof d.fallback === 'string' && state.categories.some(c => c.id === d.fallback)) state.fallback = d.fallback;
  state.tasks = Array.isArray(d.tasks) ? d.tasks.filter(x => x && x.id && x.title) : [];
  state.events = Array.isArray(d.events) ? d.events.filter(x => x && x.id && x.title && x.date) : [];
}
const keyOf = kind => (kind === 'events' ? 'events' : 'tasks');
async function putDoc(kind, id, data) {
  const arr = state[keyOf(kind)];
  const i = arr.findIndex(t => t.id === id);
  if (i >= 0) arr[i] = { id, ...data }; else arr.push({ id, ...data });
  persist(); render();
}
async function patchDoc(kind, id, patch) {
  const t = state[keyOf(kind)].find(t => t.id === id);
  if (t) Object.assign(t, patch);
  persist(); render();
}
async function deleteDoc(kind, id) {
  state[keyOf(kind)] = state[keyOf(kind)].filter(t => t.id !== id);
  persist(); render();
}
const saveTask = (id, d) => putDoc('tasks', id, d);
const patchTask = (id, p) => patchDoc('tasks', id, p);
const removeTask = id => deleteDoc('tasks', id);
function savePlanner() { persist(); render(); syncPreviewOptions(); }

/* ---------- backup ---------- */
async function exportBackup() {
  const ok = await saveFile(`sortbox-backup-${todayStr()}.json`, JSON.stringify(snapshot(), null, 2), 'application/json');
  if (ok) toast(`Backup saved: ${plural(state.tasks.length, 'task')}, ${plural(state.events.length, 'event')}.`);
}
async function importBackup(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch (e) { toast('That file isn’t a Sortbox backup (it isn’t valid JSON).'); return; }
  if (!d || (!Array.isArray(d.tasks) && !Array.isArray(d.events))) { toast('That file has no Sortbox tasks or events in it.'); return; }
  const before = { tasks: state.tasks.length, events: state.events.length };
  // merge: same id → the backup's version wins, everything else is kept
  const merge = (mine, theirs, ok) => {
    const map = new Map(mine.map(x => [x.id, x]));
    for (const x of theirs || []) if (ok(x)) map.set(x.id, x);
    return [...map.values()];
  };
  state.tasks = merge(state.tasks, d.tasks, x => x && x.id && x.title);
  state.events = merge(state.events, d.events, x => x && x.id && x.title && x.date);
  if (Array.isArray(d.categories) && d.categories.length) {
    const ids = new Set(state.categories.map(c => c.id));
    for (const c of d.categories) {
      if (!c?.id || !c.name) continue;
      if (ids.has(c.id)) Object.assign(state.categories.find(x => x.id === c.id), c);
      else state.categories.push(c);
    }
  }
  if (typeof d.fallback === 'string' && state.categories.some(c => c.id === d.fallback)) state.fallback = d.fallback;
  persist(); syncPreviewOptions(); render();
  toast(`Imported: ${plural(state.tasks.length - before.tasks, 'new task')}, ${plural(state.events.length - before.events, 'new event')}.`);
}
$('importFile').addEventListener('change', e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) importBackup(f);
});
const strip = ({ id, ...rest }) => rest;

/* ---------- capture ---------- */
const input = $('noteInput');
function currentParse() {
  const p = parseNote(input.value, state.categories, state.fallback);
  const d = state.draft;
  const kind = d.kind ?? ((p.end || p.repeat) ? 'event' : 'task');
  let time = d.time !== undefined ? d.time : p.time;
  let end = d.end !== undefined ? d.end : (p.end ? capEnd(p.end) : null);
  const repeat = d.repeat !== undefined ? d.repeat : (p.repeat || 'none');
  const due = d.due !== undefined ? d.due : p.due;
  if (kind === 'event') {
    if (!time) time = '09:00';
    if (!end || toMin(end) <= toMin(time)) end = fromMin(Math.min(toMin(time) + 60, 1439));
  }
  return { ...p, kind, catId: d.cat !== undefined ? d.cat : p.catId, due, time, end, repeat, guess: d.cat === undefined && !p.matched };
}
function syncPreviewOptions() {
  $('pvCat').innerHTML = state.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  updatePreview();
}
function updatePreview() {
  const has = input.value.trim().length > 0 || state.draft.due !== undefined || state.draft.kind !== undefined;
  $('addBtn').disabled = !input.value.trim();
  $('preview').hidden = !has;
  $('hints').hidden = has;
  if (!has) return;
  const p = currentParse();
  const c = catById(p.catId);
  const isEv = p.kind === 'event';
  $('pvKind').textContent = isEv ? 'Event' : 'Task';
  $('pvKind').title = isEv ? 'Adds a block to the calendar. Click to make it a task instead.' : 'Adds a to-do. Click to make it a calendar event instead.';
  $('pvCat').value = c.id;
  $('pvCatChip').style.setProperty('--c', `var(--cat-${c.color})`);
  $('pvCatChip').classList.toggle('guess', p.guess);
  $('pvCatChip').title = p.guess ? 'No keyword matched, so this is the default category. Change it here.' : '';
  const dateVal = p.due || (isEv ? (p.repeat !== 'none' ? ymd(mondayOf(startOfToday())) : todayStr()) : '');
  $('pvDate').value = dateVal;
  $('pvDateChip').classList.toggle('empty', !dateVal);
  $('pvDateClear').hidden = !p.due || isEv;
  $('pvTime').value = p.time || '';
  $('pvTimeChip').classList.toggle('empty', !p.time);
  $('pvEndChip').hidden = !isEv;
  $('pvRepeatChip').hidden = !isEv;
  if (isEv) { $('pvEnd').value = p.end || ''; $('pvRepeat').value = p.repeat; }
  let when = '';
  if (isEv) {
    const evLike = { repeat: p.repeat, days: p.days, date: dateVal };
    when = p.repeat !== 'none' ? repeatLabel(evLike) : dueLabel(dateVal);
    when += ` · ${p.time}–${p.end}`;
  } else if (p.due) when = dueLabel(p.due);
  $('pvTitle').innerHTML = input.value.trim()
    ? `as <b>${esc(p.title)}</b>${when ? ` · ${esc(when)}` : ''}${p.guess ? ' · no keyword matched' : ''}`
    : 'Type the title';
}
input.addEventListener('input', updatePreview);
$('pvKind').addEventListener('click', () => { const p = currentParse(); state.draft.kind = p.kind === 'event' ? 'task' : 'event'; updatePreview(); });
$('pvCat').addEventListener('change', e => { state.draft.cat = e.target.value; updatePreview(); });
$('pvDate').addEventListener('change', e => { state.draft.due = e.target.value || null; updatePreview(); });
$('pvTime').addEventListener('change', e => { state.draft.time = e.target.value || null; updatePreview(); });
$('pvEnd').addEventListener('change', e => { state.draft.end = e.target.value || null; updatePreview(); });
$('pvRepeat').addEventListener('change', e => { state.draft.repeat = e.target.value; updatePreview(); });
$('pvDateClear').addEventListener('click', e => { e.preventDefault(); state.draft.due = null; state.draft.time = null; updatePreview(); });

$('captureForm').addEventListener('submit', async e => {
  e.preventDefault();
  const raw = input.value.trim();
  if (!raw) return;
  const p = currentParse();
  const reset = () => { input.value = ''; state.draft = {}; updatePreview(); };
  if (p.kind === 'event') {
    // a repeating event typed without a date starts this week, so this week's earlier days show it too
    const date = p.due || (p.repeat !== 'none' ? ymd(mondayOf(startOfToday())) : todayStr());
    const ev = {
      title: p.title, cat: p.catId, date, start: p.time, end: p.end, repeat: p.repeat,
      days: p.repeat === 'weekly' ? (p.days && p.days.length ? p.days : [parseYmd(date).getDay()]) : null,
      until: null, skip: [], createdAt: Date.now(),
    };
    const id = newId('e');
    reset();
    try { await putDoc('events', id, ev); } catch (err) { input.value = raw; updatePreview(); return; }
    const first = firstOccurrence({ ...ev, id });
    toast(`Added ${ev.title} · ${ev.repeat !== 'none' ? repeatLabel(ev) : dueLabel(first)} ${ev.start}–${ev.end}`, { label: 'Edit', fn: () => openEventEditor(id, first) });
    if (state.view === 'calendar' && state.calMode === 'week') { state.weekStart = mondayOf(parseYmd(first)); state.calSel = first; render(); }
    return;
  }
  const locks = { cat: state.draft.cat !== undefined || p.tagged, due: state.draft.due !== undefined, time: state.draft.time !== undefined };
  const task = {
    title: p.title, cat: p.catId, due: p.due || null, time: p.time || null, done: false,
    createdAt: Date.now(), raw, sort: locks.cat ? 'manual' : (p.matched ? 'keywords' : 'default'),
  };
  const id = newId('t');
  reset();
  try { await saveTask(id, task); } catch (err) { input.value = raw; updatePreview(); return; }
  const c = catById(task.cat);
  toast(`Added to ${c.name}${task.due ? ' · ' + dueLabel(task.due) : ''}${task.time ? ' ' + task.time : ''}`, { label: 'Undo', fn: () => removeTask(id) });
});


/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, action) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" id="toastAct">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) $('toastAct').onclick = () => { el.hidden = true; action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 4200);
}

/* ---------- rendering: tasks ---------- */
function taskRow(t, opts = {}) {
  const c = catById(t.cat);
  if (state.editing === t.id) return editRow(t, c);
  const cls = dueClass(t);
  const meta = [];
  if (t.due) meta.push(`<span class="due ${cls}">${esc(dueLabel(t.due))}${t.time ? ' · ' + esc(t.time) : ''}</span>`);
  else if (t.time) meta.push(`<span class="due">${esc(t.time)}</span>`);
  if (opts.showCat !== false) meta.push(`<span class="tag"><span class="dot"></span>${esc(c.name)}</span>`);
  if (t.example) meta.push('<span class="ex">example</span>');
  return `<li class="task ${t.done ? 'done' : ''}" style="${cvar(c)}" data-id="${esc(t.id)}">
    <button class="check" type="button" data-act="toggle" data-id="${esc(t.id)}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}">${ICON.check}</button>
    <div class="t-main"><div class="t-title">${esc(t.title)}</div>${meta.length ? `<div class="t-meta">${meta.join('')}</div>` : ''}</div>
    <div class="t-actions">
      ${t.due && !t.done ? `<a class="icon" href="${esc(gcalUrl(t))}" target="_blank" rel="noopener" title="Add to Google Calendar" aria-label="Add to Google Calendar">${ICON.gcal}</a>` : ''}
      <button class="icon" type="button" data-act="edit" data-id="${esc(t.id)}" title="Edit" aria-label="Edit">${ICON.edit}</button>
      <button class="icon del" type="button" data-act="del" data-id="${esc(t.id)}" title="Delete" aria-label="Delete">${ICON.del}</button>
    </div>
  </li>`;
}
function editRow(t, c) {
  const d = state.editDraft || { title: t.title, cat: c.id, due: t.due || '', time: t.time || '' };
  state.editDraft = d;
  return `<li class="task" style="${cvar(c)}" data-id="${esc(t.id)}">
    <form class="edit-form" data-id="${esc(t.id)}">
      <label class="sr" for="ed-title">Title</label>
      <input class="field" id="ed-title" data-f="title" value="${esc(d.title)}">
      <div class="row">
        <label class="chip cat" style="${cvar(catById(d.cat))}"><span class="dot"></span><span class="sr">Category</span>
          <select id="ed-cat" data-f="cat">${state.categories.map(x => `<option value="${esc(x.id)}" ${x.id === d.cat ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="chip"><span class="sr">Due date</span><input type="date" id="ed-due" data-f="due" value="${esc(d.due)}"></label>
        <label class="chip"><span class="sr">Time</span><input type="time" id="ed-time" data-f="time" value="${esc(d.time)}"></label>
      </div>
      <div class="row">
        <button class="btn-s primary" type="submit">Save</button>
        <button class="btn-s" type="button" data-act="cancel-edit">Cancel</button>
      </div>
    </form>
  </li>`;
}
const list = (tasks, opts) => `<ul class="list">${tasks.map(t => taskRow(t, opts)).join('')}</ul>`;

function emptyState() {
  const ex = ['ISTE 341 exam prep fri 14:00', 'ISTE 341 lecture every mon wed 10:00-11:30', 'Buy groceries tomorrow', 'Gym every day 7-8h'];
  return `<div class="empty">
    <h3>${state.mode === 'loading' ? 'Loading your notes…' : 'Nothing here yet'}</h3>
    <p>Type a note above the way you'd jot it down. Sortbox picks the category from keywords and reads the date and time out of the text. A time range or "every …" makes it a calendar event. Try one of these:</p>
    <div class="try">${ex.map(x => `<button type="button" data-act="fill" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>
  </div>`;
}

function renderNav() {
  const open = openTasks();
  const tabs = [
    `<button class="vbtn" role="tab" aria-selected="${state.view === 'overview'}" data-act="view" data-v="overview">Overview</button>`,
    `<button class="vbtn" role="tab" aria-selected="${state.view === 'calendar'}" data-act="view" data-v="calendar">Calendar</button>`,
    '<span class="vsep" aria-hidden="true"></span>',
    ...state.categories.map(c => {
      const n = open.filter(t => catById(t.cat).id === c.id).length;
      return `<button class="vbtn" role="tab" aria-selected="${state.view === 'cat:' + c.id}" data-act="view" data-v="cat:${esc(c.id)}" style="${cvar(c)}"><span class="dot"></span>${esc(c.name)}<span class="n">${n}</span></button>`;
    }),
  ];
  $('views').innerHTML = tabs.join('');
}

function renderOverview() {
  const today = todayStr();
  const weekEnd = ymd(addDays(startOfToday(), 6));
  const examples = state.tasks.some(t => t.example);
  const cards = state.categories.map(c => {
    const open = sortTasks(tasksOf(c.id).filter(t => !t.done));
    const overdue = open.filter(t => t.due && t.due < today).length;
    const week = open.filter(t => t.due && t.due >= today && t.due <= weekEnd).length;
    const next = open.slice(0, 4);
    return `<article class="folder" style="${cvar(c)}">
      <div class="tab"><span>${esc(c.name)}</span></div>
      <div class="folder-top">
        <div class="big">${open.length}<small>open</small></div>
        <div class="stats">${overdue ? `<span class="bad">${overdue} overdue</span>` : ''}<span>${week} due in 7 days</span></div>
      </div>
      ${next.length ? `<ul class="mini">${next.map(t => `<li>
          <button class="check" type="button" data-act="toggle" data-id="${esc(t.id)}" aria-label="Mark as done: ${esc(t.title)}" style="width:18px;height:18px">${ICON.check}</button>
          <span class="t" title="${esc(t.title)}">${esc(t.title)}</span>
          <span class="d ${dueClass(t)}">${t.due ? esc(dueLabel(t.due)) : 'no date'}</span></li>`).join('')}</ul>`
        : `<div class="empty-note">All clear.</div>`}
      <button class="linkbtn open-cat" type="button" data-act="view" data-v="cat:${esc(c.id)}">Open ${esc(c.name)} →</button>
    </article>`;
  }).join('');

  const open = openTasks();
  const overdue = sortTasks(open.filter(t => t.due && t.due < today));
  const todaysEvents = eventsOn(today);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = ymd(addDays(startOfToday(), i));
    const items = sortTasks(open.filter(t => t.due === d));
    if (items.length) days.push({ d, items });
  }
  const nodate = open.filter(t => !t.due).length;
  let agenda = '';
  if (overdue.length) agenda += `<div class="group"><div class="group-h overdue">Overdue <span class="mono">${overdue.length}</span></div>${list(overdue)}</div>`;
  for (const { d, items } of days) {
    const dt = parseYmd(d);
    const name = daysBetween(today, d) === 0 ? 'Today' : daysBetween(today, d) === 1 ? 'Tomorrow' : DOW_LONG[dt.getDay()];
    agenda += `<div class="group"><div class="group-h">${name} <span class="mono">${dt.getDate()} ${MON[dt.getMonth()]}</span></div>${list(items)}</div>`;
  }
  if (!agenda) agenda = `<p class="loading">Nothing due in the next 7 days.</p>`;
  const schedule = todaysEvents.length ? `<section><div class="section-h"><h2>Today's schedule</h2><button class="linkbtn" type="button" data-act="open-week">Open week →</button></div>${eventList(todaysEvents, today)}</section>` : '';

  return `
    ${examples ? `<div class="banner"><span>The tasks marked <b>example</b> show how Sortbox fills up. Remove them when you've had a look.</span><button class="btn-s" type="button" data-act="clear-examples">Remove examples</button></div>` : ''}
    ${!state.tasks.length && !state.events.length ? emptyState() : ''}
    ${schedule}
    <section><div class="section-h"><h2>By category</h2><span class="sub">${plural(open.length, 'open task')}</span></div>
      <div class="cards">${cards}</div></section>
    ${state.tasks.length ? `<section><div class="section-h"><h2>Next 7 days</h2>${nodate ? `<span class="sub">${nodate} without a date</span>` : ''}</div>${agenda}</section>` : ''}`;
}

function renderCategory(id) {
  const c = state.categories.find(x => x.id === id);
  if (!c) { state.view = 'overview'; return renderOverview(); }
  const today = startOfToday(), ts = todayStr();
  const tmr = ymd(addDays(today, 1));
  const weekEnd = ymd(addDays(mondayOf(today), 6));
  const nextWeekEnd = ymd(addDays(mondayOf(today), 13));
  const all = tasksOf(c.id);
  const open = sortTasks(all.filter(t => !t.done));
  const done = all.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30);
  const groups = [
    ['Overdue', open.filter(t => t.due && t.due < ts), 'overdue'],
    ['Today', open.filter(t => t.due === ts)],
    ['Tomorrow', open.filter(t => t.due === tmr)],
    ['Later this week', open.filter(t => t.due && t.due > tmr && t.due <= weekEnd)],
    ['Next week', open.filter(t => t.due && t.due > weekEnd && t.due <= nextWeekEnd)],
    ['Later', open.filter(t => t.due && t.due > nextWeekEnd)],
    ['No date', open.filter(t => !t.due)],
  ].filter(g => g[1].length);
  const overdue = groups.find(g => g[0] === 'Overdue')?.[1].length || 0;
  const recurring = state.events.filter(ev => catById(ev.cat).id === c.id && ev.repeat && ev.repeat !== 'none' && (!ev.until || ev.until >= ts));
  return `
    <div class="cat-head" style="${cvar(c)}">
      <div><h2><span class="sw"></span>${esc(c.name)}</h2>
      <div class="sub">${plural(open.length, 'open task')}${overdue ? ` · <span style="color:var(--danger)">${overdue} overdue</span>` : ''} · ${done.length} done</div></div>
      <button class="ghost" type="button" data-act="settings">Edit keywords</button>
    </div>
    ${groups.length ? groups.map(([name, items, cls]) => `<div class="group"><div class="group-h ${cls || ''}">${name} <span class="mono">${items.length}</span></div>${list(items, { showCat: false })}</div>`).join('')
      : `<div class="empty"><h3>No open ${esc(c.name)} tasks</h3><p>Notes containing ${c.keywords?.length ? esc(c.keywords.slice(0, 4).join(', ')) : 'this category’s keywords'} land here, or add <code class="mono">#${esc(c.name.toLowerCase())}</code> to a note.</p></div>`}
    ${recurring.length ? `<div class="group"><div class="group-h">Repeating events <span class="mono">${recurring.length}</span></div>${eventList(recurring, null)}</div>` : ''}
    ${done.length ? `<details class="done-box group"><summary class="group-h">Done <span class="mono">${done.length}</span></summary>${list(done, { showCat: false })}</details>` : ''}`;
}

function eventList(evs, ds) {
  return `<ul class="list">${evs.map(ev => {
    const c = catById(ev.cat);
    const occ = ds || firstOccurrence(ev);
    const rep = repeatLabel(ev);
    return `<li class="ev-row" style="${cvar(c)}">
      <span class="sw" aria-hidden="true"></span>
      <button class="ev-open" type="button" data-act="ev-open" data-id="${esc(ev.id)}" data-d="${occ}">
        <span class="t-title">${esc(ev.title)}</span>
        <span class="t-meta"><span class="tr">${esc(ev.start)}–${esc(ev.end)}</span>${rep ? `<span>${ICON.rep} ${esc(rep)}</span>` : ''}<span class="tag"><span class="dot"></span>${esc(c.name)}</span></span>
      </button>
      <div class="t-actions" style="opacity:1">
        <a class="icon" href="${esc(gcalEventUrl(ev))}" target="_blank" rel="noopener" title="Add to Google Calendar" aria-label="Add to Google Calendar">${ICON.gcal}</a>
        <button class="icon" type="button" data-act="ev-open" data-id="${esc(ev.id)}" data-d="${occ}" title="Edit" aria-label="Edit">${ICON.edit}</button>
      </div>
    </li>`;
  }).join('')}</ul>`;
}

/* ---------- rendering: calendar ---------- */
function calBar(title, sub) {
  return `<div class="cal-bar">
    <h2>${title}${sub ? `<span class="sub">${sub}</span>` : ''}</h2>
    <div class="cal-nav">
      <div class="seg" role="group" aria-label="Calendar layout">
        <button type="button" data-act="cal-mode" data-m="week" aria-pressed="${state.calMode === 'week'}">Week</button>
        <button type="button" data-act="cal-mode" data-m="month" aria-pressed="${state.calMode === 'month'}">Month</button>
      </div>
      <button class="ghost" type="button" data-act="cal-prev" aria-label="Previous">‹</button>
      <button class="ghost" type="button" data-act="cal-today">Today</button>
      <button class="ghost" type="button" data-act="cal-next" aria-label="Next">›</button>
      <button class="ghost" type="button" data-act="ev-new">+ Event</button>
    </div>
  </div>
  <div class="legend">${state.categories.map(c => `<button type="button" data-act="cal-filter" data-id="${esc(c.id)}" aria-pressed="${!state.hidden.has(c.id)}" style="${cvar(c)}"><span class="dot"></span>${esc(c.name)}</button>`).join('')}</div>`;
}

function layoutDay(items) {
  // items: {s, e, ...}; assigns lane + lanes for overlapping clusters
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of cluster) {
      let li = lanes.findIndex(end => end <= it.s);
      if (li < 0) { li = lanes.length; lanes.push(it.e); } else lanes[li] = it.e;
      it.lane = li;
    }
    for (const it of cluster) it.lanes = lanes.length;
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return items;
}

function renderWeek() {
  const ws = state.weekStart;
  const we = addDays(ws, 6);
  const ts = todayStr();
  const days = [...Array(7)].map((_, i) => ymd(addDays(ws, i)));
  const rangeLabel = ws.getMonth() === we.getMonth()
    ? `${ws.getDate()}–${we.getDate()} ${MON[we.getMonth()]} ${we.getFullYear()}`
    : `${ws.getDate()} ${MON[ws.getMonth()]} – ${we.getDate()} ${MON[we.getMonth()]} ${we.getFullYear()}`;

  let head = '<div class="wk-corner"></div>';
  let allday = '<div class="wk-corner ad">All day</div>';
  let cols = '';
  for (const ds of days) {
    const d = parseYmd(ds);
    head += `<button type="button" class="wk-dh ${ds === ts ? 'today' : ''} ${ds === state.calSel ? 'sel' : ''}" data-act="cal-day" data-d="${ds}" aria-label="${DOW_LONG[d.getDay()]} ${d.getDate()} ${MON_LONG[d.getMonth()]}"><span class="dn">${DOW[d.getDay()]}</span><span class="dd">${d.getDate()}</span></button>`;
    const untimed = sortTasks(state.tasks.filter(t => t.due === ds && !t.time && visibleCat(t.cat)));
    allday += `<div class="wk-ad">${untimed.map(t => `<div class="adc ${t.done ? 'done' : ''}" style="${cvar(catById(t.cat))}" title="${esc(t.title)}"><button class="check" type="button" data-act="toggle" data-id="${esc(t.id)}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}">${ICON.check}</button><span>${esc(t.title)}</span></div>`).join('')}</div>`;

    const items = [];
    for (const ev of eventsOn(ds)) if (visibleCat(ev.cat)) items.push({ kind: 'ev', ev, s: toMin(ev.start), e: Math.max(toMin(ev.end), toMin(ev.start) + 15) });
    for (const t of state.tasks) if (t.due === ds && t.time && visibleCat(t.cat)) items.push({ kind: 'task', t, s: toMin(t.time), e: toMin(t.time) + 30 });
    layoutDay(items);
    let blocks = '';
    for (const it of items) {
      const top = it.s / 60 * HOUR_H, h = Math.max((it.e - it.s) / 60 * HOUR_H - 2, 18);
      const pos = `--t:${top}px;--h:${h}px;--l:${it.lane / it.lanes};--w:${1 / it.lanes}`;
      const short = h < 36 ? 'short' : '';
      if (it.kind === 'ev') {
        const ev = it.ev, c = catById(ev.cat);
        blocks += `<button type="button" class="blk ${short}" style="${cvar(c)};${pos}" data-act="ev-open" data-id="${esc(ev.id)}" data-d="${ds}" title="${esc(ev.title)} · ${esc(ev.start)}–${esc(ev.end)}">
          <span class="bt">${esc(ev.title)}</span><span class="bm">${esc(ev.start)}–${esc(ev.end)}${ev.repeat && ev.repeat !== 'none' ? ' ' + ICON.rep : ''}</span></button>`;
      } else {
        const t = it.t, c = catById(t.cat);
        blocks += `<div class="blk task short ${t.done ? 'done' : ''}" style="${cvar(c)};${pos}" title="${esc(t.title)} · ${esc(t.time)}">
          <button class="check" type="button" data-act="toggle" data-id="${esc(t.id)}" aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}">${ICON.check}</button>
          <span class="bt">${esc(t.title)}</span><span class="bm">${esc(t.time)}</span></div>`;
      }
    }
    if (ds === ts) {
      const now = new Date();
      blocks += `<div class="now" style="--t:${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H}px"></div>`;
    }
    cols += `<div class="wk-col ${ds === ts ? 'today' : ''}" data-col="${ds}">${blocks}</div>`;
  }
  let gutter = '<div class="wk-gutter">';
  for (let h = 1; h < 24; h++) gutter += `<span style="top:${h * HOUR_H}px">${pad(h)}:00</span>`;
  gutter += '</div>';

  const sel = state.calSel;
  const sd = parseYmd(sel);
  const selTasks = sortTasks(state.tasks.filter(t => t.due === sel && visibleCat(t.cat))).sort((a, b) => a.done - b.done);
  const selEvents = eventsOn(sel).filter(ev => visibleCat(ev.cat));
  return `<div>
    ${calBar(`KW ${isoWeek(ws)}`, rangeLabel)}
    <div class="wk-scroll" id="wkScroll" style="--hh:${HOUR_H}px">
      <div class="wk">
        <div class="wk-top">${head}${allday}</div>
        <div class="wk-body">${gutter}${cols}</div>
      </div>
    </div>
    <p class="loading" style="margin:8px 2px 0">Drag across the grid to block time, or click an hour. Click a block to edit or repeat it.</p>
    ${dayPanel(sel, sd, selEvents, selTasks)}
  </div>`;
}

function dayPanel(sel, sd, selEvents, selTasks) {
  const ts = todayStr();
  return `<section class="day-panel">
    <div class="section-h"><h2>${daysBetween(ts, sel) === 0 ? 'Today, ' : ''}${DOW_LONG[sd.getDay()]} ${sd.getDate()} ${MON[sd.getMonth()]}</h2>
      <div class="cal-nav"><button class="ghost" type="button" data-act="add-on-day" data-d="${sel}">+ Task</button><button class="ghost" type="button" data-act="ev-new" data-d="${sel}">+ Event</button></div></div>
    ${selEvents.length ? `<div class="group"><div class="group-h">Schedule <span class="mono">${selEvents.length}</span></div>${eventList(selEvents, sel)}</div>` : ''}
    ${selTasks.length ? `<div class="group"><div class="group-h">Tasks <span class="mono">${selTasks.length}</span></div>${list(selTasks)}</div>` : ''}
    ${!selEvents.length && !selTasks.length ? '<p class="loading">Nothing planned this day.</p>' : ''}
  </section>`;
}

function renderMonth() {
  const m = state.calMonth;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = mondayOf(first);
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const end = addDays(mondayOf(last), 6);
  const ts = todayStr();
  const byDay = {};
  for (const t of state.tasks) if (t.due && visibleCat(t.cat)) (byDay[t.due] ||= []).push({ title: t.title, time: t.time, cat: t.cat, done: t.done });
  let cells = '<div class="hd">KW</div>' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="hd">${d}</div>`).join('');
  for (let d = new Date(start); d <= end; d = addDays(d, 7)) {
    cells += `<div class="kw">${isoWeek(d)}</div>`;
    for (let i = 0; i < 7; i++) {
      const day = addDays(d, i), ds = ymd(day);
      const evs = eventsOn(ds).filter(ev => visibleCat(ev.cat)).map(ev => ({ title: ev.title, time: ev.start, cat: ev.cat, done: false }));
      const items = [...evs, ...(byDay[ds] || [])].sort((a, b) => (a.done - b.done) || ((a.time || '99') < (b.time || '99') ? -1 : 1));
      const cls = ['day', day.getMonth() !== m.getMonth() ? 'out' : '', ds === ts ? 'today' : '', ds === state.calSel ? 'sel' : ''].join(' ');
      cells += `<button type="button" class="${cls}" data-act="cal-day" data-d="${ds}" aria-label="${DOW_LONG[day.getDay()]} ${day.getDate()} ${MON_LONG[day.getMonth()]}, ${plural(items.length, 'item')}">
        <span class="num">${day.getDate()}</span>
        ${items.slice(0, 3).map(t => `<span class="ev ${t.done ? 'done' : ''}" style="${cvar(catById(t.cat))}">${t.time ? esc(t.time) + ' ' : ''}${esc(t.title)}</span>`).join('')}
        ${items.length > 3 ? `<span class="more">+${items.length - 3} more</span>` : ''}
        <span class="dots">${items.slice(0, 4).map(t => `<i style="${cvar(catById(t.cat))}"></i>`).join('')}</span>
      </button>`;
    }
  }
  const sel = state.calSel;
  const selTasks = sortTasks(state.tasks.filter(t => t.due === sel && visibleCat(t.cat))).sort((a, b) => a.done - b.done);
  const selEvents = eventsOn(sel).filter(ev => visibleCat(ev.cat));
  return `<div>
    ${calBar(`${MON_LONG[m.getMonth()]} ${m.getFullYear()}`, '')}
    <div class="cal-scroll"><div class="cal">${cells}</div></div>
    ${dayPanel(sel, parseYmd(sel), selEvents, selTasks)}
  </div>`;
}

function render() {
  const now = startOfToday();
  $('todayLabel').textContent = `${DOW[now.getDay()]} ${now.getDate()} ${MON[now.getMonth()]} ${now.getFullYear()} · KW ${isoWeek(now)}`;
  renderNav();
  const prev = $('wkScroll');
  const keep = prev ? { top: prev.scrollTop, left: prev.scrollLeft } : null;
  let html;
  if (state.view === 'calendar') html = state.calMode === 'week' ? renderWeek() : renderMonth();
  else if (state.view.startsWith('cat:')) html = renderCategory(state.view.slice(4));
  else html = renderOverview();
  $('view').innerHTML = html;
  const sc = $('wkScroll');
  if (sc) {
    const key = ymd(state.weekStart);
    if (keep && state.wkScrollFor === key) { sc.scrollTop = keep.top; sc.scrollLeft = keep.left; }
    else {
      const nowH = new Date().getHours();
      const inWeek = daysBetween(key, todayStr()) >= 0 && daysBetween(key, todayStr()) < 7;
      sc.scrollTop = Math.max(0, ((inWeek && nowH > 9 ? Math.min(nowH - 2, 15) : 7) * HOUR_H) - 6);
      state.wkScrollFor = key;
    }
  }
  if (!$('drawer').hidden) renderDrawer();
}

/* ---------- event editor ---------- */
function openEventEditor(id, occ, preset) {
  let d;
  if (id) {
    const ev = state.events.find(x => x.id === id);
    if (!ev) return;
    d = { id, title: ev.title, cat: ev.cat, date: ev.date, start: ev.start, end: ev.end, repeat: ev.repeat || 'none', days: ev.days ? [...ev.days] : [parseYmd(ev.date).getDay()], until: ev.until || '', occ: occ || ev.date };
  } else {
    const date = preset?.date || state.calSel || todayStr();
    const start = preset?.start || fromMin(Math.min((new Date().getHours() + 1) * 60, 22 * 60));
    d = { id: null, title: '', cat: state.fallback, date, start, end: preset?.end || fromMin(Math.min(toMin(start) + 60, 1439)), repeat: 'none', days: [parseYmd(date).getDay()], until: '', occ: date };
  }
  d.err = '';
  d.confirm = null;
  state.evEdit = d;
  $('evOverlay').hidden = false;
  $('evModal').hidden = false;
  renderEventEditor();
  $('ev-title')?.focus();
}
function closeEventEditor() {
  state.evEdit = null;
  $('evOverlay').hidden = true;
  $('evModal').hidden = true;
}
function renderEventEditor() {
  const d = state.evEdit;
  if (!d) return;
  const c = catById(d.cat);
  const recurring = d.repeat !== 'none';
  const occD = parseYmd(d.occ);
  const ev = d.id ? state.events.find(x => x.id === d.id) : null;
  $('evModal').innerHTML = `
    <h2 id="evTitle">${d.id ? 'Edit event' : 'New event'}</h2>
    <form id="evForm" class="grp" style="gap:14px">
      <div class="grp"><label class="lbl" for="ev-title">Title</label>
        <input class="field" id="ev-title" data-ef="title" value="${esc(d.title)}" placeholder="e.g. ISTE 341 lecture"></div>
      <div class="row">
        <label class="chip cat" style="${cvar(c)}"><span class="dot"></span><span class="sr">Category</span>
          <select id="ev-cat" data-ef="cat">${state.categories.map(x => `<option value="${esc(x.id)}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      </div>
      <div class="grp"><span class="lbl">${recurring ? 'Starts on' : 'Date'} and time</span>
        <div class="row">
          <label class="chip"><span class="sr">Date</span><input type="date" id="ev-date" data-ef="date" value="${esc(d.date)}"></label>
          <label class="chip"><span class="sr">Start</span><input type="time" id="ev-start" data-ef="start" value="${esc(d.start)}"></label>
          <label class="chip"><span class="to">to</span><span class="sr">End</span><input type="time" id="ev-end" data-ef="end" value="${esc(d.end)}"></label>
        </div></div>
      <div class="grp"><span class="lbl">Repeat</span>
        <div class="seg" role="group" aria-label="Repeat" style="justify-self:start;flex-wrap:wrap">
          ${[['none', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']].map(([v, l]) => `<button type="button" data-rep="${v}" aria-pressed="${d.repeat === v}">${l}</button>`).join('')}
        </div>
        ${d.repeat === 'weekly' ? `<div class="daypick" role="group" aria-label="Days">${WEEK_ORDER.map(n => `<button type="button" data-dow="${n}" aria-pressed="${d.days.includes(n)}" aria-label="${DOW_LONG[n]}">${DOW[n].slice(0, 2)}</button>`).join('')}</div>` : ''}
        ${recurring ? `<div class="row"><label class="chip"><span class="to">until</span><span class="sr">Repeat until</span><input type="date" id="ev-until" data-ef="until" value="${esc(d.until)}"></label><span class="note">Leave empty to repeat with no end, e.g. set the last lecture day.</span></div>` : ''}
      </div>
      ${d.id && ev && ev.repeat && ev.repeat !== 'none' ? `<p class="note">Changes apply to every repeat of this event.</p>` : ''}
      ${d.err ? `<p class="err" role="alert">${esc(d.err)}</p>` : ''}
      <div class="foot">
        <div class="row">
          <button class="btn-s primary" type="submit">Save</button>
          <button class="btn-s" type="button" data-evact="cancel">Cancel</button>
        </div>
        ${d.id ? (d.confirm === 'all'
          ? `<div class="row"><span class="err">Delete ${ev?.repeat && ev.repeat !== 'none' ? 'every repeat' : 'this event'}?</span><button class="btn-s danger" type="button" data-evact="delete-yes">Delete</button><button class="btn-s" type="button" data-evact="delete-no">Keep</button></div>`
          : `<div class="row">
              ${ev?.repeat && ev.repeat !== 'none' ? `<button class="btn-s" type="button" data-evact="skip">Skip ${DOW[occD.getDay()]} ${occD.getDate()} ${MON[occD.getMonth()]}</button>` : ''}
              <button class="btn-s danger" type="button" data-evact="delete">${ev?.repeat && ev.repeat !== 'none' ? 'Delete all' : 'Delete'}</button>
            </div>`) : ''}
      </div>
      ${d.id && ev ? `<a class="linkbtn" href="${esc(gcalEventUrl(ev))}" target="_blank" rel="noopener">Add to Google Calendar ↗</a>` : ''}
    </form>`;
}
$('evModal').addEventListener('input', e => {
  const f = e.target.dataset.ef;
  if (!f || !state.evEdit) return;
  state.evEdit[f] = e.target.value;
  if (f === 'cat') e.target.closest('.chip').style.setProperty('--c', `var(--cat-${catById(e.target.value).color})`);
  if (f === 'start' && e.target.value) {
    // keep the duration when the start moves
    const ev = state.evEdit;
    if (!ev._dur) ev._dur = Math.max(15, toMin(ev.end) - toMin(ev._prevStart || ev.start));
  }
});
$('evModal').addEventListener('change', e => {
  const d = state.evEdit;
  if (!d) return;
  if (e.target.dataset.ef === 'start' && e.target.value) {
    const dur = d._dur || 60;
    d.end = fromMin(Math.min(toMin(d.start) + dur, 1439));
    d._dur = null; d._prevStart = d.start;
    const endEl = $('ev-end'); if (endEl) endEl.value = d.end;
  }
  if (e.target.dataset.ef === 'date' && d.repeat === 'weekly' && d.days.length <= 1 && e.target.value) {
    d.days = [parseYmd(e.target.value).getDay()]; renderEventEditor();
  }
});
$('evModal').addEventListener('focusin', e => {
  if (e.target.dataset?.ef === 'start' && state.evEdit) { state.evEdit._prevStart = state.evEdit.start; state.evEdit._dur = Math.max(15, toMin(state.evEdit.end) - toMin(state.evEdit.start)); }
});
$('evModal').addEventListener('click', async e => {
  const d = state.evEdit;
  if (!d) return;
  const rep = e.target.closest('[data-rep]');
  if (rep) {
    d.repeat = rep.dataset.rep;
    if (d.repeat === 'weekly' && !d.days.length) d.days = [parseYmd(d.date).getDay()];
    renderEventEditor(); return;
  }
  const dow = e.target.closest('[data-dow]');
  if (dow) {
    const n = +dow.dataset.dow;
    d.days = d.days.includes(n) ? d.days.filter(x => x !== n) : [...d.days, n];
    renderEventEditor(); return;
  }
  const act = e.target.closest('[data-evact]')?.dataset.evact;
  if (!act) return;
  if (act === 'cancel') return closeEventEditor();
  if (act === 'delete') { d.confirm = 'all'; renderEventEditor(); return; }
  if (act === 'delete-no') { d.confirm = null; renderEventEditor(); return; }
  if (act === 'delete-yes') {
    const ev = state.events.find(x => x.id === d.id);
    closeEventEditor();
    if (!ev) return;
    const backup = strip(ev);
    deleteDoc('events', ev.id).catch(() => {});
    toast(`Deleted ${ev.title}`, { label: 'Undo', fn: () => putDoc('events', ev.id, backup) });
    return;
  }
  if (act === 'skip') {
    const ev = state.events.find(x => x.id === d.id);
    closeEventEditor();
    if (!ev) return;
    const skip = [...new Set([...(ev.skip || []), d.occ])];
    patchDoc('events', ev.id, { skip }).catch(() => {});
    toast(`Skipped ${ev.title} on ${dueLabel(d.occ)}`, { label: 'Undo', fn: () => patchDoc('events', ev.id, { skip: skip.filter(s => s !== d.occ) }) });
  }
});
$('evModal').addEventListener('submit', async e => {
  e.preventDefault();
  const d = state.evEdit;
  if (!d) return;
  if (!d.title.trim()) { d.err = 'Give the event a title.'; renderEventEditor(); $('ev-title')?.focus(); return; }
  if (!d.date || !d.start || !d.end) { d.err = 'Pick a date, a start and an end time.'; renderEventEditor(); return; }
  if (toMin(d.end) <= toMin(d.start)) { d.err = 'The end time has to be after the start time.'; renderEventEditor(); return; }
  if (d.repeat === 'weekly' && !d.days.length) { d.err = 'Pick at least one day for a weekly event.'; renderEventEditor(); return; }
  if (d.until && d.repeat !== 'none' && d.until < d.date) { d.err = 'The repeat end date is before the start date.'; renderEventEditor(); return; }
  const data = {
    title: d.title.trim(), cat: d.cat, date: d.date, start: d.start, end: d.end, repeat: d.repeat,
    days: d.repeat === 'weekly' ? [...d.days].sort() : null,
    until: d.repeat !== 'none' && d.until ? d.until : null,
  };
  const id = d.id;
  closeEventEditor();
  try {
    if (id) await patchDoc('events', id, data);
    else {
      const nid = newId('e');
      await putDoc('events', nid, { ...data, skip: [], createdAt: Date.now() });
      toast(`Added ${data.title}${data.repeat !== 'none' ? ' · ' + repeatLabel(data) : ''}`);
    }
  } catch (err) { /* writeError already told the user */ }
});
$('evOverlay').addEventListener('click', closeEventEditor);

/* ---------- drag to create in the week grid ---------- */
let drag = null, suppressClick = false;
function slotFromY(col, clientY, step) {
  const r = col.getBoundingClientRect();
  const min = (clientY - r.top) / HOUR_H * 60;
  return Math.max(0, Math.min(1440 - step, Math.floor(min / step) * step));
}
document.addEventListener('pointerdown', e => {
  const col = e.target.classList?.contains('wk-col') ? e.target : null;
  if (!col || e.pointerType !== 'mouse' || e.button !== 0) return;
  e.preventDefault();
  const a = slotFromY(col, e.clientY, 15);
  const ghost = document.createElement('div');
  ghost.className = 'blk ghost';
  col.appendChild(ghost);
  drag = { col, a, b: a, y0: e.clientY, ghost, moved: false };
  paintGhost();
});
function paintGhost() {
  const s = Math.min(drag.a, drag.b), en = Math.max(drag.a, drag.b) + (drag.moved ? 15 : 60);
  drag.s = s; drag.e = Math.min(en, 1439);
  drag.ghost.style.cssText = `--t:${s / 60 * HOUR_H}px;--h:${(drag.e - s) / 60 * HOUR_H - 2}px;--l:0;--w:1`;
  drag.ghost.innerHTML = `<span class="bm">${fromMin(drag.s)}–${fromMin(drag.e)}</span>`;
}
document.addEventListener('pointermove', e => {
  if (!drag) return;
  if (Math.abs(e.clientY - drag.y0) > 4) drag.moved = true;
  drag.b = slotFromY(drag.col, e.clientY, 15);
  paintGhost();
});
document.addEventListener('pointerup', () => {
  if (!drag) return;
  const { col, s, e: en, ghost } = drag;
  drag = null;
  ghost.remove();
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
  openEventEditor(null, null, { date: col.dataset.col, start: fromMin(s), end: fromMin(en) });
});

/* ---------- view events ---------- */
function setView(v) {
  state.view = v; state.editing = null; state.editDraft = null;
  try { localStorage.setItem('sortbox.view', v); } catch (e) {}
  render();
  window.scrollTo({ top: 0 });
}
document.addEventListener('click', async e => {
  if (e.target.classList?.contains('wk-col')) {
    if (suppressClick) return;
    const s = slotFromY(e.target, e.clientY, 30);   // touch and pen: tap an hour
    openEventEditor(null, null, { date: e.target.dataset.col, start: fromMin(s), end: fromMin(Math.min(s + 60, 1439)) });
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('#evModal') || el.closest('#drawer')) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === 'view') setView(el.dataset.v);
  else if (act === 'toggle') {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const done = !t.done;
    patchTask(id, { done, doneAt: done ? Date.now() : null }).catch(() => {});
    if (done) toast(`Done: ${t.title}`, { label: 'Undo', fn: () => patchTask(id, { done: false, doneAt: null }) });
  } else if (act === 'edit') {
    state.editing = id; state.editDraft = null; render();
    $('ed-title')?.focus();
  } else if (act === 'cancel-edit') {
    state.editing = null; state.editDraft = null; render();
  } else if (act === 'del') {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const backup = strip(t);
    removeTask(id).catch(() => {});
    toast(`Deleted: ${t.title}`, { label: 'Undo', fn: () => saveTask(id, backup) });
  } else if (act === 'fill') {
    input.value = el.dataset.text; updatePreview(); input.focus();
  } else if (act === 'clear-examples') {
    const ex = state.tasks.filter(t => t.example);
    for (const t of ex) await removeTask(t.id).catch(() => {});
    toast(`Removed ${plural(ex.length, 'example')}.`);
  } else if (act === 'cal-mode') {
    state.calMode = el.dataset.m;
    try { localStorage.setItem('sortbox.calMode', state.calMode); } catch (err) {}
    const sd = parseYmd(state.calSel);
    state.weekStart = mondayOf(sd);
    const m = new Date(sd); m.setDate(1); state.calMonth = m;
    render();
  } else if (act === 'cal-prev' || act === 'cal-next') {
    const dir = act === 'cal-next' ? 1 : -1;
    if (state.calMode === 'week') {
      const off = Math.min(6, Math.max(0, daysBetween(ymd(state.weekStart), state.calSel)));
      state.weekStart = addDays(state.weekStart, 7 * dir);
      state.calSel = ymd(addDays(state.weekStart, off));
    }
    else { const m = new Date(state.calMonth); m.setMonth(m.getMonth() + dir); state.calMonth = m; }
    render();
  } else if (act === 'cal-today') {
    const m = startOfToday(); m.setDate(1); state.calMonth = m; state.calSel = todayStr(); state.weekStart = mondayOf(startOfToday()); render();
  } else if (act === 'cal-day') {
    state.calSel = el.dataset.d;
    const d = parseYmd(el.dataset.d);
    if (state.calMode === 'month' && d.getMonth() !== state.calMonth.getMonth()) { d.setDate(1); state.calMonth = d; }
    render();
  } else if (act === 'cal-filter') {
    state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
    try { localStorage.setItem('sortbox.hidden', JSON.stringify([...state.hidden])); } catch (err) {}
    render();
  } else if (act === 'add-on-day') {
    state.draft.due = el.dataset.d; state.draft.kind = 'task'; updatePreview();
    window.scrollTo({ top: 0, behavior: 'smooth' }); input.focus();
  } else if (act === 'ev-new') {
    openEventEditor(null, null, { date: el.dataset.d || state.calSel });
  } else if (act === 'ev-open') {
    openEventEditor(id, el.dataset.d);
  } else if (act === 'open-week') {
    state.calMode = 'week'; state.weekStart = mondayOf(startOfToday()); state.calSel = todayStr();
    try { localStorage.setItem('sortbox.calMode', 'week'); } catch (err) {}
    setView('calendar');
  } else if (act === 'settings') openDrawer();
});
document.addEventListener('input', e => {
  const f = e.target.dataset?.f;
  if (f && state.editDraft) {
    state.editDraft[f] = e.target.value;
    if (f === 'cat') e.target.closest('.chip').style.setProperty('--c', `var(--cat-${catById(e.target.value).color})`);
  }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('.edit-form');
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.id, d = state.editDraft;
  if (!d || !d.title.trim()) return;
  const patch = { title: d.title.trim(), cat: d.cat, due: d.due || null, time: d.time || null, editedAt: Date.now() };
  const t = state.tasks.find(x => x.id === id);
  if (t && t.cat !== d.cat) patch.sort = 'manual';
  state.editing = null; state.editDraft = null;
  patchTask(id, patch).catch(() => {});
  render();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (state.evEdit) closeEventEditor();
    else if (!$('drawer').hidden) closeDrawer();
    else if (state.editing) { state.editing = null; state.editDraft = null; render(); }
  }
});

/* ---------- drawer: categories & sync ---------- */
function openDrawer() { $('drawer').hidden = false; $('overlay').hidden = false; renderDrawer(); $('drawerClose')?.focus(); }
function closeDrawer() { $('drawer').hidden = true; $('overlay').hidden = true; state.confirmDel = null; $('btnSettings').focus(); }
$('btnSettings').addEventListener('click', openDrawer);
$('overlay').addEventListener('click', closeDrawer);

function renderDrawer() {
  const active = document.activeElement;
  const keep = active && $('drawer').contains(active) && active.id ? { id: active.id, s: active.selectionStart, e: active.selectionEnd } : null;
  const dated = state.tasks.filter(t => !t.done && t.due && !t.example).length + state.events.filter(ev => !ev.example).length;
  $('drawer').innerHTML = `
    <div class="drawer-h"><h2 id="drawerTitle">Settings</h2><button class="ghost" type="button" id="drawerClose">Close</button></div>
    <p class="lead">A note goes to the category whose keywords it mentions most. Notes with no match go to the default. Typing <span class="mono">#name</span> always wins.</p>
    ${state.categories.map((c, i) => {
      const count = tasksOf(c.id).length + state.events.filter(ev => ev.cat === c.id).length;
      const isFb = c.id === state.fallback;
      return `<div class="cat-edit" style="${cvar(c)}" data-cat="${esc(c.id)}">
        <div class="row">
          <label class="sr" for="cn-${i}">Category name</label>
          <input class="field" id="cn-${i}" data-cf="name" data-cat="${esc(c.id)}" value="${esc(c.name)}" style="flex:1;min-width:0;height:36px">
        </div>
        <div class="row" style="justify-content:space-between">
          <div class="swatches" role="group" aria-label="Color">${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button type="button" style="--c:var(--cat-${n})" aria-pressed="${c.color === n}" aria-label="Color ${n}" data-sw="${n}" data-cat="${esc(c.id)}"></button>`).join('')}</div>
          <label class="radio"><input type="radio" name="fallback" value="${esc(c.id)}" ${isFb ? 'checked' : ''} data-fb="1"> Default</label>
        </div>
        <label class="lbl" for="ck-${i}">Keywords, comma-separated</label>
        <textarea id="ck-${i}" data-cf="keywords" data-cat="${esc(c.id)}">${esc((c.keywords || []).join(', '))}</textarea>
        ${state.confirmDel === c.id
          ? `<div class="confirm">Delete ${esc(c.name)}?${count ? ` Its ${plural(count, 'item')} move to ${esc(catById(state.fallback).name)}.` : ''}
              <button class="btn-s danger" type="button" data-dc="yes" data-cat="${esc(c.id)}">Delete</button><button class="btn-s" type="button" data-dc="no">Keep</button></div>`
          : `<div class="row"><button class="btn-s danger" type="button" data-dc="ask" data-cat="${esc(c.id)}" ${isFb || state.categories.length < 2 ? 'disabled title="Pick another default first"' : ''}>Delete category</button></div>`}
      </div>`;
    }).join('')}
    <button class="btn-s" type="button" id="addCat">+ Add category</button>
    <div class="setting-block"><h3>Google Calendar</h3>
      <p>Dated tasks and events have a calendar button that opens Google Calendar with the event filled in, repeats included. To bring everything over at once, export a .ics file and import it in Google Calendar (Settings → Import &amp; export).</p>
      <div><button class="btn-s primary" type="button" id="exportIcs">Export ${plural(dated, 'item')} (.ics)</button></div>
    </div>
    <div class="setting-block"><h3>Backup &amp; other devices</h3>
      <p>Your notes live on this device only. Export a backup to keep a copy, or to move your list to your phone or laptop: open Sortbox there and import the file. Importing adds to what's already there; nothing gets deleted.</p>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-s primary" type="button" id="exportJson">Export backup</button>
        <label class="btn-s file-btn" for="importFile">Import backup…</label>
      </div>
    </div>
    <p class="lead">${storageOk ? `Saved on this device · ${plural(state.tasks.length, 'task')}, ${plural(state.events.length, 'event')}.` : 'Saving is blocked on this device right now.'}</p>`;
  if (keep && $(keep.id)) { const el = $(keep.id); el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) {} }
}

$('drawer').addEventListener('click', e => {
  if (e.target.id === 'drawerClose') return closeDrawer();
  if (e.target.id === 'exportIcs') return exportIcs();
  if (e.target.id === 'exportJson') return exportBackup();
  if (e.target.id === 'addCat') {
    const used = new Set(state.categories.map(c => c.color));
    const color = [1, 2, 3, 4, 5, 6, 7, 8].find(n => !used.has(n)) || 5;
    state.categories.push({ id: 'c' + Date.now().toString(36), name: 'New category', color, keywords: [] });
    savePlanner();
    const last = $('drawer').querySelectorAll('[data-cf="name"]');
    last[last.length - 1]?.focus(); last[last.length - 1]?.select();
    return;
  }
  const sw = e.target.closest('[data-sw]');
  if (sw) { const c = catById(sw.dataset.cat); c.color = +sw.dataset.sw; savePlanner(); return; }
  const dc = e.target.closest('[data-dc]');
  if (dc) {
    if (dc.dataset.dc === 'ask') state.confirmDel = dc.dataset.cat;
    else if (dc.dataset.dc === 'no') state.confirmDel = null;
    else if (dc.dataset.dc === 'yes') {
      const id = dc.dataset.cat;
      const moving = state.tasks.filter(t => t.cat === id);
      const movingEv = state.events.filter(ev => ev.cat === id);
      state.categories = state.categories.filter(c => c.id !== id);
      state.confirmDel = null;
      if (state.view === 'cat:' + id) state.view = 'overview';
      for (const t of moving) patchTask(t.id, { cat: state.fallback }).catch(() => {});
      for (const ev of movingEv) patchDoc('events', ev.id, { cat: state.fallback }).catch(() => {});
      savePlanner();
      return;
    }
    renderDrawer();
  }
});
let kwTimer = null;
$('drawer').addEventListener('input', e => {
  const f = e.target.dataset.cf;
  if (!f) return;
  const c = state.categories.find(x => x.id === e.target.dataset.cat);
  if (!c) return;
  clearTimeout(kwTimer);
  kwTimer = setTimeout(() => {
    if (f === 'name') c.name = e.target.value.trim() || 'Untitled';
    else c.keywords = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    savePlanner();
  }, 400);
});
$('drawer').addEventListener('change', e => {
  if (e.target.dataset.fb) { state.fallback = e.target.value; savePlanner(); }
});

/* ---------- boot ---------- */
function setBanner(html) { const b = $('banner'); b.innerHTML = html || ''; b.hidden = !html; }
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('btnInstall').hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('btnInstall').hidden = true; toast('Sortbox is installed. Open it from your apps.'); });
$('btnInstall').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch (e) {}
  installPrompt = null; $('btnInstall').hidden = true;
});
// another open window changed the data
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY || !e.newValue) return;
  try { applyData(JSON.parse(e.newValue)); syncPreviewOptions(); render(); } catch (err) {}
});
// the app may stay open across midnight; refresh labels when it comes back
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.evEdit && !state.editing) render(); });

function boot() {
  const stored = loadStored();
  if (stored) applyData(stored);
  if (location.hash === '#calendar') state.view = 'calendar';
  state.mode = 'local';
  state.loaded = true;
  syncPreviewOptions();
  render();
  if (!stored) persist();
  try { navigator.storage?.persist?.(); } catch (e) {}
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
// keep the "now" line moving
setInterval(() => { if (state.view === 'calendar' && state.calMode === 'week' && !drag && !state.evEdit && !state.editing) render(); }, 60000);
boot();
