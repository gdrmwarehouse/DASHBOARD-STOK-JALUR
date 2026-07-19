const API_BASE = '/api/stok';
const CACHE_KEY = 'stok_jalur_index_runtime_only_v4';
const LEGACY_DATA_CACHE_KEYS = [
  'stok_jalur_index_v3_menu',
  'stok_jalur_index_v2',
  'stok_jalur_index_v1'
];
const THEME_KEY = 'stok_jalur_theme_v1';
const ALERT_EXP_30_DAYS = 30;
const ALERT_EXP_60_DAYS = 60;
const ALERT_EXP_90_DAYS = 90;
const CRITICAL_EXPIRED_DAYS = 7;
const ALERT_FILTER_LABELS = { ALL: 'Semua READY', LIFETIME: 'Lifetime', EXPIRED: 'Expired', EXP30: 'Exp <30', EXP60: 'Exp <60', EXP90: 'Exp <90' };

let DATA = [];
let PLANTS = [];
let activePlant = 'ALL';
let activeStatus = 'ALL';
let activeAlertFilter = 'ALL';
let activeMenu = 'full';
let deferredInstallPrompt = null;
let skuResults = [];
let ALERT_ROWS = [];
let alertDebounceTimer = null;
let scannerStream = null;
let scannerTimer = null;
window.__renderedItems = [];
window.__renderedBatches = [];

const fmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const btn = document.getElementById('installBtn');
  if (btn) btn.hidden = false;
});

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) document.body.dataset.theme = savedTheme;
  purgeOldLargeDataCache();

  document.getElementById('search').addEventListener('input', () => {
    render();
    scheduleLoadAlerts();
  });
  document.getElementById('sort').addEventListener('change', render);
  document.getElementById('reloadBtn').addEventListener('click', () => loadData(true));
  document.getElementById('refreshBtn').addEventListener('click', refreshIndex);
  const downloadAvailableBtn = document.getElementById('downloadAvailableBtn');
  if (downloadAvailableBtn) downloadAvailableBtn.addEventListener('click', downloadAvailableExcel);
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
  document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
  document.getElementById('installBtn').addEventListener('click', installPwa);
  document.getElementById('skuSearchBtn').addEventListener('click', searchSkuQrFromInput);
  document.getElementById('skuQrInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') searchSkuQrFromInput();
  });
  document.getElementById('scanBtn').addEventListener('click', startScanner);
  document.getElementById('stopScanBtn').addEventListener('click', stopScanner);

  document.querySelectorAll('[data-menu]').forEach(btn => {
    btn.addEventListener('click', () => setMenu(btn.dataset.menu));
  });

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
  setLoading('Memuat data index online...');

  try {
    const res = await api('initial');
    rememberSmallMeta(res);
    applyInitialData(res, false);
  } catch (err) {
    setError(err);
  }
}

function purgeOldLargeDataCache() {
  try {
    LEGACY_DATA_CACHE_KEYS.concat([CACHE_KEY]).forEach(key => localStorage.removeItem(key));
  } catch (err) {
    // Browser private mode / low storage can block localStorage; ignore safely.
  }
}

function rememberSmallMeta(res) {
  // Jangan simpan full index ke localStorage. Data stok bisa besar dan di beberapa HP
  // melewati quota browser. Simpan metadata kecil saja agar reload tetap aman.
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      updatedAt: res && res.updatedAt ? res.updatedAt : '',
      count: res && Array.isArray(res.items) ? res.items.length : 0,
      savedAt: new Date().toISOString()
    }));
  } catch (err) {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }
}

function readLocalCache() {
  return null;
}

function applyInitialData(res, fromCache) {
  DATA = res.items || [];
  PLANTS = res.plants || [];
  document.getElementById('subtitle').textContent = `${fromCache ? 'Cache offline' : 'Online'} • ${DATA.length} raw material • update ${res.updatedAt || '-'}`;
  renderPlantFilters();
  render();
  loadAlerts();
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
  if (activeMenu === 'skuqr' && document.getElementById('skuQrInput').value.trim()) searchSkuQrFromInput();
  loadAlerts();
  render();
}

function setStatus(status) {
  activeStatus = status;
  document.querySelectorAll('[data-status]').forEach(el => el.classList.toggle('active', el.dataset.status === status));
  render();
}

function setMenu(menu) {
  activeMenu = menu;
  document.querySelectorAll('[data-menu]').forEach(el => el.classList.toggle('active', el.dataset.menu === menu));
  document.getElementById('skuPanel').hidden = menu !== 'skuqr';
  document.getElementById('listControls').hidden = menu === 'skuqr';
  document.getElementById('statusFilters').hidden = menu !== 'full';
  if (menu !== 'skuqr') stopScanner();
  render();
}



function scheduleLoadAlerts() {
  clearTimeout(alertDebounceTimer);
  alertDebounceTimer = setTimeout(() => loadAlerts(), 350);
}

async function loadAlerts() {
  const list = document.getElementById('alertList');
  if (list) list.innerHTML = '<div class="alertEmpty">Memuat Alert Center...</div>';

  try {
    const q = document.getElementById('search') ? document.getElementById('search').value || '' : '';
    const res = await api('alerts', { plant: activePlant || 'ALL', q });
    ALERT_ROWS = res.rows || [];
    renderAlertCenter();
  } catch (err) {
    ALERT_ROWS = [];
    const summary = document.getElementById('alertSummary');
    const listBox = document.getElementById('alertList');
    if (summary) summary.innerHTML = '';
    if (listBox) listBox.innerHTML = `<div class="alertEmpty">Alert Center gagal dimuat: ${escapeHtml(err.message || err)}</div>`;
  }
}

function renderAlertCenter() {
  const box = document.getElementById('alertCenter');
  const summary = document.getElementById('alertSummary');
  const list = document.getElementById('alertList');
  if (!box || !summary || !list) return;

  const baseRows = ALERT_ROWS.slice();
  const rows = filterAlertRows(baseRows, activeAlertFilter);
  const totals = summarizeAlertRows(rows);
  const baseTotals = summarizeAlertRows(baseRows);

  summary.innerHTML = `
    <div class="alertMini total"><small>Total Baris</small><b>${fmt.format(totals.count)}</b></div>
    <div class="alertMini good"><small>Total PCS</small><b>${fmt.format(totals.pcs)}</b></div>
    <div class="alertMini good"><small>Total KG</small><b>${fmt.format(totals.kg)}</b></div>
    <div class="alertMini danger"><small>Expired</small><b>${fmt.format(baseTotals.expired)}</b></div>
    <div class="alertMini warn"><small>Exp &lt;30 Hari</small><b>${fmt.format(baseTotals.exp30)}</b></div>
    <div class="alertMini near"><small>Exp &lt;60 Hari</small><b>${fmt.format(baseTotals.exp60)}</b></div>
    <div class="alertMini near"><small>Exp &lt;90 Hari</small><b>${fmt.format(baseTotals.exp90)}</b></div>
  `;

  const filters = Object.entries(ALERT_FILTER_LABELS);
  const plantOptions = [{ plant: 'ALL', label: 'Semua Plant' }].concat(PLANTS || []);
  const plantTools = plantOptions.map(p => `
    <button class="chip ${activePlant === p.plant ? 'active' : ''}" data-alert-plant="${escapeHtml(p.plant)}" type="button">${escapeHtml(p.label || p.plant)}</button>
  `).join('');
  const alertTools = `
    <div class="alertToolGroup">
      <span>Plant Pemilik</span>
      <div class="alertTools">${plantTools}</div>
    </div>
    <div class="alertToolGroup">
      <span>Status Alert</span>
      <div class="alertTools">${filters.map(([key, label]) => `<button class="chip ${activeAlertFilter === key ? 'active' : ''}" data-alert-filter="${key}" type="button">${escapeHtml(label)}</button>`).join('')}<button class="btn primary smallBtn" id="downloadAlertBtn" type="button">Download Excel Alert</button></div>
    </div>
  `;

  if (!baseRows.length) {
    list.innerHTML = `
      ${alertTools}
      <div class="alertEmpty">Tidak ada batch READY untuk filter plant/search ini.</div>
    `;
    bindAlertFilterButtons(list);
    bindAlertPlantButtons(list);
    bindAlertDownloadButton(list);
    return;
  }

  const sortedRows = rows.slice().sort(sortAlertRows);
  window.__alertRows = sortedRows;

  list.innerHTML = `
    ${alertTools}
    <div class="alertTableWrap">
      <table class="alertTable">
        <thead>
          <tr>
            <th>PLANT PEMILIK</th>
            <th>NAMA RM - MERK</th>
            <th>TANGGAL DATANG</th>
            <th>STOK SAAT INI</th>
            <th>KETERANGAN</th>
          </tr>
        </thead>
        <tbody>
          ${sortedRows.map((row, idx) => renderAlertTableRow(row, idx)).join('')}
        </tbody>
      </table>
    </div>
  `;

  bindAlertFilterButtons(list);
  bindAlertPlantButtons(list);
  bindAlertDownloadButton(list);
  list.querySelectorAll('[data-alert-index]').forEach(row => {
    row.addEventListener('click', () => openAlertBatch(window.__alertRows[Number(row.dataset.alertIndex)]));
  });
}

function bindAlertFilterButtons(root) {
  root.querySelectorAll('[data-alert-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeAlertFilter = btn.dataset.alertFilter || 'ALL';
      renderAlertCenter();
    });
  });
}

function bindAlertPlantButtons(root) {
  root.querySelectorAll('[data-alert-plant]').forEach(btn => {
    btn.addEventListener('click', () => {
      setPlant(btn.dataset.alertPlant || 'ALL');
    });
  });
}

function bindAlertDownloadButton(root) {
  const btn = root.querySelector('#downloadAlertBtn');
  if (btn) btn.addEventListener('click', downloadAlertExcel);
}

function filterAlertRows(rows, filter) {
  if (filter === 'LIFETIME') return rows.filter(r => Number.isFinite(Number(r.lifeDays))).sort(sortAlertRows);
  if (filter === 'EXPIRED') return rows.filter(r => r.expiredBucket === 'EXPIRED');
  if (filter === 'EXP30') return rows.filter(r => r.expiredBucket === 'EXP30');
  if (filter === 'EXP60') return rows.filter(r => ['EXP30', 'EXP60'].includes(r.expiredBucket));
  if (filter === 'EXP90') return rows.filter(r => ['EXP30', 'EXP60', 'EXP90'].includes(r.expiredBucket));
  return rows;
}

function summarizeAlertRows(rows) {
  return rows.reduce((acc, row) => {
    acc.count += 1;
    acc.pcs += Number(row.stokPcs || 0);
    acc.kg += Number(row.stokKg || 0);
    const d = Number(row.expiredDays);
    if (row.expiredBucket === 'EXPIRED') acc.expired += 1;
    if (Number.isFinite(d) && d >= 0 && d <= ALERT_EXP_30_DAYS) acc.exp30 += 1;
    if (Number.isFinite(d) && d >= 0 && d <= ALERT_EXP_60_DAYS) acc.exp60 += 1;
    if (Number.isFinite(d) && d >= 0 && d <= ALERT_EXP_90_DAYS) acc.exp90 += 1;
    return acc;
  }, { count: 0, pcs: 0, kg: 0, expired: 0, exp30: 0, exp60: 0, exp90: 0 });
}

function sortAlertRows(a, b) {
  const priority = { EXPIRED: 0, EXP30: 1, EXP60: 2, EXP90: 3, SAFE: 4, NO_DATE: 5 };
  const pa = priority[a.expiredBucket] ?? 9;
  const pb = priority[b.expiredBucket] ?? 9;
  if (pa !== pb) return pa - pb;
  const ad = Number.isFinite(Number(a.expiredDays)) ? Number(a.expiredDays) : 999999;
  const bd = Number.isFinite(Number(b.expiredDays)) ? Number(b.expiredDays) : 999999;
  if (ad !== bd) return ad - bd;
  return Number(b.lifeDays || 0) - Number(a.lifeDays || 0);
}

function renderAlertTableRow(row, idx) {
  const name = formatNameMerk(row);
  const lifeText = Number.isFinite(Number(row.lifeDays)) ? `LIFE TIME : ${fmt.format(row.lifeDays)} HARI` : 'LIFE TIME : -';
  const expText = formatExpiredKet(row);
  const alertClass = row.expiredBucket === 'EXPIRED' ? 'danger' : row.expiredBucket === 'EXP30' ? 'warn' : ['EXP60','EXP90'].includes(row.expiredBucket) ? 'near' : '';

  return `
    <tr data-alert-index="${idx}" class="${escapeHtml(alertClass)}">
      <td><span class="plantPill">${escapeHtml(row.plant || '-')}</span></td>
      <td>
        <b>${escapeHtml(name)}</b>
        <div class="rowSub">SKU ${escapeHtml(row.sku || '-')} • ${escapeHtml(row.skuQr || '-')}</div>
      </td>
      <td>${escapeHtml(row.tanggalDatang || '-')}</td>
      <td>
        <b>${fmt.format(row.stokPcs || 0)} PCS/ZAK</b>
        <div class="rowSub">${fmt.format(row.stokKg || 0)} KG</div>
      </td>
      <td>
        <div class="ketLine">${escapeHtml(lifeText)}</div>
        <div class="ketLine ${escapeHtml(alertClass)}">${escapeHtml(expText)}</div>
      </td>
    </tr>
  `;
}

function formatNameMerk(row) {
  const nama = String(row.nama || row.sheetName || '-').trim();
  const merk = String(row.merk || '').trim();
  if (!merk || merk === '-') return nama;
  if (nama.toLowerCase().includes(merk.toLowerCase())) return nama;
  return `${nama} - ${merk}`;
}

function formatExpiredKet(row) {
  const d = Number(row.expiredDays);
  if (row.expiredBucket === 'NO_DATE') return 'EXPIRED : TANGGAL KOSONG';
  if (row.expiredBucket === 'EXPIRED') return `EXPIRED : LEWAT ${fmt.format(Math.abs(d || 0))} HARI`;
  if (row.expiredBucket === 'EXP30') return `EXPIRED : <30 HARI (${fmt.format(d)} hari lagi)`;
  if (row.expiredBucket === 'EXP60') return `EXPIRED : <60 HARI (${fmt.format(d)} hari lagi)`;
  if (row.expiredBucket === 'EXP90') return `EXPIRED : <90 HARI (${fmt.format(d)} hari lagi)`;
  if (Number.isFinite(d)) return `EXPIRED : AMAN (${fmt.format(d)} hari lagi)`;
  return 'EXPIRED : -';
}

function openAlertBatch(batch) {
  if (!batch) return;
  document.getElementById('drawerTitle').textContent = formatNameMerk(batch);
  document.getElementById('drawerMeta').textContent = `Plant ${batch.plant} • SKU ${batch.sku || '-'} • Datang ${batch.tanggalDatang || '-'} • ${formatExpiredKet(batch)}`;
  document.getElementById('openSheet').href = batch.url || '#';
  document.getElementById('drawerBody').innerHTML = `
    <div class="detailStats">
      <div class="stat"><span>Stok PCS</span><b>${fmt.format(batch.stokPcs || 0)}</b></div>
      <div class="stat"><span>Stok KG</span><b>${fmt.format(batch.stokKg || 0)}</b></div>
      <div class="stat"><span>Life Time</span><b>${Number.isFinite(Number(batch.lifeDays)) ? fmt.format(batch.lifeDays) + ' hari' : '-'}</b></div>
      <div class="stat"><span>Expired</span><b>${Number.isFinite(Number(batch.expiredDays)) ? fmt.format(batch.expiredDays) + ' hari' : '-'}</b></div>
    </div>
    <div class="notice">Alert Center membaca batch READY. Keterangan dihitung dari tanggal datang dan tanggal expired pada cache terbaru.</div>
    ${renderBatch(batch)}
  `;
  openDrawer();
}

function render() {
  if (activeMenu === 'skuqr') {
    renderSkuResults();
    return;
  }

  const q = normalize(document.getElementById('search').value);
  const sort = document.getElementById('sort').value;
  let items = DATA.slice();

  if (activePlant !== 'ALL') items = items.filter(x => x.plant === activePlant);
  if (activeMenu === 'available') items = items.filter(x => x.status === 'READY' && Number(x.totalPcs || 0) > 0);
  if (activeMenu === 'full' && activeStatus !== 'ALL') items = items.filter(x => x.status === activeStatus);
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

  updateStats(items, activeMenu === 'available' ? 'RM ready' : 'RM tampil');
  if (activeMenu === 'available') renderAvailableTable(items);
  else renderCards(items);
}

function updateStats(items, label = 'RM tampil') {
  const pcs = items.reduce((s, x) => s + Number(x.totalPcs || x.stokPcs || 0), 0);
  const kg = items.reduce((s, x) => s + Number(x.totalKg || x.stokKg || 0), 0);
  const updated = items.reduce((a, x) => (x.updatedAt || '') > a ? x.updatedAt : a, '');
  document.getElementById('statItemsLabel').textContent = label;
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
        <div class="badgeStack"><span class="badge ${item.status === 'READY' ? 'good' : 'bad'}">${escapeHtml(item.status || '-')}</span>${renderExpiryBadge(item.expiredNearest)}</div>
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
  content.querySelectorAll('[data-index]').forEach(card => card.addEventListener('click', () => openDetailByItem(window.__renderedItems[Number(card.dataset.index)], false)));
}

function renderAvailableTable(items) {
  const content = document.getElementById('content');
  window.__renderedItems = items;

  if (!items.length) {
    content.className = 'panel empty';
    content.innerHTML = 'Tidak ada stok READY untuk filter ini.';
    return;
  }

  content.className = 'panel tablePanel';
  content.innerHTML = `
    <div class="tableHead">
      <div>
        <h2>Stok Tersedia</h2>
        <p>Hanya raw material yang masih READY. Klik baris untuk lihat detail keluar per batch.</p>
      </div>
      <div class="tableActions">
        <button class="btn primary" id="downloadAvailableBtn" type="button">Download Excel</button>
        <span class="badge good">${fmt.format(items.length)} RM READY</span>
      </div>
    </div>
    <div class="tableWrap">
      <table class="dataTable">
        <thead>
          <tr>
            <th>Plant</th><th>SKU</th><th>Nama RM</th><th>Merk</th><th>PCS</th><th>KG</th><th>Batch</th><th>FIFO</th><th>Expired</th><th>Alert</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, idx) => `
            <tr data-index="${idx}">
              <td><span class="plantPill">${escapeHtml(item.plant)}</span></td>
              <td>${escapeHtml(item.sku || '-')}</td>
              <td><b>${escapeHtml(item.nama || item.sheetName)}</b><div class="rowSub">${escapeHtml(item.sheetName)}</div></td>
              <td>${escapeHtml(item.merk || '-')}</td>
              <td class="num">${fmt.format(item.totalPcs || 0)}</td>
              <td class="num">${fmt.format(item.totalKg || 0)}</td>
              <td class="num">${fmt.format(item.batchReady || 0)}</td>
              <td>${escapeHtml(item.fifoDate || '-')}</td>
              <td>${escapeHtml(item.expiredNearest || '-')}</td>
              <td>${renderExpiryBadge(item.expiredNearest)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  const exportBtn = document.getElementById('downloadAvailableBtn');
  if (exportBtn) exportBtn.addEventListener('click', downloadAvailableExcel);
  content.querySelectorAll('[data-index]').forEach(row => row.addEventListener('click', () => openDetailByItem(window.__renderedItems[Number(row.dataset.index)], true)));
}

async function downloadAlertExcel() {
  const rows = filterAlertRows(ALERT_ROWS.slice(), activeAlertFilter).sort(sortAlertRows);
  const btn = document.getElementById('downloadAlertBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyiapkan...';
  }

  try {
    if (!rows.length) {
      toast('Tidak ada data alert untuk didownload.');
      return;
    }
    const plant = activePlant || 'ALL';
    const filterLabel = ALERT_FILTER_LABELS[activeAlertFilter] || activeAlertFilter || 'Semua READY';
    const title = `ALERT_CENTER_${plant === 'ALL' ? 'SEMUA_PLANT' : plant}_${String(activeAlertFilter || 'ALL')}`;
    exportAlertRowsToExcel(title, rows, { plant, filterLabel });
    toast('Excel Alert Center berhasil dibuat.');
  } catch (err) {
    toast('Download alert gagal: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Download Excel Alert';
    }
  }
}

function exportAlertRowsToExcel(title, rows, meta) {
  const headers = [
    'NO',
    'PLANT PEMILIK',
    'NAMA RM - MERK',
    'SKU RM',
    'SKU QR',
    'TANGGAL DATANG',
    'TANGGAL EXPIRED',
    'STOK PCS/ZAK',
    'STOK KG',
    'LIFE TIME HARI',
    'SISA HARI EXPIRED',
    'KETERANGAN'
  ];

  const printedAt = new Date().toLocaleString('id-ID');
  const plantText = meta && meta.plant ? meta.plant : (activePlant || 'ALL');
  const filterText = meta && meta.filterLabel ? meta.filterLabel : (ALERT_FILTER_LABELS[activeAlertFilter] || activeAlertFilter || '-');
  const qText = document.getElementById('search') ? document.getElementById('search').value || '' : '';
  const safeTitle = title.replace(/[^A-Z0-9_ -]/gi, '_');

  const tableRows = rows.map((row, idx) => {
    const lifeDays = Number.isFinite(Number(row.lifeDays)) ? Number(row.lifeDays) : '';
    const expiredDays = Number.isFinite(Number(row.expiredDays)) ? Number(row.expiredDays) : '';
    const ket = `${Number.isFinite(Number(row.lifeDays)) ? `LIFE TIME : ${fmt.format(row.lifeDays)} HARI` : 'LIFE TIME : -'}; ${formatExpiredKet(row)}`;
    return [
      idx + 1,
      row.plant || '',
      formatNameMerk(row),
      row.sku || '',
      row.skuQr || '',
      row.tanggalDatang || '',
      row.expired || '',
      numberForExcel(row.stokPcs),
      numberForExcel(row.stokKg),
      lifeDays,
      expiredDays,
      ket
    ];
  });

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="UTF-8" />
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>Alert Center</x:Name>
              <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        body { font-family: Arial, sans-serif; }
        table { border-collapse: collapse; }
        th { background: #fce5cd; font-weight: bold; text-align: center; }
        th, td { border: 1px solid #777; padding: 6px; vertical-align: top; }
        .title { font-size: 18px; font-weight: bold; background: #073763; color: #fff; }
        .meta { background: #f3f6fa; font-weight: bold; }
        .num { mso-number-format:"0.00"; text-align: right; }
        .text { mso-number-format:"\@"; }
      </style>
    </head>
    <body>
      <table>
        <tr><td class="title" colspan="${headers.length}">LAPORAN ALERT CENTER STOK JALUR</td></tr>
        <tr><td class="meta" colspan="${headers.length}">Plant Pemilik: ${escapeExcel(plantText)} | Filter Alert: ${escapeExcel(filterText)} | Search: ${escapeExcel(qText || '-')} | Dibuat: ${escapeExcel(printedAt)}</td></tr>
        <tr>${headers.map(h => `<th>${escapeExcel(h)}</th>`).join('')}</tr>
        ${tableRows.map(r => `<tr>${r.map((cell, colIdx) => {
          const cls = [0,7,8,9,10].includes(colIdx) ? 'num' : 'text';
          return `<td class="${cls}">${escapeExcel(cell)}</td>`;
        }).join('')}</tr>`).join('')}
      </table>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}_${todayKeyForFile()}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadAvailableExcel() {
  if (activeMenu !== 'available') {
    setMenu('available');
  }

  const q = document.getElementById('search').value || '';
  const plant = activePlant || 'ALL';
  const btn = document.getElementById('downloadAvailableBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyiapkan...';
  }

  toast('Menyiapkan file Excel stok tersedia...');

  try {
    const res = await api('available_export', { plant, q });
    const rows = res.rows || [];
    if (!rows.length) {
      toast('Tidak ada data READY untuk didownload.');
      return;
    }

    const title = `STOK_TERSEDIA_${plant === 'ALL' ? 'SEMUA_PLANT' : plant}`;
    exportRowsToExcel(title, rows, res);
    toast('Excel stok tersedia berhasil dibuat.');
  } catch (err) {
    toast('Download gagal: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Download Excel';
    }
  }
}

function exportRowsToExcel(title, rows, meta) {
  const headers = [
    'NO',
    'PLANT',
    'SKU RM',
    'NAMA RM',
    'MERK',
    'TOTAL PCS READY',
    'TOTAL KG READY',
    'JUMLAH BATCH READY',
    'FIFO / KEDATANGAN TERLAMA',
    'EXPIRED TERDEKAT',
    'NOTE KEDATANGAN'
  ];

  const safeTitle = title.replace(/[^A-Z0-9_ -]/gi, '_');
  const printedAt = new Date().toLocaleString('id-ID');
  const plantText = meta && meta.plant ? meta.plant : (activePlant || 'ALL');
  const qText = meta && meta.q ? meta.q : (document.getElementById('search').value || '');

  const tableRows = rows.map((row, idx) => [
    idx + 1,
    row.plant || '',
    row.sku || '',
    row.nama || '',
    row.merk || '',
    numberForExcel(row.totalPcs),
    numberForExcel(row.totalKg),
    numberForExcel(row.batchReady),
    row.fifoDate || '',
    row.expiredNearest || '',
    row.noteKedatangan || ''
  ]);

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="UTF-8" />
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>Stok Tersedia</x:Name>
              <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        body { font-family: Arial, sans-serif; }
        table { border-collapse: collapse; }
        th { background: #d9ead3; font-weight: bold; text-align: center; }
        th, td { border: 1px solid #777; padding: 6px; vertical-align: top; }
        .title { font-size: 18px; font-weight: bold; background: #073763; color: #fff; }
        .meta { background: #f3f6fa; font-weight: bold; }
        .num { mso-number-format:"0.00"; text-align: right; }
        .text { mso-number-format:"\@"; }
      </style>
    </head>
    <body>
      <table>
        <tr><td class="title" colspan="${headers.length}">LAPORAN STOK TERSEDIA</td></tr>
        <tr><td class="meta" colspan="${headers.length}">Plant: ${escapeExcel(plantText)} | Filter: ${escapeExcel(qText || '-')} | Dibuat: ${escapeExcel(printedAt)}</td></tr>
        <tr>${headers.map(h => `<th>${escapeExcel(h)}</th>`).join('')}</tr>
        ${tableRows.map(r => `<tr>${r.map((cell, colIdx) => {
          const cls = [0,5,6,7].includes(colIdx) ? 'num' : 'text';
          return `<td class="${cls}">${escapeExcel(cell)}</td>`;
        }).join('')}</tr>`).join('')}
      </table>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}_${todayKeyForFile()}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function numberForExcel(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function todayKeyForFile() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function escapeExcel(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function openDetailByItem(item, readyOnly) {
  if (!item) return;

  document.getElementById('drawerTitle').textContent = item.nama || item.sheetName;
  document.getElementById('drawerMeta').textContent = `Plant ${item.plant} • SKU ${item.sku || '-'} ${item.merk ? '• ' + item.merk : ''}${readyOnly ? ' • READY saja' : ''}`;
  document.getElementById('openSheet').href = item.url || '#';
  document.getElementById('drawerBody').innerHTML = '<div class="loader">Memuat detail batch...</div>';
  openDrawer();

  try {
    const res = await api('batches', { plant: item.plant, sheetName: item.sheetName });
    let batches = res.batches || [];
    if (readyOnly) batches = batches.filter(b => Number(b.stokPcs || 0) > 0);
    renderDetail(item, batches, readyOnly);
  } catch (err) {
    document.getElementById('drawerBody').innerHTML = `<div class="empty">${escapeHtml(err.message || err)}</div>`;
  }
}

function renderDetail(item, batches, readyOnly) {
  const totalPcs = batches.reduce((s, b) => s + Number(b.stokPcs || 0), 0);
  const totalKg = batches.reduce((s, b) => s + Number(b.stokKg || 0), 0);
  const ready = batches.filter(b => Number(b.stokPcs || 0) > 0).length;

  document.getElementById('drawerBody').innerHTML = `
    <div class="detailStats">
      <div class="stat"><span>Total PCS</span><b>${fmt.format(totalPcs)}</b></div>
      <div class="stat"><span>Total KG</span><b>${fmt.format(totalKg)}</b></div>
      <div class="stat"><span>Batch Ready</span><b>${fmt.format(ready)}</b></div>
      <div class="stat"><span>${readyOnly ? 'Batch Ditampilkan' : 'Total Batch'}</span><b>${fmt.format(batches.length)}</b></div>
    </div>
    ${readyOnly ? '<div class="notice">Mode Stok Tersedia: batch HABIS disembunyikan.</div>' : ''}
    ${batches.map(renderBatch).join('') || '<div class="empty">Belum ada batch di cache.</div>'}
  `;
}

function renderBatch(b) {
  const outRows = (b.keluar || []).filter(x => x.tanggal || x.qtyPcs || x.sisaPcs || x.hasSisaPcs);
  return `
    <section class="batch">
      <div class="batchMain">
        <div>
          <div class="batchTitle">${escapeHtml(b.skuQr || '-')}</div>
          <div class="batchSub">Datang: ${escapeHtml(b.tanggalDatang || '-')} • Batch: ${escapeHtml(b.noBatch || '-')} • Exp: ${escapeHtml(b.expired || '-')}</div>
          <div class="batchSub">Supplier: ${escapeHtml(b.supplier || '-')} • PO/GR: ${escapeHtml(b.poGr || '-')}</div>
        </div>
        <div class="badgeStack"><span class="badge ${b.status === 'READY' ? 'good' : 'bad'}">${escapeHtml(b.status || '-')}</span>${renderExpiryBadge(b.expired)}</div>
      </div>
      <div class="batchInfo">
        <div class="mini"><small>Qty Datang PCS</small><b>${fmt.format(b.qtyDatangPcs || 0)}</b></div>
        <div class="mini"><small>Qty Datang KG</small><b>${fmt.format(b.qtyDatangKg || 0)}</b></div>
        <div class="mini"><small>Stok PCS</small><b>${fmt.format(b.stokPcs || 0)}</b></div>
        <div class="mini"><small>Stok KG</small><b>${fmt.format(b.stokKg || 0)}</b></div>
      </div>
      ${b.keterangan ? `<div class="batchInfo one"><div class="mini"><small>Keterangan</small>${escapeHtml(b.keterangan)}</div></div>` : ''}
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

async function searchSkuQrFromInput() {
  const q = document.getElementById('skuQrInput').value.trim();
  if (!q) {
    skuResults = [];
    renderSkuResults();
    toast('Masukkan / scan SKU QR dulu.');
    return;
  }

  setLoading('Mencari SKU QR...');
  try {
    const res = await api('skuqr', { q, plant: activePlant, readyOnly: 1 });
    skuResults = res.batches || [];
    renderSkuResults();
  } catch (err) {
    skuResults = [];
    setError(err);
  }
}

function renderSkuResults() {
  const content = document.getElementById('content');
  const q = document.getElementById('skuQrInput').value.trim();
  window.__renderedBatches = skuResults;
  updateStats(skuResults, 'Batch ready');

  if (!q && !skuResults.length) {
    content.className = 'panel empty skuEmpty';
    content.innerHTML = `
      <h2>Scan / cari SKU QR</h2>
      <p>Masukkan SKU QR lalu klik Cari. Setelah hasil muncul, klik batch untuk melihat stok jalur dan history keluar sampai stok terakhir.</p>
    `;
    return;
  }

  if (!skuResults.length) {
    content.className = 'panel empty';
    content.innerHTML = `Tidak ada batch READY untuk SKU QR: <b>${escapeHtml(q || '-')}</b>. Coba update index atau cek apakah batch sudah habis.`;
    return;
  }

  content.className = 'grid skuGrid';
  content.innerHTML = skuResults.map((b, idx) => `
    <article class="panel card skuCard" data-batch-index="${idx}">
      <div class="cardTop">
        <div>
          <div class="title">${escapeHtml(b.nama || b.sheetName)}</div>
          <div class="meta">SKU ${escapeHtml(b.sku || '-')} ${b.merk ? '• ' + escapeHtml(b.merk) : ''}</div>
          <div class="meta">Plant ${escapeHtml(b.plant)} • ${escapeHtml(b.sheetName)}</div>
        </div>
        <span class="badge good">READY</span>
      </div>
      <div class="skuQrBox">${escapeHtml(b.skuQr || '-')}</div>
      <div class="numbers">
        <div class="mini"><small>Stok PCS</small><b>${fmt.format(b.stokPcs || 0)}</b></div>
        <div class="mini"><small>Stok KG</small><b>${fmt.format(b.stokKg || 0)}</b></div>
      </div>
      <div class="fifo">
        <span>Datang: <b>${escapeHtml(b.tanggalDatang || '-')}</b></span>
        <span>Batch: <b>${escapeHtml(b.noBatch || '-')}</b></span>
        <span>EXP: <b>${escapeHtml(b.expired || '-')}</b></span>
      </div>
    </article>
  `).join('');

  content.querySelectorAll('[data-batch-index]').forEach(card => card.addEventListener('click', () => openSkuBatch(window.__renderedBatches[Number(card.dataset.batchIndex)])));
}

function openSkuBatch(batch) {
  if (!batch) return;
  document.getElementById('drawerTitle').textContent = batch.nama || batch.sheetName;
  document.getElementById('drawerMeta').textContent = `Plant ${batch.plant} • SKU ${batch.sku || '-'} • SKU QR ${batch.skuQr || '-'}`;
  document.getElementById('openSheet').href = batch.url || '#';
  document.getElementById('drawerBody').innerHTML = `
    <div class="detailStats">
      <div class="stat"><span>Stok PCS</span><b>${fmt.format(batch.stokPcs || 0)}</b></div>
      <div class="stat"><span>Stok KG</span><b>${fmt.format(batch.stokKg || 0)}</b></div>
      <div class="stat"><span>Qty Datang PCS</span><b>${fmt.format(batch.qtyDatangPcs || 0)}</b></div>
      <div class="stat"><span>Status</span><b>${escapeHtml(batch.status || '-')}</b></div>
    </div>
    <div class="notice">Detail ini khusus SKU QR yang discan/manual, dan hanya batch READY yang ditampilkan di menu ini.</div>
    ${renderBatch(batch)}
  `;
  openDrawer();
}

async function startScanner() {
  if (!('BarcodeDetector' in window)) {
    toast('Scanner kamera belum didukung di browser ini. Gunakan Chrome Android atau input manual.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Kamera tidak tersedia di browser ini. Gunakan input manual.');
    return;
  }

  stopScanner();

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const video = document.getElementById('scannerVideo');
    video.srcObject = scannerStream;
    await video.play();

    document.getElementById('scannerBox').hidden = false;
    document.getElementById('scanBtn').hidden = true;
    document.getElementById('stopScanBtn').hidden = false;

    const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
    scannerTimer = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const value = codes[0].rawValue || '';
          if (value) {
            document.getElementById('skuQrInput').value = value.trim();
            toast('QR terbaca: ' + value.trim());
            stopScanner();
            searchSkuQrFromInput();
          }
        }
      } catch (err) {}
    }, 450);
  } catch (err) {
    stopScanner();
    toast('Kamera gagal dibuka: ' + (err.message || err));
  }
}

function stopScanner() {
  if (scannerTimer) clearInterval(scannerTimer);
  scannerTimer = null;
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
  }
  scannerStream = null;
  const video = document.getElementById('scannerVideo');
  if (video) video.srcObject = null;
  const box = document.getElementById('scannerBox');
  if (box) box.hidden = true;
  const scanBtn = document.getElementById('scanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  if (scanBtn) scanBtn.hidden = false;
  if (stopBtn) stopBtn.hidden = true;
}

function openDrawer() {
  document.getElementById('drawerBackdrop').classList.add('open');
  document.getElementById('drawer').classList.add('open');
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
    rememberSmallMeta(res);
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
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
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
  m = s.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}${String(m[2]).padStart(2,'0')}${String(m[1]).padStart(2,'0')}`;
  }
  return '99999999';
}


function getExpiryInfo(expiredText) {
  const key = keyDate(expiredText);
  if (!expiredText || key === '99999999') {
    return { status: 'NO_DATE', className: 'muted', daysLeft: null, label: 'Tanggal expired kosong' };
  }

  const yyyy = Number(key.slice(0, 4));
  const mm = Number(key.slice(4, 6));
  const dd = Number(key.slice(6, 8));
  const expDate = new Date(yyyy, mm - 1, dd);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysLeft = Math.ceil((expDate.getTime() - todayStart.getTime()) / 86400000);

  if (daysLeft < 0) {
    return { status: 'EXPIRED', className: 'danger', daysLeft, label: `Expired ${Math.abs(daysLeft)} hari lalu` };
  }
  if (daysLeft <= CRITICAL_EXPIRED_DAYS) {
    return { status: 'CRITICAL', className: 'warn', daysLeft, label: `${daysLeft} hari lagi` };
  }
  if (daysLeft <= ALERT_EXP_30_DAYS) {
    return { status: 'NEAR', className: 'near', daysLeft, label: `${daysLeft} hari lagi` };
  }
  return { status: 'SAFE', className: 'safe', daysLeft, label: `${daysLeft} hari lagi` };
}

function renderExpiryBadge(expiredText) {
  const exp = getExpiryInfo(expiredText);
  if (exp.status === 'SAFE') return '';
  if (exp.status === 'NO_DATE') return '<span class="badge muted">EXP kosong</span>';
  const title = expiredText ? `${expiredText} • ${exp.label}` : exp.label;
  const label = exp.status === 'EXPIRED' ? 'EXPIRED' : exp.status === 'CRITICAL' ? 'KRITIS EXP' : 'NEAR EXP';
  return `<span class="badge ${escapeHtml(exp.className)}" title="${escapeHtml(title)}">${label}</span>`;
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
