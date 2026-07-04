const API_BASE = '/api/stok';
const CACHE_KEY = 'stok_jalur_index_v1';
const THEME_KEY = 'stok_jalur_theme_v1';

let DATA = [];
let PLANTS = [];
let activePlant = 'ALL';
let activeStatus = 'ALL';
let deferredInstallPrompt = null;
window.__renderedItems = [];

const fmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const btn = document.getElementById('installBtn');
  if (btn) btn.hidden = false;
});

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) document.body.dataset.theme = savedTheme;

  document.getElementById('search').addEventListener('input', render);
  document.getElementById('sort').addEventListener('change', render);
  document.getElementById('reloadBtn').addEventListener('click', () => loadData(true));
  document.getElementById('refreshBtn').addEventListener('click', refreshIndex);
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
  document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
  document.getElementById('installBtn').addEventListener('click', installPwa);

  document.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => setStatus(btn.dataset.status));
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  loadData(false);
});

async function api(action, params = {}) {
  const url = new URL(API_BASE, window.location.origin);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v == null ? '' : String(v)));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Request gagal');
  return json;
}

async function loadData(forceNetwork) {
  setLoading('Memuat data index...');

  if (!forceNetwork) {
    const cached = readLocalCache();
    if (cached && Array.isArray(cached.items) && cached.items.length) {
      applyInitialData(cached, true);
    }
  }

  try {
    const res = await api('initial');
    localStorage.setItem(CACHE_KEY, JSON.stringify(res));
    applyInitialData(res, false);
  } catch (err) {
    const cached = readLocalCache();
    if (cached && Array.isArray(cached.items) && cached.items.length) {
      applyInitialData(cached, true);
      toast('Mode cache offline: ' + (err.message || err));
    } else {
      setError(err);
    }
  }
}

function readLocalCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

function applyInitialData(res, fromCache) {
  DATA = res.items || [];
  PLANTS = res.plants || [];
  document.getElementById('subtitle').textContent = `${fromCache ? 'Cache offline' : 'Online'} • ${DATA.length} raw material • update ${res.updatedAt || '-'}`;
  renderPlantFilters();
  render();
}

function renderPlantFilters() {
  const wrap = document.getElementById('plantFilters');
  const chips = [{ plant: 'ALL', label: 'Semua Plant' }].concat(PLANTS);
  wrap.innerHTML = chips.map(p => `
    <button class="chip ${activePlant === p.plant ? 'active' : ''}" data-plant="${escapeHtml(p.plant)}">
      ${escapeHtml(p.label || p.plant)}
    </button>
  `).join('');
  wrap.querySelectorAll('[data-plant]').forEach(btn => btn.addEventListener('click', () => setPlant(btn.dataset.plant)));
}

function setPlant(plant) {
  activePlant = plant;
  document.querySelectorAll('[data-plant]').forEach(el => el.classList.toggle('active', el.dataset.plant === plant));
  render();
}

function setStatus(status) {
  activeStatus = status;
  document.querySelectorAll('[data-status]').forEach(el => el.classList.toggle('active', el.dataset.status === status));
  render();
}

function render() {
  const q = normalize(document.getElementById('search').value);
  const sort = document.getElementById('sort').value;
  let items = DATA.slice();

  if (activePlant !== 'ALL') items = items.filter(x => x.plant === activePlant);
  if (activeStatus !== 'ALL') items = items.filter(x => x.status === activeStatus);
  if (q) {
    const words = q.split(' ').filter(Boolean);
    items = items.filter(x => words.every(w => (x.keyword || normalize(Object.values(x).join(' '))).includes(w)));
  }

  items.sort((a, b) => {
    if (sort === 'name_asc') return String(a.nama || a.sheetName).localeCompare(String(b.nama || b.sheetName));
    if (sort === 'fifo_asc') return keyDate(a.fifoDate).localeCompare(keyDate(b.fifoDate));
    if (sort === 'expired_asc') return keyDate(a.expiredNearest).localeCompare(keyDate(b.expiredNearest));
    return (Number(b.totalPcs || 0)) - (Number(a.totalPcs || 0));
  });

  updateStats(items);
  renderCards(items);
}

function updateStats(items) {
  const pcs = items.reduce((s, x) => s + Number(x.totalPcs || 0), 0);
  const kg = items.reduce((s, x) => s + Number(x.totalKg || 0), 0);
  const updated = items.reduce((a, x) => (x.updatedAt || '') > a ? x.updatedAt : a, '');
  document.getElementById('statItems').textContent = fmt.format(items.length);
  document.getElementById('statPcs').textContent = fmt.format(pcs);
  document.getElementById('statKg').textContent = fmt.format(kg);
  document.getElementById('statUpdated').textContent = updated || '-';
}

function renderCards(items) {
  const content = document.getElementById('content');
  window.__renderedItems = items;

  if (!items.length) {
    content.className = 'panel empty';
    content.innerHTML = 'Data tidak ditemukan. Coba keyword lain atau update index.';
    return;
  }

  content.className = 'grid';
  content.innerHTML = items.map((item, idx) => `
    <article class="panel card" data-index="${idx}">
      <div class="cardTop">
        <div>
          <div class="title">${escapeHtml(item.nama || item.sheetName)}</div>
          <div class="meta">${escapeHtml(item.sku)} ${item.merk ? '• ' + escapeHtml(item.merk) : ''}</div>
          <div class="meta">Plant ${escapeHtml(item.plant)} • ${escapeHtml(item.sheetName)}</div>
        </div>
        <span class="badge ${item.status === 'READY' ? 'good' : 'bad'}">${escapeHtml(item.status || '-')}</span>
      </div>
      <div class="numbers">
        <div class="mini"><small>Total PCS</small><b>${fmt.format(item.totalPcs || 0)}</b></div>
        <div class="mini"><small>Total KG</small><b>${fmt.format(item.totalKg || 0)}</b></div>
      </div>
      <div class="fifo">
        <span>Batch ready: <b>${fmt.format(item.batchReady || 0)}</b> / ${fmt.format(item.totalBatch || 0)}</span>
        <span>FIFO: <b>${escapeHtml(item.fifoDate || '-')}</b></span>
        <span>EXP: <b>${escapeHtml(item.expiredNearest || '-')}</b></span>
      </div>
    </article>
  `).join('');
  content.querySelectorAll('[data-index]').forEach(card => card.addEventListener('click', () => openDetail(Number(card.dataset.index))));
}

async function openDetail(index) {
  const item = window.__renderedItems[index];
  if (!item) return;

  document.getElementById('drawerTitle').textContent = item.nama || item.sheetName;
  document.getElementById('drawerMeta').textContent = `Plant ${item.plant} • SKU ${item.sku || '-'} ${item.merk ? '• ' + item.merk : ''}`;
  document.getElementById('openSheet').href = item.url || '#';
  document.getElementById('drawerBody').innerHTML = '<div class="loader">Memuat detail batch...</div>';
  document.getElementById('drawerBackdrop').classList.add('open');
  document.getElementById('drawer').classList.add('open');

  try {
    const res = await api('batches', { plant: item.plant, sheetName: item.sheetName });
    renderDetail(item, res.batches || []);
  } catch (err) {
    document.getElementById('drawerBody').innerHTML = `<div class="empty">${escapeHtml(err.message || err)}</div>`;
  }
}

function renderDetail(item, batches) {
  const totalPcs = batches.reduce((s, b) => s + Number(b.stokPcs || 0), 0);
  const totalKg = batches.reduce((s, b) => s + Number(b.stokKg || 0), 0);
  const ready = batches.filter(b => Number(b.stokPcs || 0) > 0).length;

  document.getElementById('drawerBody').innerHTML = `
    <div class="detailStats">
      <div class="stat"><span>Total PCS</span><b>${fmt.format(totalPcs)}</b></div>
      <div class="stat"><span>Total KG</span><b>${fmt.format(totalKg)}</b></div>
      <div class="stat"><span>Batch Ready</span><b>${fmt.format(ready)}</b></div>
      <div class="stat"><span>Total Batch</span><b>${fmt.format(batches.length)}</b></div>
    </div>
    ${batches.map(renderBatch).join('') || '<div class="empty">Belum ada batch di cache.</div>'}
  `;
}

function renderBatch(b) {
  const outRows = (b.keluar || []).filter(x => x.tanggal || x.qtyPcs || x.sisaPcs);
  return `
    <section class="batch">
      <div class="batchMain">
        <div>
          <div class="batchTitle">${escapeHtml(b.skuQr || '-')}</div>
          <div class="batchSub">Datang: ${escapeHtml(b.tanggalDatang || '-')} • Batch: ${escapeHtml(b.noBatch || '-')} • Exp: ${escapeHtml(b.expired || '-')}</div>
          <div class="batchSub">Supplier: ${escapeHtml(b.supplier || '-')} • PO/GR: ${escapeHtml(b.poGr || '-')}</div>
        </div>
        <span class="badge ${b.status === 'READY' ? 'good' : 'bad'}">${escapeHtml(b.status || '-')}</span>
      </div>
      <div class="batchInfo">
        <div class="mini"><small>Qty Datang PCS</small><b>${fmt.format(b.qtyDatangPcs || 0)}</b></div>
        <div class="mini"><small>Qty Datang KG</small><b>${fmt.format(b.qtyDatangKg || 0)}</b></div>
        <div class="mini"><small>Stok PCS</small><b>${fmt.format(b.stokPcs || 0)}</b></div>
        <div class="mini"><small>Stok KG</small><b>${fmt.format(b.stokKg || 0)}</b></div>
      </div>
      ${b.keterangan ? `<div class="batchInfo" style="grid-template-columns:1fr"><div class="mini"><small>Keterangan</small>${escapeHtml(b.keterangan)}</div></div>` : ''}
      <div class="outTable">
        ${outRows.length ? `
          <table>
            <thead><tr><th>Tanggal Keluar</th><th>Jumlah PCS</th><th>Sisa PCS</th></tr></thead>
            <tbody>${outRows.map(x => `<tr><td>${escapeHtml(x.tanggal || '-')}</td><td>${fmt.format(x.qtyPcs || 0)}</td><td>${fmt.format(x.sisaPcs || 0)}</td></tr>`).join('')}</tbody>
          </table>
        ` : `<div class="meta">Belum ada rincian keluar.</div>`}
      </div>
    </section>
  `;
}

function closeDrawer() {
  document.getElementById('drawerBackdrop').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}

async function refreshIndex() {
  const plant = activePlant || 'ALL';
  const pin = prompt(`Update index ${plant === 'ALL' ? 'semua plant' : 'plant ' + plant}. Masukkan PIN:`);
  if (pin === null) return;
  toast('Update index berjalan...');
  try {
    const res = await api('refresh', { plant, pin });
    localStorage.setItem(CACHE_KEY, JSON.stringify(res));
    applyInitialData(res, false);
    toast('Index selesai diupdate');
  } catch (err) {
    toast(err.message || String(err));
  }
}

function toggleTheme() {
  document.body.dataset.theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, document.body.dataset.theme);
}

async function installPwa() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  document.getElementById('installBtn').hidden = true;
}

function setLoading(text) {
  const content = document.getElementById('content');
  content.className = 'panel loader';
  content.textContent = text;
}

function setError(err) {
  const content = document.getElementById('content');
  content.className = 'panel empty';
  content.textContent = 'Error: ' + (err.message || err);
}

function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function normalize(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function keyDate(v) {
  const s = String(v || '').toLowerCase();
  const months = {jan:'01',januari:'01',feb:'02',februari:'02',mar:'03',maret:'03',apr:'04',april:'04',mei:'05',may:'05',jun:'06',juni:'06',jul:'07',juli:'07',agu:'08',ags:'08',agustus:'08',sep:'09',sept:'09',okt:'10',oct:'10',nov:'11',des:'12',dec:'12'};
  let m = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (m && months[m[2]]) return `${m[3]}${months[m[2]]}${String(m[1]).padStart(2,'0')}`;
  m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return `${m[1]}${String(m[2]).padStart(2,'0')}${String(m[3]).padStart(2,'0')}`;
  return '99999999';
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
