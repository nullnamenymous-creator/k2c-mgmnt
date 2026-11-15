import { purchasePdf } from './purchase-pdf.js';
import { financialReport, reportDay, reportRange } from './financial-report.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const fmt = value => rupiah.format(value);
const date = value => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = (rows, id) => rows.find(row => row.id === id);
const label = p => p ? p.name + (p.variant ? ' / ' + p.variant : '') : 'Barang';
const total = sale => sale.items.reduce((sum, item) => sum + item.price * item.qty, 0);
const modalCost = sale => sale.items.reduce((sum, item) => sum + (item.parts ? item.parts.reduce((cost, part) => cost + part.cost * part.qty, 0) : item.cost * item.qty), 0);
const brand = '<div class="brand"><img src="/icon.svg" alt=""><div><strong>K2C Management</strong><small>K2C Komputindo</small></div></div>';
const statuses = ['Pesanan masuk', 'Siap kirim', 'Dikirim', 'Retur diterima', 'Bukti retur lengkap', 'Retur diperiksa', 'Dibatalkan'];
const menus = { home: 'Ringkasan', online: 'Marketplace', shop: 'Penjualan Toko', stock: 'Stok Barang', buy: 'Pembelian', finance: 'Laba Rugi', low: 'Stok Menipis', suppliers: 'Supplier' };
const marketplaces = ['Shopee', 'Tokopedia'];
const marketTheme = channel => marketplaces.includes(channel) ? ' data-market="' + channel.toLowerCase() + '"' : '';
const marketBadge = channel => '<span class="market-badge"' + marketTheme(channel) + '>' + esc(channel) + '</span>';
const technicianStages = [
  ['Pesanan masuk', 'Perlu tes', 'Cek barang & rekam'],
  ['Siap kirim', 'Siap kirim', 'Catat serah terima'],
  ['Retur diterima', 'Perlu bukti retur', 'Catat bukti retur'],
  ['Bukti retur lengkap', 'Perlu cek retur', 'Cek kondisi barang'],
];
let state;
let view = 'home';
let financeDate = reportDay();
let financePeriod = 'day';
let financeChannel = '';
let query = '';
let filter = '';
let listPage = 1;
const listPageSize = 10;
let marketplace = marketplaces[0];
const marketplaceFilters = new Map();
let noticeTimer;
let releaseCamera;
const can = (...roles) => roles.includes(state.user.role);
const button = (title, action, key = '', kind = '') => '<button type="button" class="button ' + kind + '" data-action="' + action + '" data-key="' + esc(key) + '">' + esc(title) + '</button>';
const field = (name, title, value = '', type = 'text', extra = '') => '<label>' + esc(title) + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + extra + '></label>';
const amount = (name, title, value = '', min = 0, required = true) => field(name, title, value, 'number', 'min="' + min + '" step="1"' + (required ? ' required' : ''));
const select = (name, title, options, current = '') => '<label>' + esc(title) + '<select name="' + name + '" required>' + options.map(([value, text]) => '<option value="' + esc(value) + '"' + (current === value ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
const proof = (title, accept) => '<label>' + esc(title) + '<input type="file" name="proof" accept="' + accept + '" required></label>';
const activeProducts = () => state.products.filter(p => !p.archivedAt);
const options = () => [['', 'Pilih barang'], ...activeProducts().map(p => [p.id, label(p)])];
const stage = s => '<span class="tag ' + (['Dikirim', 'Selesai', 'Retur diperiksa'].includes(s) ? 'good' : s.startsWith('Retur') || s.includes('retur') ? 'warn' : s === 'Dibatalkan' ? 'neutral' : '') + '">' + esc(s) + '</span>';

async function api(path, body, submission) {
  const isForm = body instanceof FormData;
  const headers = isForm ? {} : { 'Content-Type': 'application/json' };
  if (submission) headers['X-K2C-Submission'] = submission;
  const response = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST',
    headers,
    body: isForm ? body : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function notify(message) {
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 3500);
}

function chooseRole(message = '') {
  state = undefined;
  if (dialog.open) dialog.close();
  app.innerHTML = '<div class="login-shell"><aside class="login-brand">' + brand + '<h1>Operasional<br>toko K2C</h1></aside><main class="login-main"><section class="role-picker"><h2>Pilih peran</h2>' +
    '<p class="error" role="alert">' + esc(message) + '</p><div class="grid">' +
    button('Admin', 'select-role', 'admin', 'primary') + button('Teknisi', 'select-role', 'teknisi') +
    '</div></section></main></div>';
}

async function refresh() {
  state = await api('state');
  render();
}

function table(columns, rows, empty, className = '', numberFrom) {
  if (!rows.length) return '<p class="empty">' + esc(empty) + '</p>';
  if (numberFrom !== undefined) {
    columns = ['No.', ...columns];
    rows = rows.map((row, index) => [numberFrom + index, ...row]);
    className += ' numbered-table';
  }
  return '<div class="table-wrap ' + className + '"><table><thead><tr>' + columns.map(s => '<th scope="col">' + esc(s) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((cell, i) =>
      '<td><span class="mobile-label" aria-hidden="true">' + esc(columns[i]) + '</span><div class="cell-value">' + cell + '</div></td>'
    ).join('') + '</tr>').join('') + '</tbody></table></div>';
}

function salesTable(rows, online, empty = 'Belum ada transaksi.', numberFrom) {
  const columns = [online ? 'Pesanan' : 'Transaksi', 'Barang'];
  if (online) columns.push('Status');
  if (can('admin')) columns.push('Total');
  columns.push('Aksi');
  return table(columns, rows.map(s => {
    const first = online ? '<strong>' + esc(s.order) + '</strong><small>' + marketBadge(s.channel) + (s.tracking ? ' ' + esc(s.tracking) : '') + '</small>' : esc(date(s.at));
    const goods = esc(label(s.items[0])) + '<small>' + esc(s.items[0].qty) + ' unit' + (s.items.length > 1 ? ' · +' + (s.items.length - 1) + ' baris' : '') + '</small>';
    const row = [first + '<small>' + esc(s.buyer || 'Pembeli umum') + '</small>', goods];
    if (online) row.push(stage(s.status));
    if (can('admin')) row.push('<span class="sale-total">' + fmt(total(s)) + '</span>');
    row.push(button('Buka', 'sale-detail', s.id));
    return row;
  }), empty, 'sales-list' + (online ? ' has-status' : '') + (can('admin') ? ' has-total' : ''), numberFrom);
}

const panel = (title, content) => '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2></div>' + content + '</section>';
const search = placeholder => '<input type="search" id="search" aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '" value="' + esc(query) + '">';
const matches = (...terms) => terms.some(term => String(term ?? '').toLowerCase().includes(query.toLowerCase().trim()));

const stockRanges = [
  ['stock', 'Jumlah tersedia', p => p.stock - p.reserved],
  ['reserved', 'Jumlah dipesan', p => p.reserved],
  ['retail', 'Harga toko', p => p.retail],
  ['market', 'Harga marketplace', p => p.market],
];
const stockFilters = {};
const stockStatus = p => p.stock <= p.reserved ? 'Habis' : p.stock - p.reserved <= 3 ? 'Menipis' : 'Tersedia';
const stockSorts = {
  name: (a, b) => label(a).localeCompare(label(b), 'id', { numeric: true }),
  stock: (a, b) => (a.stock - a.reserved) - (b.stock - b.reserved),
  reserved: (a, b) => a.reserved - b.reserved,
  retail: (a, b) => a.retail - b.retail,
  market: (a, b) => a.market - b.market,
};
function filteredStock() {
  const f = stockFilters[view] || {};
  const rows = activeProducts().filter(p => {
    const haystack = [label(p), p.category, stockStatus(p)].join(' ').toLowerCase();
    const terms = query.toLowerCase().trim().split(/\s+/);
    return terms.every(term => haystack.includes(term)) &&
      (view !== 'low' || stockStatus(p) !== 'Tersedia') &&
      (!f.name || f.name === p.name) && (!f.variant || f.variant === p.variant) &&
      (!f.category || f.category === p.category) && (!f.stockStatus || f.stockStatus === stockStatus(p)) &&
      stockRanges.every(([key, , value]) => (!f[key + 'Min'] || value(p) >= Number(f[key + 'Min'])) &&
        (!f[key + 'Max'] || value(p) <= Number(f[key + 'Max'])));
  });
  const [sort, direction] = (f.sort || (view === 'low' ? 'stock:asc' : 'name:asc')).split(':');
  return rows.sort((a, b) => (direction === 'desc' ? -1 : 1) * (stockSorts[sort] || stockSorts.name)(a, b) || stockSorts.name(a, b));
}

function stockTools(placeholder) {
  const f = stockFilters[view] || {};
  const choices = key => [...new Set(activeProducts().map(p => p[key]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id', { numeric: true })).map(value => [value, value]);
  const pick = (key, title, items, all) => select(key, title, [['', all], ...items], f[key] || '');
  const statuses = view === 'low' ? ['Menipis', 'Habis'] : ['Tersedia', 'Menipis', 'Habis'];
  const sorts = [['name:asc', 'Nama A?Z'], ['name:desc', 'Nama Z?A'],
    ...stockRanges.flatMap(([key, title]) => [[key + ':asc', title + ' terendah'], [key + ':desc', title + ' tertinggi']])];
  const ranges = stockRanges.map(([key, title]) => '<fieldset><legend>' + esc(title) + '</legend><div class="grid">' +
    amount(key + 'Min', 'Min', f[key + 'Min'] || '', 0, false) + amount(key + 'Max', 'Maks', f[key + 'Max'] || '', 0, false) + '</div></fieldset>').join('');
  return '<div class="stock-filters"><div class="stock-filter-main">' +
    '<label>Pencarian' + search(placeholder) + '</label>' +
    pick('category', 'Kategori', choices('category'), 'Semua kategori') +
    pick('stockStatus', 'Status stok', statuses.map(value => [value, value]), 'Semua status') +
    select('sort', 'Urutkan', sorts, f.sort || (view === 'low' ? 'stock:asc' : 'name:asc')) +
    button('Reset filter', 'stock-reset') + '</div>' +
    '<details class="stock-filter-extra"' + (Object.keys(f).some(key => /Min$|Max$|^name$|^variant$/.test(key) && f[key]) ? ' open' : '') +
    '><summary>Filter lanjutan</summary><div class="stock-filter-grid">' +
    pick('name', 'Nama barang', choices('name'), 'Semua nama') +
    pick('variant', 'Varian', choices('variant'), 'Semua varian') + ranges + '</div></details></div>';
}

function paginate(items) {
  const pages = Math.max(1, Math.ceil(items.length / listPageSize));
  listPage = Math.max(1, Math.min(listPage, pages));
  const start = (listPage - 1) * listPageSize;
  return { items: items.slice(start, start + listPageSize), total: items.length, start, pages };
}

function listPagination(page) {
  if (!page.total) return '';
  const control = (title, direction, disabled) => '<button type="button" class="button" data-action="list-page" data-key="' + direction + '"' + (disabled ? ' disabled' : '') + '>' + title + '</button>';
  return '<nav class="list-pagination" aria-label="Halaman tabel"><span role="status">Menampilkan ' + (page.start + 1) +
    '&ndash;' + (page.start + page.items.length) + ' dari ' + page.total + '</span>' + (page.pages > 1 ?
      '<div class="list-pagination-controls">' + control('Sebelumnya', -1, listPage === 1) +
        '<span>Halaman ' + listPage + ' dari ' + page.pages + '</span>' +
        control('Berikutnya', 1, listPage === page.pages) + '</div>' : '') + '</nav>';
}

function pageRows() {
  if (can('teknisi')) return technicianOrders();
  if (view === 'online' || view === 'shop') {
    const online = view === 'online';
    const sales = state.sales.filter(s => (online ? s.channel === marketplace : s.channel === 'Toko') && (!filter || s.status === filter) &&
      matches(s.order, s.tracking, s.channel, s.buyer, ...s.items.map(label)));
    if (!online) return salesTable(sales, false);
    const page = paginate(sales);
    return salesTable(page.items, true, undefined, page.start + 1) + listPagination(page);
  }
  if (view === 'stock' || view === 'low') {
    const columns = ['Nama barang', 'Varian', 'Tersedia', 'Dipesan', 'Harga toko', 'Harga marketplace', 'Status', 'Aksi'];
    const page = paginate(filteredStock());
    const rows = page.items.map(p => [
      '<strong>' + esc(p.name) + '</strong><small>' + esc(p.category) + '</small>',
      esc(p.variant || '—'),
      '<strong>' + (p.stock - p.reserved) + '</strong>' + (p.inspection ? '<small>' + p.inspection + ' retur dicek</small>' : ''),
      p.reserved,
      fmt(p.retail),
      fmt(p.market),
      p.stock <= p.reserved ? '<span class="tag stock-empty">Habis</span>' : p.stock - p.reserved <= 3 ? '<span class="tag warn">Menipis</span>' : '<span class="tag good">Tersedia</span>',
      '<div class="row">' + button('Edit', 'product', p.id) + button('Komponen', 'recipe', p.id) + '</div>' + (p.recipe?.length ? '<small>Bisa dirakit: ' + Math.max(0, Math.min(...p.recipe.map(line => { const part = byId(state.products, line.product); return part ? Math.floor((part.stock - part.reserved) / line.qty) : 0; }))) + ' paket</small>' : ''),
    ]);
    return table(columns, rows, 'Belum ada barang yang sesuai.', 'stock-sheet', page.start + 1) + listPagination(page);
  }
  if (view === 'suppliers') return table(['Supplier', 'WhatsApp', 'Pembelian', 'Aksi'], (state.suppliers || []).filter(s => matches(s.name, s.phone)).map(s => [
    '<strong>' + esc(s.name) + '</strong>', '+' + esc(s.phone),
    state.purchases.filter(purchase => purchase.supplierId === s.id).length,
    '<div class="row">' + button('Riwayat', 'supplier-history', s.id) + button('Edit', 'supplier', s.id) + '</div>',
  ]), 'Belum ada supplier.');
  return table(['Barang', 'Jumlah', 'Total', 'Aksi'], state.purchases.filter(p => matches(p.supplier, ...purchaseItems(p).map(purchaseItemLabel))).map(p => [
    '<strong>' + esc(purchaseItemLabel(purchaseItems(p)[0])) + '</strong><small>' +
      (purchaseItems(p).length > 1 ? '+' + (purchaseItems(p).length - 1) + ' baris barang · ' : '') + esc(p.supplier + ' · ' + date(p.at)) + '</small>',
    purchaseItems(p).reduce((sum, item) => sum + item.qty, 0) + ' unit', fmt(purchaseTotal(p)),
    button('Detail', 'purchase-detail', p.id),
  ]), 'Belum ada pembelian.');
}

function technicianOrders() {
  const rows = state.sales.filter(sale => sale.channel === view && matches(sale.order, sale.tracking, sale.buyer, ...sale.items.map(label)));
  function cards(sales, action) {
    return '<div class="tech-cards">' + sales.map(sale => '<article class="tech-order"' + marketTheme(sale.channel) + '>' +
      '<div class="tech-order-head"><strong>' + esc(sale.order) + '</strong><small>' + esc(sale.buyer) + '</small></div>' +
      (sale.status === 'Dikirim' ? '<div>' + stage(sale.status) + '</div>' : '') +
      '<ul>' + sale.items.map(item => '<li>' + esc(label(item)) + ' × ' + item.qty + '</li>').join('') + '</ul>' +
      (sale.tracking ? '<small class="muted">Resi ' + esc(sale.tracking) + '</small>' : '') +
      button(action || (sale.status === 'Dikirim' ? 'Lihat pesanan / retur' : 'Lihat pesanan'), 'sale-detail', sale.id, action ? 'primary' : '') + '</article>').join('') + '</div>';
  }
  const groups = technicianStages.map(([status, title, action]) => {
    const sales = rows.filter(sale => sale.status === status);
    return sales.length ? '<section class="tech-group"><h2>' + title + ' <span>' + sales.length + '</span></h2>' + cards(sales, action) + '</section>' : '';
  }).join('');
  const history = rows.filter(sale => !technicianStages.some(([status]) => status === sale.status));
  return (groups || '<p class="tech-empty">' + (query ? 'Tidak ada pesanan aktif yang cocok.' : 'Belum ada pesanan yang perlu ditangani.') + '</p>') +
    (history.length ? '<details class="tech-history"' + (query ? ' open' : '') + '><summary>Riwayat pesanan (' + history.length + ')</summary>' + cards(history) + '</details>' : '');
}

function renderTechnician() {
  if (!marketplaces.includes(view)) view = 'Shopee';
  const pending = channel => state.sales.filter(sale => sale.channel === channel && technicianStages.some(([status]) => sale.status === status)).length;
  app.innerHTML = '<main class="tech-shell"><header class="tech-header">' + brand +
    button('Ganti peran', 'logout', '', 'dark-button') + '</header>' +
    '<nav class="tech-tabs" aria-label="Marketplace">' + marketplaces.map(channel =>
      '<button type="button"' + marketTheme(channel) + ' data-action="navigate" data-key="' + channel + '"' + (view === channel ? ' aria-current="page"' : '') +
      '><strong>' + channel + '</strong><span>' + pending(channel) + ' perlu ditangani</span></button>').join('') +
    '</nav><div class="tech-content page-scroll"><div class="tech-title"><h1>Pesanan ' + view + '</h1>' + button('Muat ulang', 'reload') + '</div>' +
    search('Cari nomor pesanan atau resi') + '<div id="rows">' + technicianOrders() + '</div></div></main>';
}

function dashboard(online) {
  const available = product => Math.max(0, product.stock - product.reserved);
  const low = activeProducts().filter(product => available(product) <= 3)
    .sort((a, b) => available(a) - available(b) || label(a).localeCompare(label(b), 'id'));
  const units = activeProducts().reduce((sum, product) => sum + available(product), 0);
  const channels = ['Toko', ...marketplaces, ...new Set(online.map(sale => sale.channel).filter(channel => !marketplaces.includes(channel)))];
  const inventory = panel('Stok barang', table(['Indikator', 'Jumlah'], [
    ['Varian tercatat', activeProducts().length],
    ['Unit tersedia', units],
    ['Unit dipesan', activeProducts().reduce((sum, product) => sum + product.reserved, 0)],
    ['Varian stok menipis (1–3 unit)', low.filter(product => available(product) > 0).length],
    ['Varian stok habis', low.filter(product => !available(product)).length],
  ], '', 'summary-table'));
  const sales = panel('Penjualan & pesanan per kanal · semua tanggal', table(['Kanal', 'Transaksi', 'Total transaksi'], channels.map(channel => {
    const records = state.sales.filter(sale => sale.channel === channel && sale.status !== 'Dibatalkan');
    return [channel === 'Toko' ? 'Toko' : marketBadge(channel), records.length, fmt(records.reduce((sum, sale) => sum + total(sale), 0))];
  }), '', 'summary-table'));
  const stock = panel('Stok siap jual menipis dan habis', table(['Barang / Varian', 'Tersedia', 'Dipesan', 'Aksi'], low.map(product => [
    esc(label(product)), available(product) || '<span class="tag warn">Habis</span>', product.reserved,
    button('Lihat stok', 'stock-find', product.id),
  ]), 'Semua varian punya lebih dari 3 unit tersedia.', 'summary-table'));
  const queue = panel('Antrean marketplace', table(['Tahap', 'Pesanan', 'Aksi'], technicianStages.map(([status, title]) => [
    esc(title), online.filter(sale => sale.status === status).length, button('Lihat', 'queue', status),
  ]), '', 'summary-table'));
  return '<div class="summary-grid">' + inventory + sales + '</div>' + queue + stock;
}

function financeView() {
  const [from, through] = reportRange(financeDate, financePeriod);
  const report = financialReport(state, from, through, financeChannel);
  const grossProfit = report.net - report.cogs;
  const periodLabel = day => new Date(day + 'T00:00:00Z').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  const channels = ['Toko', ...marketplaces, ...new Set(state.sales.map(sale => sale.channel)
    .filter(channel => channel !== 'Toko' && !marketplaces.includes(channel)))];
  const controls = '<div class="finance-filters">' +
    select('financePeriod', 'Periode', [['day', 'Harian'], ['week', 'Mingguan'], ['month', 'Bulanan']], financePeriod) +
    field('financeDate', 'Tanggal acuan', financeDate, 'date', 'required') +
    select('financeChannel', 'Kanal', [['', 'Semua kanal'], ...channels.map(channel => [channel, channel])], financeChannel) + '</div>';
  const summary = [['Penjualan toko + dana cair marketplace', report.net], ['HPP setelah koreksi stok retur', report.cogs],
    ['Laba kotor', grossProfit]];
  if (!financeChannel) summary.push(['Biaya operasional tercatat', report.operating], ['Laba / rugi bersih tercatat', grossProfit - report.operating]);
  return '<section class="panel">' + controls + '<div class="finance-note"><strong>' + esc(periodLabel(from)) +
    (from === through ? '' : ' ? ' + esc(periodLabel(through))) +
    '</strong> ? WIB<p>Penjualan toko mengikuti tanggal transaksi. Marketplace mengikuti tanggal pencatatan dana cair. Potongan sudah termasuk dalam dana cair bersih.</p>' +
    (report.incomplete ? '<p class="tag warn">' + report.incomplete + ' pesanan punya modal kosong atau nol. Laba masih perkiraan.</p>' : '') +
    '</div>' + table(['Laba / Rugi', 'Nominal'], summary.map(([name, value]) => [esc(name), '<strong>' + fmt(value) + '</strong>']), '', 'summary-table') +
    '<div class="finance-note"><p>Potongan marketplace: ' + fmt(report.fee) + ' ? Pesanan periode ini tanpa dana cair: ' + report.pending + '</p>' +
    (financeChannel ? '<p>Biaya umum tersedia di Semua kanal.</p>' : '<p>Pembelian stok: ' + fmt(report.purchases) + ' (dicatat sebagai persediaan; HPP dihitung saat penjualan).</p>') +
    '</div></section>' +
    panel('Rincian penjualan dan retur', table(['Tanggal', 'Kanal', 'Transaksi', 'Dana bersih', 'HPP', 'Laba kotor', 'Aksi'],
      report.rows.map(row => [esc(periodLabel(row.day)), row.sale.channel === 'Toko' ? 'Toko' : marketBadge(row.sale.channel),
        esc(row.sale.order || row.sale.buyer || 'Penjualan toko') + '<small>' + esc(row.kind) + '</small>',
        fmt(row.net), fmt(row.cogs), fmt(row.net - row.cogs), button('Buka', 'sale-detail', row.sale.id)]),
      'Belum ada penjualan atau koreksi retur yang diakui di periode ini.', 'summary-table')) +
    (financeChannel ? '' : panel('Biaya operasional', table(['Tanggal', 'Keterangan', 'Nominal', 'Aksi'],
      report.expenses.map(expense => [esc(periodLabel(expense.day)), esc(expense.name), fmt(expense.amount),
        button('Edit', 'expense', expense.id)]), 'Belum ada biaya operasional tercatat.', 'summary-table')));
}

function render() {
  if (can('teknisi')) return renderTechnician();
  const admin = can('admin');
  const nav = Object.entries(menus).filter(([key]) => admin || !['shop', 'buy'].includes(key));
  if (!nav.some(([key]) => key === view)) view = 'home';
  const online = state.sales.filter(s => s.channel !== 'Toko');
  let content;
  let marketNav = '';
  let action = '';
  if (view === 'home') {
    action = button('Input pesanan', 'sale-new', 'online', 'primary');
    content = dashboard(online);
  } else if (view === 'finance') {
    action = button('Catat biaya', 'expense', '', 'primary');
    content = financeView();
  } else {
    const titles = { online: ['Input pesanan', 'sale-new'], shop: ['Transaksi baru', 'sale-new'], stock: ['Tambah barang', 'product'], buy: ['Catat pembelian', 'purchase'], suppliers: ['Tambah supplier', 'supplier'] };
    if (admin && titles[view] && (view !== 'online' || marketplaces.includes(marketplace))) action = view === 'online' ? button('Input pesanan ' + marketplace, 'sale-new', marketplace, 'primary') : button(...titles[view], '', 'primary');
    const placeholders = { online: 'Cari resi, nomor pesanan, atau pembeli', shop: 'Cari pembeli atau barang', stock: 'Cari barang atau varian', low: 'Cari stok menipis atau habis', buy: 'Cari supplier atau barang', suppliers: 'Cari nama atau nomor WhatsApp' };
    const statusFilter = view === 'online' ? '<div>' + select('status', 'Status', [['', 'Semua status'], ...statuses.map(s => [s, s])], filter) + '</div>' : '';
    content = '<section class="panel"><div class="toolbar' + (view === 'online' ? ' market-toolbar' : '') + '">' + search(placeholders[view]) + statusFilter + '</div><div id="rows">' + pageRows() + '</div></section>';
    if (['stock', 'low'].includes(view)) content = '<section class="panel">' + stockTools(placeholders[view]) + '<div id="rows">' + pageRows() + '</div></section>';
    if (view === 'online') {
      const channels = [...marketplaces, ...new Set(online.map(sale => sale.channel).filter(channel => !marketplaces.includes(channel)))];
      marketNav = '<div class="market-nav"><nav class="market-tabs" aria-label="Pilih marketplace">' + channels.map(channel =>
        '<button type="button" class="market-tab"' + marketTheme(channel) + ' data-action="market-channel" data-key="' + esc(channel) + '"' +
        (channel === marketplace ? ' aria-current="page"' : '') + '><strong>' + esc(channel) + '</strong><span>' +
        online.filter(sale => sale.channel === channel).length + ' pesanan</span></button>'
      ).join('') + '</nav></div>';
    }
    if (view === 'stock' && admin && state.movements.length) content += '<details class="panel stock-history"><summary>Riwayat stok</summary>' + table(['Barang', 'Jumlah', 'Alasan', 'Petugas', 'Waktu'], state.movements.slice(0, 20).map(m => [
      esc(label(byId(state.products, m.product))), (m.qty > 0 ? '+' : '') + m.qty, esc(m.reason), esc(m.actor), esc(date(m.at)),
    ]), 'Belum ada pergerakan stok.') + '</details>';
  }
  app.innerHTML = '<div class="shell excel-admin"><aside class="sidebar">' + brand + '<nav aria-label="Navigasi utama">' +
    nav.map(([key, title]) => '<button class="nav-button" data-action="navigate" data-key="' + key + '"' + (key === view ? ' aria-current="page"' : '') + '>' + title + '</button>').join('') +
    '</nav><div class="account"><strong>' + esc(state.user.name) + '</strong>' + button('Ganti peran', 'logout', '', 'dark-button') +
    '</div></aside><main><div class="topbar"><span>' + esc(new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date())) + '</span>' +
    button('Muat ulang', 'reload') + '</div>' + marketNav + '<div class="page-scroll"><div class="content"><header class="page-header"><h1>' + menus[view] + '</h1>' + action + '</header>' + content + '</div></div></main></div>';
}

function open(title, body) {
  releaseCamera?.();
  dialog.classList.toggle('excel-dialog', can('admin'));
  dialog.innerHTML = '<header class="dialog-head"><h2 id="dialog-title">' + esc(title) + '</h2>' + button('Tutup', 'close') +
    '</header><div class="dialog-body">' + body + '</div>';
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function form(title, action, body, id = '', submit = 'Simpan') {
  open(title, '<form data-submit="' + action + '" data-id="' + esc(id) + '">' + body +
    '<p class="error" role="alert"></p><div class="actions">' + (id && !['product', 'supplier', 'recipe', 'build-stock', 'expense'].includes(action) ? button('Kembali', action === 'product-delete' ? 'product' : ['receive', 'purchase-delete'].includes(action) ? 'purchase-detail' : 'sale-detail', id) : '') +
    '<button class="button primary">' + esc(submit) + '</button></div></form>');
}

function recordTest(id) {
  form('Rekam video tes', 'ready', '<div class="camera"><video playsinline hidden aria-label="Pratinjau video tes"></video>' +
    '<p class="muted" role="status">Buka kamera untuk merekam video MP4.</p><div class="row">' +
    '<button type="button" class="button" data-camera>Buka kamera</button></div></div>', id, 'Simpan & tandai siap kirim');
  const formElement = dialog.querySelector('form');
  const video = formElement.querySelector('video');
  const status = formElement.querySelector('[role=status]');
  const control = formElement.querySelector('[data-camera]');
  const save = formElement.querySelector('button:not([type=button])');
  let stream;
  let recorder;
  let preview;
  let closed = false;
  let mode = 'open';
  const maxSize = state.uploadLimit || 118 * 1024 ** 2;
  const recordingLimit = state.cloudUploads ? maxSize - 3 * 1024 ** 2 : 105 * 1024 ** 2;
  save.disabled = true;

  function stopCamera() {
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    video.srcObject = null;
  }

  function resetPreview() {
    video.removeAttribute('src');
    video.controls = false;
    video.hidden = true;
    if (preview) URL.revokeObjectURL(preview);
    preview = undefined;
    delete formElement.recordedVideo;
    delete formElement.dataset.submission;
    delete formElement.cloudTicket;
  }

  function setMode(next, title, message) {
    mode = next;
    control.textContent = title;
    control.disabled = false;
    status.textContent = message;
  }

  releaseCamera = () => {
    closed = true;
    if (recorder?.state === 'recording') recorder.stop();
    stopCamera();
    resetPreview();
    releaseCamera = undefined;
  };

  control.addEventListener('click', async () => {
    try {
      if (mode === 'recording') {
        control.disabled = true;
        recorder.stop();
        return;
      }
      if (mode === 'open') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera memerlukan localhost atau alamat HTTPS.');
        const mimeType = ['video/mp4;codecs=avc1.42001f', 'video/mp4'].find(type => globalThis.MediaRecorder?.isTypeSupported(type));
        if (!mimeType) throw new Error('Browser ini belum bisa merekam MP4. Buka aplikasi di browser yang mendukung rekaman MP4.');
        control.disabled = true;
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (closed) {
          camera.getTracks().forEach(track => track.stop());
          return;
        }
        stream = camera;
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
        resetPreview();
        save.disabled = true;
        video.hidden = false;
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        if (!closed) setMode('start', 'Mulai rekam', 'Kamera siap.');
        return;
      }
      const chunks = [];
      let size = 0;
      let failed = false;
      recorder.ondataavailable = event => {
        if (!event.data.size || closed || failed) return;
        chunks.push(event.data);
        size += event.data.size;
        if (size >= recordingLimit && recorder.state === 'recording') {
          control.disabled = true;
          recorder.stop();
        }
      };
      recorder.onerror = () => {
        failed = true;
        if (closed) return;
        stopCamera();
        video.hidden = true;
        setMode('open', 'Buka kamera', 'Perekaman gagal. Silakan coba lagi.');
      };
      recorder.onstop = () => {
        if (closed || failed) return;
        stopCamera();
        if (!size || size >= maxSize || recorder.mimeType.split(';')[0].toLowerCase() !== 'video/mp4') {
          video.hidden = true;
          setMode('open', 'Buka kamera', 'Video MP4 tidak bisa disimpan. Coba rekam ulang dengan durasi lebih pendek.');
          return;
        }
        const file = new File(chunks, 'video-tes.mp4', { type: 'video/mp4' });
        formElement.recordedVideo = file;
        preview = URL.createObjectURL(file);
        video.src = preview;
        video.controls = true;
        save.disabled = false;
        setMode('open', 'Rekam ulang', size >= recordingLimit ? 'Rekaman berhenti karena mencapai batas ukuran. Periksa hasil sebelum menyimpan.' : 'Periksa hasil rekaman sebelum menyimpan.');
      };
      recorder.start(1000);
      setMode('recording', 'Hentikan rekaman', 'Sedang merekam…');
    } catch (error) {
      if (closed) return;
      stopCamera();
      if (!preview) video.hidden = true;
      setMode('open', preview ? 'Rekam ulang' : 'Buka kamera', error.name === 'NotAllowedError' ? 'Izinkan akses kamera di browser, lalu coba lagi.' :
        error.name === 'NotFoundError' ? 'Kamera tidak ditemukan.' : error.message);
    }
  });
}

const categories = ['Laptop', 'PC rakitan', 'PC built-up', 'Monitor', 'Spare part', 'Aksesori', 'Lainnya'];

const customCategory = '__new_category__';

function categoryField(name, current) {
  const choices = [...new Set([...categories, ...state.products.map(product => product.category).filter(Boolean)])];
  return '<div class="category-field">' + select(name, 'Kategori', [
    ...choices.map(category => [category, category]), [customCategory, '+ Buat kategori baru'],
  ], current) + '<label class="category-name" hidden>Nama kategori baru<input type="text" name="' +
    name + 'Custom" maxlength="80" required disabled></label></div>';
}

function categoryValue(container, name) {
  const selected = container.querySelector('[name=' + name + ']').value;
  return selected === customCategory ? container.querySelector('[name=' + name + 'Custom]').value.trim() : selected;
}

const customProductName = '__new_product_name__';

function productNameChoices() {
  const names = new Map();
  for (const product of activeProducts()) {
    const key = product.name.trim().toLowerCase();
    if (!names.has(key)) names.set(key, product.name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'id'));
}

function productNameField(name) {
  const choices = productNameChoices();
  const create = !choices.length;
  return '<div class="category-field">' + select(name, 'Nama barang', [
    ['', 'Pilih nama barang'], ...choices.map(value => [value, value]), [customProductName, '+ Buat nama barang baru'],
  ], create ? customProductName : '') + '<label class="product-name-input"' + (create ? '' : ' hidden') +
    '>Nama barang baru<input type="text" name="' + name + 'Custom" autocomplete="off" required' +
    (create ? '' : ' disabled') + '></label></div>';
}

function productNameValue(container, name) {
  const selected = container.querySelector('[name=' + name + ']').value;
  return selected === customProductName ? container.querySelector('[name=' + name + 'Custom]').value.trim() : selected;
}

function transactionProductSelect() {
  return select('product', 'Barang / Varian', [...options(), ['new', '+ Buat produk baru']], activeProducts().length ? '' : 'new');
}

function transactionProduct(sale = false) {
  return transactionProductSelect() + newProductFields(sale);
}

function newProductFields(sale) {
  return '<fieldset class="new-product"' + (activeProducts().length ? ' hidden disabled' : '') + '><legend>Produk baru</legend>' +
    '<div class="grid">' + productNameField('newName') + field('newVariant', 'Varian') +
    categoryField('newCategory') +
    (sale ? amount('newStock', 'Stok fisik sebelum dijual', '', 1) + amount('newCost', 'Modal per unit (opsional)', '', 0, false) :
      '') +
    '</div></fieldset>';
}

function newProductFrom(container) {
  const fieldset = container.querySelector('.new-product');
  if (!fieldset || fieldset.disabled) return undefined;
  const value = name => fieldset.querySelector('[name=' + name + ']')?.value;
  return { name: productNameValue(fieldset, 'newName'), variant: value('newVariant'), category: categoryValue(fieldset, 'newCategory'),
    initialStock: value('newStock'), initialCost: value('newCost') };
}

function purchaseLine() {
  return '<tbody class="purchase-item"><tr class="purchase-entry"><td>' + transactionProductSelect() + '</td><td>' +
    amount('qty', 'Jumlah', 1, 1) + '</td><td>' + amount('cost', 'Harga beli per unit') +
    '</td><td class="purchase-subtotal">—</td><td>' + button('Hapus', 'line-remove') +
    '</td></tr><tr class="purchase-new"' + (activeProducts().length ? ' hidden' : '') +
    '><td colspan="5">' + newProductFields(false) + '</td></tr></tbody>';
}

function recipeLine(id, line = {}) {
  const options = [['', 'Pilih komponen'], ...activeProducts().filter(p => p.id !== id && !p.recipe?.length).map(p => [p.id, label(p)])];
  return '<div class="recipe-line">' + select('component', 'Barang / Varian', options, line.product) +
    amount('componentQty', 'Jumlah per paket', line.qty ?? 1, 1) + button('Hapus', 'recipe-remove') + '</div>';
}

function line() {
  return '<div class="line-item">' + transactionProduct(true) + '<div class="grid">' +
    amount('qty', 'Jumlah', 1, 1) + amount('price', 'Harga jual per unit') + '</div>' +
    '<label class="check ready-stock" hidden><input name="readyStock" type="checkbox">Ambil dari stok paket siap jual</label>' +
    '<label class="check assembly" hidden><input name="assemble" type="checkbox">Rakit untuk pesanan ini</label>' +
    '<div>' + button('Hapus baris', 'line-remove') + '</div></div>';
}

function saleDetail(id) {
  const s = byId(state.sales, id);
  const admin = can('admin');
  const online = s.channel !== 'Toko';
  const actions = [];
  if (online && s.status === 'Pesanan masuk') actions.push(button('Unggah video QC', 'ready-upload', id, 'primary'), button('Rekam video QC', 'ready', id));
  if (online && s.status === 'Pesanan masuk') actions.push(button('Lewati QC & catat pengiriman', 'ship', id));
  if (online && ['Pesanan masuk', 'Siap kirim'].includes(s.status)) actions.push(button('Barang sudah dikirim', 'ship-direct', id));
  if (s.status === 'Siap kirim') actions.push(button('Catat serah terima', 'ship', id, 'primary'));
  if (admin && s.status === 'Dikirim') actions.push(button('Kembali ke tahap sebelumnya', 'undo-ship', id));
  if (s.status === 'Dikirim') actions.push(button('Paket kembali', 'return-start', id));
  if (s.status === 'Retur diterima') actions.push(button('Unggah bukti retur', 'return-evidence', id, 'primary'));
  if (can('teknisi') && s.status === 'Bukti retur lengkap') actions.push(button('Catat hasil pemeriksaan', 'return-result', id, 'primary'));
  if (admin && ['Dikirim', 'Retur diterima', 'Bukti retur lengkap', 'Retur diperiksa'].includes(s.status)) actions.push(button('Catat dana cair', 'settlement', id));
  if (admin && ['Pesanan masuk', 'Siap kirim'].includes(s.status)) actions.push(button('Batalkan pesanan', 'cancel', id));
  const items = s.items.map((item, i) => '<li><strong>' + esc(label(item)) + '</strong> × ' + item.qty +
    (admin ? ' · ' + fmt(item.price) : '') + (item.components ? '<small class="cell-sub">Komponen paket</small><ul class="detail-list">' +
      item.components.map((part, index) => '<li><div class="row">' + esc(label(byId(state.products, part.product))) + ' × ' + part.qty + (s.status === 'Pesanan masuk' ? button('Ganti', 'component-swap', id + ':' + i + ':' + index) : '') + '</div></li>').join('') + '</ul>' : '') + (item.parts ? '<small class="cell-sub">Rakitan pesanan' +
      (item.parts.length ? ' · ' + item.parts.map(part => esc(label(byId(state.products, part.product))) + ' × ' + part.qty).join(', ') : '') +
      '</small>' + (can('admin', 'teknisi') && s.status === 'Pesanan masuk' ? button('Catat komponen', 'parts', id + ':' + i) : '') : '') + '</li>');
  const evidenceLabels = { ready: 'Video tes', ship: 'Foto serah terima', 'return-evidence': 'Bukti retur' };
  const proofs = s.evidence.map(f => '<li><a href="/api/evidence/' + esc(f.id) + '" download>' + esc(evidenceLabels[f.stage] + ' · ' + f.name) + '</a><small class="cell-sub">' + esc(f.actor + ' · ' + date(f.at)) + '</small></li>');
  const history = s.history.map(h => '<li>' + esc([h.status, h.skipQc && 'QC tanpa video', h.skipHandover && 'Tanpa foto serah terima', h.note, h.actor, date(h.at)].filter(Boolean).join(' · ')) + '</li>');
  const summary = admin ? '<p>Total jual <strong>' + fmt(total(s)) + '</strong> · Modal barang <strong>' + fmt(modalCost(s)) + '</strong></p>' : '';
  const settlement = admin && s.settlement ? '<p>Dana cair <strong>' + fmt(s.settlement.payout) + '</strong> · Potongan ' + fmt(s.settlement.fee) +
    (s.returnResult ? '' : ' · Selisih terhadap modal ' + fmt(s.settlement.payout - modalCost(s))) + '</p>' : '';
  open(online ? s.channel + ' · ' + s.order : 'Detail transaksi toko', '<div class="details"><div class="row">' + (online ? marketBadge(s.channel) : '') + stage(s.status) + '<span>' + esc(s.buyer || 'Umum') + '</span></div>' +
    (actions.length ? '<div class="row detail-actions">' + actions.join('') + '</div>' : '') +
    (online ? '<p>Resi ' + esc(s.tracking || 'belum diisi') + '</p>' : '') + '<section><h3>Barang</h3><ul class="detail-list">' + items.join('') + '</ul>' +
    summary + settlement + '</section>' + (s.returnResult ? '<section><h3>Hasil retur</h3><p>' + esc(s.returnResult.note) +
      '</p><ul class="detail-list">' + s.items.map((item, i) => '<li>' + esc(label(item)) + ' · ' + esc(s.returnResult.quantities[i]) + ' siap jual</li>').join('') + '</ul></section>' : '') +
    (online ? '<section><h3>Bukti pesanan</h3>' + (proofs.length ? '<ul class="detail-list">' + proofs.join('') + '</ul>' : '<p class="muted">Belum ada bukti.</p>') + '</section>' : '') +
    '<details class="record-history"><summary>Riwayat status</summary><ul class="detail-list">' + history.join('') + '</ul></details></div>');
}

const purchaseItems = purchase => purchase.items ?? [purchase];
const purchaseItemLabel = item => item.itemLabel || label(byId(state.products, item.product));
const purchaseTotal = purchase => purchaseItems(purchase).reduce((sum, item) => sum + item.qty * item.cost, 0);

function purchaseDetail(id) {
  const purchase = byId(state.purchases, id);
  open('Pembelian · ' + purchase.supplier, '<div class="details">' +
    table(['Barang', 'Jumlah', 'Harga beli', 'Subtotal'], purchaseItems(purchase).map(item => [
      esc(purchaseItemLabel(item)), item.qty, fmt(item.cost), fmt(item.qty * item.cost),
    ]), 'Belum ada barang.') + (purchaseItems(purchase).some(item => item.received < item.qty) ? '<p>Transaksi lama · ' + purchaseItems(purchase).reduce((sum, item) => sum + item.qty - item.received, 0) + ' unit belum tercatat masuk stok.</p>' : '') + '<p><strong>Total ' + fmt(purchaseTotal(purchase)) + '</strong></p><div class="actions">' +
    button('Hapus pembelian', 'purchase-delete', id) + button('Unduh nota PDF', 'purchase-pdf', id, 'primary') + '</div></div>');
}

async function click(action, key, element) {
  if (action === 'select-role') {
    const buttons = Array.from(app.querySelectorAll('[data-action="select-role"]'));
    buttons.forEach(button => { button.disabled = true; });
    try {
      await api('role', { role: key });
      await refresh();
    } catch (error) {
      chooseRole(error.message);
    }
    return;
  }
  if (dialog.open && dialog.querySelector('form[data-saving]')) return;
  if (action === 'close') return dialog.close();
  if (action === 'logout') {
    await api('logout', {});
    view = 'home';
    query = filter = '';
    marketplace = marketplaces[0];
    marketplaceFilters.clear();
    delete stockFilters.stock;
    delete stockFilters.low;
    financeDate = reportDay();
    financePeriod = 'day';
    financeChannel = '';
    return chooseRole();
  }
  if (action === 'reload') return refresh();
  if (action === 'list-page') {
    listPage += Number(key);
    const rows = document.querySelector('#rows');
    rows.innerHTML = pageRows();
    rows.closest('.page-scroll').scrollTop = 0;
    const controls = rows.querySelector('.list-pagination-controls');
    (controls?.querySelector('[data-key="' + key + '"]:enabled') || controls?.querySelector('button:enabled'))?.focus({ preventScroll: true });
    return;
  }
  if (action === 'market-channel') {
    if (marketplace === key) return;
    listPage = 1;
    marketplaceFilters.set(marketplace, { query, filter });
    marketplace = key;
    ({ query = '', filter = '' } = marketplaceFilters.get(key) || {});
    return render();
  }
  if (action === 'stock-reset') {
    delete stockFilters[view];
    listPage = 1;
    query = '';
    return render();
  }
  if (action === 'stock-find') {
    view = 'stock';
    listPage = 1;
    delete stockFilters.stock;
    query = label(byId(state.products, key));
    return render();
  }
  if (action === 'navigate' || action === 'queue') {
    if (view === 'online') marketplaceFilters.set(marketplace, { query, filter });
    view = action === 'queue' ? 'online' : key;
    listPage = 1;
    ({ query = '', filter = '' } = view === 'online' ? marketplaceFilters.get(marketplace) || {} : {});
    if (action === 'queue') {
      const next = state.sales.find(sale => sale.channel !== 'Toko' && sale.status === key);
      if (next) marketplace = next.channel;
      filter = key;
      query = '';
    }
    render();
    return refresh();
  }
  if (action === 'sale-detail') return saleDetail(key);
  if (action === 'purchase-detail') return purchaseDetail(key);
  if (action === 'purchase-pdf') {
    const purchase = byId(state.purchases, key);
    const number = purchase.id.slice(0, 8).toUpperCase();
    const bytes = purchasePdf({
      number, date: date(purchase.at), supplier: purchase.supplier,
      items: purchaseItems(purchase).map(item => ({ name: purchaseItemLabel(item), qty: item.qty, cost: item.cost })),
    });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Nota-Pembelian-' + number + '.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return;
  }
  if (action === 'purchase-delete') {
    return form('Hapus pembelian', action,
      '<p>Nota ini akan dihapus. Jumlah barang yang sudah masuk dari pembelian ini akan dikurangi dari stok.</p>',
      key, 'Hapus pembelian');
  }

  if (action === 'supplier') {
    const supplier = byId(state.suppliers || [], key);
    return form(supplier ? 'Edit supplier' : 'Tambah supplier', action,
      field('name', 'Nama supplier', supplier?.name, 'text', 'required') +
      field('phone', 'Nomor WhatsApp', supplier?.phone, 'tel', 'required placeholder="081234567890"'), key);
  }
  if (action === 'supplier-history') {
    const supplier = byId(state.suppliers || [], key);
    const purchases = state.purchases.filter(purchase => purchase.supplierId === key);
    return open('Pembelian · ' + supplier.name, table(['Barang', 'Jumlah', 'Total', 'Aksi'], purchases.map(purchase => [
      esc(purchaseItems(purchase).map(purchaseItemLabel).join(', ')), purchaseItems(purchase).reduce((sum, item) => sum + item.qty, 0),
      fmt(purchaseTotal(purchase)), button('Lihat nota', 'purchase-detail', purchase.id),
    ]), 'Belum ada pembelian yang terhubung ke supplier ini.'));
  }
  if (action === 'line-add') {
    dialog.querySelector('#lines').insertAdjacentHTML('beforeend', dialog.querySelector('form').dataset.submit === 'purchase' ? purchaseLine() : line());
    dialog.querySelector('#lines').lastElementChild.querySelector('[name=product]').focus();
    return;
  }
  if (action === 'line-remove') {
    const row = element.closest('.line-item, .purchase-item');
    if (row.parentElement.children.length > (row.matches('.purchase-item') ? 2 : 1)) row.remove();
    return;
  }
  if (action === 'sale-new') {
    const online = key === 'online' || view === 'online';
    const channel = view === 'online' && marketplaces.includes(key) ? key : '';
    const channelField = channel ? '<input type="hidden" name="channel" value="' + channel + '">' :
      select('channel', 'Marketplace', marketplaces.map(s => [s, s]));
    const header = online ? '<div class="grid">' + channelField +
      field('order', 'Nomor pesanan', '', 'text', 'required') + field('tracking', 'Nomor resi jika sudah ada') + field('buyer', 'Nama pembeli', '', 'text', 'required') + '</div>' :
      field('buyer', 'Nama pembeli jika ada') + '<input type="hidden" name="channel" value="Toko">';
    return form(online ? 'Input pesanan ' + (channel || 'marketplace') : 'Transaksi toko', 'sale', header + '<div id="lines">' + line() + '</div><div>' + button('Tambah baris', 'line-add') + '</div>');
  }
  if (action === 'recipe' || action === 'build-stock') {
    const product = byId(state.products, key);
    if (action === 'build-stock') return form('Rakit ke stok · ' + label(product), action,
      '<p>Komponen akan keluar dari stok lepas dan paket jadi akan masuk stok siap jual.</p>' +
      amount('qty', 'Jumlah paket', 1, 1), key);
    return form('Komponen · ' + label(product), action,
      '<p>Isi jumlah komponen untuk satu paket, termasuk aksesori dan bonus.</p><div id="recipe-lines">' +
      (product.recipe || []).map(line => recipeLine(product.id, line)).join('') + '</div><div class="row">' +
      button('Tambah komponen', 'recipe-add', key) + (product.recipe?.length ? button('Rakit ke stok', 'build-stock', key) : '') + '</div>', key);
  }
  if (action === 'recipe-add') return dialog.querySelector('#recipe-lines').insertAdjacentHTML('beforeend', recipeLine(key));
  if (action === 'recipe-remove') return element.closest('.recipe-line').remove();
  if (action === 'expense') {
    const expense = byId(state.expenses || [], key);
    return form(expense ? 'Edit biaya operasional' : 'Catat biaya operasional', action,
      field('day', 'Tanggal', expense?.day || financeDate, 'date', 'required') +
      field('name', 'Keterangan biaya', expense?.name, 'text', 'required maxlength="120"') +
      amount('amount', 'Nominal biaya', expense?.amount, 1), key);
  }
  if (action === 'product-delete') {
    const p = byId(state.products, key);
    return form('Hapus barang', action, '<p>Hapus <strong>' + esc(label(p)) + '</strong> dari daftar barang aktif? Riwayat transaksi tetap tersimpan.</p>', key, 'Hapus barang');
  }
  if (action === 'product') {
    const p = byId(state.products, key);
    const canSetInitial = !p || (!p.stock && !p.reserved && !state.movements.some(m => m.product === p.id));
    const initial = canSetInitial ? '<fieldset><legend>Stok awal (opsional)</legend><div class="grid">' +
      amount('initialStock', 'Jumlah yang sudah ada', '', 0, false) + amount('initialCost', 'Modal per unit', '', 0, false) + '</div></fieldset>' : '';
    const nameField = p ? field('name', 'Nama barang', p.name, 'text', 'required autocomplete="off" list="product-name-options"') +
      '<datalist id="product-name-options">' + productNameChoices().map(name => '<option value="' + esc(name) + '"></option>').join('') + '</datalist>' :
      productNameField('name');
    return form(p ? 'Edit barang' : 'Tambah barang', 'product', nameField +
      field('variant', 'Varian', p?.variant) +
      categoryField('category', p?.category) +
      '<div class="grid">' + amount('retail', 'Harga toko', p?.retail) + amount('market', 'Harga marketplace', p?.market) + '</div>' + initial + (p ? '<div>' + button('Hapus barang', 'product-delete', p.id) + '</div>' : ''), key);
  }
  if (action === 'purchase') {
    const suppliers = state.suppliers || [];
    if (!suppliers.length) return form('Tambah supplier untuk pembelian', 'supplier',
      '<input type="hidden" name="continuePurchase" value="yes">' +
      field('name', 'Nama supplier', '', 'text', 'required') +
      field('phone', 'Nomor WhatsApp', '', 'tel', 'required placeholder="081234567890"'), '', 'Simpan & lanjut pembelian');
    return form('Catat pembelian', 'purchase', select('supplier', 'Supplier', [['', 'Pilih supplier'], ...suppliers.map(s => [s.id, s.name])]) +
      '<div class="purchase-sheet"><table id="lines"><thead><tr><th scope="col">Barang / Varian</th><th scope="col">Jumlah</th><th scope="col">Harga beli per unit</th><th scope="col">Subtotal</th><th scope="col">Aksi</th></tr></thead>' + purchaseLine() + '</table></div><div>' + button('Tambah barang', 'line-add') + '</div>');
  }
  if (action === 'component-swap') {
    const [id, index, partIndex] = key.split(':');
    const item = byId(state.sales, id).items[index];
    const part = item.components[partIndex];
    const choices = [['', 'Pilih pengganti'], ...activeProducts().filter(p => p.id !== item.product && p.id !== part.product && !p.recipe?.length).map(p => [p.id, label(p)])];
    return form('Ganti komponen · ' + label(byId(state.products, part.product)), action,
      '<input type="hidden" name="line" value="' + esc(index) + '"><input type="hidden" name="part" value="' + esc(partIndex) + '">' +
      select('product', 'Barang pengganti (' + part.qty + ' unit)', choices), id);
  }
  if (action === 'parts') {
    const [id, index] = key.split(':');
    return form('Pemakaian komponen', 'parts', '<input type="hidden" name="line" value="' + esc(index) + '">' +
      select('product', 'Komponen', options()) + amount('qty', 'Jumlah terpakai', 1, 1), id);
  }
  const s = byId(state.sales, key);
  if (!s) return;
  if (action === 'ready-upload') return form('Unggah video QC', 'ready', proof('Video QC (MP4)', 'video/mp4,.mp4'), key, 'Simpan & tandai siap kirim');
  if (action === 'ready') return recordTest(key);
  if (action === 'ship-direct') {
    if (s.channel === 'Toko' || !['Pesanan masuk', 'Siap kirim'].includes(s.status)) return;
    return form('Barang sudah dikirim', 'ship',
      '<p>Konfirmasi paket sudah diserahkan ke kurir.</p>' +
      (s.status === 'Pesanan masuk' ? '<input type="hidden" name="skipQc" value="yes">' : '') +
      '<input type="hidden" name="skipHandover" value="yes">' +
      field('tracking', 'Nomor resi', s.tracking, 'text', 'required'), key, 'Tandai dikirim');
  }
  if (action === 'ship') {
    const skipQc = s.status === 'Pesanan masuk';
    return form(skipQc ? 'Lewati QC & catat pengiriman' : 'Serah terima paket', action,
      (skipQc ? '<input type="hidden" name="skipQc" value="yes"><p>Pesanan akan ditandai dikirim tanpa video QC. Gunakan jika paket sudah dikirim.</p>' : '') +
      field('tracking', 'Nomor resi', s.tracking, 'text', 'required') +
      '<div class="handover-proof">' + proof('Foto bukti serah terima ke kurir atau gerai', 'image/*') + '</div>' +
      '<label class="check"><input type="checkbox" name="skipHandover" value="yes">Lewati foto serah terima</label>',
      key, 'Simpan & tandai dikirim');
  }
  if (action === 'undo-ship') {
    if (!can('admin') || s.status !== 'Dikirim') return;
    const previous = s.history.at(-2)?.status;
    if (!['Pesanan masuk', 'Siap kirim'].includes(previous)) return open('Koreksi pengiriman', '<p>Tahap sebelum dikirim tidak tercatat.</p>');
    return form('Koreksi pengiriman', action,
      '<input type="hidden" name="shippedAt" value="' + esc(s.history.at(-1).at) + '">' +
      '<p>Konfirmasi paket belum dikirim. Status akan kembali ke <strong>' + esc(previous) +
      '</strong>. Stok yang tercatat keluar akan dikembalikan dan ditahan untuk pesanan ini.</p>',
      key, 'Kembalikan ke ' + previous);
  }
  if (action === 'return-start') return form('Terima paket kembali', action, '<p>Konfirmasi paket sudah diterima. Ambil dua foto paket sebelum dibuka dan rekam video unboxing.</p>', key, 'Tandai retur diterima');
  if (action === 'return-evidence') return form('Bukti paket kembali', action, proof('Foto paket 1', 'image/*') + proof('Foto paket 2', 'image/*') + proof('Video unboxing (MP4)', 'video/mp4,.mp4'), key);
  if (action === 'return-result') return form('Pemeriksaan retur', action, s.items.map(item => amount('quantities', label(item) + (item.components ? ' · Paket lengkap kembali siap jual dari ' : ' · Jumlah siap jual dari ') + item.qty, 0)).join('') +
    '<label>Hasil pemeriksaan<textarea name="note" required rows="3"></textarea></label>', key);
  if (action === 'settlement') return form('Dana cair marketplace', action, amount('fee', 'Potongan marketplace', s.settlement?.fee) + amount('payout', 'Dana yang benar-benar cair', s.settlement?.payout), key);
  if (action === 'cancel') {
    const modes = [['', 'Pilih penanganan'], ['dilepas', 'Bongkar dan kembalikan komponen']];
    if (s.status === 'Siap kirim') modes.push(['disimpan', 'Simpan rakitan sebagai stok siap jual']);
    return form('Batalkan pesanan', action, '<p>Stok barang yang dipesan akan kembali tersedia.</p>' +
      (s.items.some(i => i.parts?.length) ? select('mode', 'Penanganan rakitan', modes) : ''), key, 'Konfirmasi pembatalan');
  }
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  click(el.dataset.action, el.dataset.key, el).catch(error => error.status === 401 ? chooseRole(error.message) : notify(error.message));
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target.name && target.closest('.stock-filters') && target.id !== 'search') {
    if (target.type === 'number' && !target.validity.valid) return;
    (stockFilters[view] ??= {})[target.name] = target.value;
    listPage = 1;
    document.querySelector('#rows').innerHTML = pageRows();
    return;
  }
  const row = target.closest('.purchase-entry');
  if (row && ['qty', 'cost'].includes(event.target.name)) {
    const qty = row.querySelector('[name=qty]');
    const cost = row.querySelector('[name=cost]');
    row.querySelector('.purchase-subtotal').textContent = qty.validity.valid && cost.validity.valid ? fmt(qty.valueAsNumber * cost.valueAsNumber) : '—';
  }
  if (event.target.id !== 'search') return;
  query = event.target.value;
  listPage = 1;
  document.querySelector('#rows').innerHTML = pageRows();
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target.name === 'financeDate' && target.validity.valid && target.value) financeDate = target.value;
  else if (target.name === 'financePeriod') financePeriod = target.value;
  else if (target.name === 'financeChannel') financeChannel = target.value;
  else if (target.name === 'financeDate') return;
  if (['financeDate', 'financePeriod', 'financeChannel'].includes(target.name)) return render();
  if (target.name === 'proof' && target.form) delete target.form.cloudTicket;
  if (target.name === 'skipHandover') {
    const proof = target.form.querySelector('.handover-proof');
    proof.hidden = proof.querySelector('input').disabled = target.checked;
    delete target.form.cloudTicket;
  }
  if (['category', 'newCategory'].includes(target.name)) {
    const label = target.closest('.category-field').querySelector('.category-name');
    label.hidden = label.querySelector('input').disabled = target.value !== customCategory;
    if (!label.hidden) label.querySelector('input').focus();
  }
  if (target.matches('select[name=name], select[name=newName]')) {
    const label = target.closest('.category-field').querySelector('.product-name-input');
    const input = label.querySelector('input');
    label.hidden = input.disabled = target.value !== customProductName;
    if (!label.hidden) input.focus();
  }
  if (target.name === 'status') {
    filter = target.value;
    listPage = 1;
    document.querySelector('#rows').innerHTML = pageRows();
  }
  if (target.name === 'product') {
    const fieldset = (target.closest('.line-item, .purchase-item') || target.form).querySelector('.new-product');
    if (fieldset) {
      fieldset.hidden = fieldset.disabled = target.value !== 'new';
      const extra = fieldset.closest('.purchase-new');
      if (extra) extra.hidden = fieldset.hidden;
    }
  }
  if (target.name === 'product' && target.form.dataset.submit === 'sale' && target.closest('.line-item')) {
    const row = target.closest('.line-item');
    const p = byId(state.products, target.value);
    const online = target.form.elements.channel.value !== 'Toko';
    row.querySelector('[name=price]').value = p ? (online ? p.market : p.retail) : '';
    row.querySelector('.assembly').hidden = !online || p?.category !== 'PC rakitan' || Boolean(p.recipe?.length);
    row.querySelector('.ready-stock').hidden = !online || !p?.recipe?.length;
    row.querySelector('[name=readyStock]').checked = false;
    row.querySelector('[name=assemble]').checked = false;
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button:not([type=button])');
  const errorBox = form.querySelector('.error');
  if (submit.disabled) return;
  const fields = new FormData(form);
  const values = Object.fromEntries(fields);
  submit.disabled = true;
  form.dataset.saving = '';
  errorBox.textContent = '';
  try {
    const action = form.dataset.submit;
    const id = form.dataset.id;
    if (id) values.id = id;
    if (action === 'sale') values.items = Array.from(form.querySelectorAll('.line-item'), row => ({
      product: row.querySelector('[name=product]').value,
      newProduct: newProductFrom(row),
      qty: row.querySelector('[name=qty]').value,
      price: row.querySelector('[name=price]').value,
      assemble: row.querySelector('[name=assemble]').checked,
      readyStock: row.querySelector('[name=readyStock]').checked,
    }));
    if (action === 'product') {
      if (!id) values.name = productNameValue(form, 'name');
      values.category = categoryValue(form, 'category');
    }
    if (action === 'purchase') values.items = Array.from(form.querySelectorAll('.purchase-item'), row => ({
      product: row.querySelector('[name=product]').value, newProduct: newProductFrom(row),
      qty: row.querySelector('[name=qty]').value, cost: row.querySelector('[name=cost]').value,
    }));
    if (action === 'recipe') values.components = Array.from(form.querySelectorAll('.recipe-line'), row => ({
      product: row.querySelector('[name=component]').value, qty: row.querySelector('[name=componentQty]').value,
    }));
    if (action === 'return-result') values.quantities = fields.getAll('quantities');
    const uploads = fields.getAll('proof');
    if (action === 'ready' && form.recordedVideo) uploads.push(form.recordedVideo);
    if (action === 'ready' && !uploads.length) throw new Error('Unggah atau rekam video QC dulu.');
    delete values.proof;
    let body = values;
    if (uploads.length) {
      if (uploads.reduce((sum, f) => sum + f.size, 0) >= 120 * 1024 ** 2) throw new Error('Total file harus di bawah 120 MB.');
      submit.textContent = 'Menyimpan bukti…';
      if (state.cloudUploads) {
        if (uploads.some(file => file.size > state.uploadLimit)) throw new Error('Ukuran setiap file harus di bawah 45 MB.');
        if (!form.cloudTicket) {
          const signed = await api('upload', {
            action, id, tracking: values.tracking, skipQc: values.skipQc,
            files: uploads.map(file => ({ name: file.name, size: file.size, kind: file.type })),
          });
          for (const [i, file] of uploads.entries()) {
            const upload = await fetch(signed.urls[i], { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
            if (!upload.ok) throw new Error('File bukti gagal dikirim. Coba simpan lagi.');
          }
          form.cloudTicket = signed.ticket;
        }
        body = { ...values, ticket: form.cloudTicket };
      } else {
        body = new FormData();
        body.set('payload', JSON.stringify(values));
        for (const file of uploads) body.append('proof', file);
      }
    }
    form.dataset.submission ||= globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(18)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (action === 'purchase') body.purchaseId = form.dataset.submission;
    await api('action/' + action, body, form.dataset.submission);
    if (action === 'sale' && view === 'online') {
      marketplace = values.channel;
      query = filter = '';
    }
    dialog.close();
    notify('Data tersimpan.');
    await refresh();
    if (action === 'supplier' && values.continuePurchase === 'yes') await click('purchase', '');
    else if (action === 'purchase') purchaseDetail(body.purchaseId);
    else if (action === 'receive') purchaseDetail(id);
    else if (id && !['product', 'product-delete', 'supplier', 'purchase-delete', 'recipe', 'build-stock', 'expense'].includes(action)) saleDetail(id);
  } catch (error) {
    if (error.status === 401) chooseRole(error.message);
    else if (dialog.open) {
      if (error.message.includes('Sesi unggahan berakhir')) delete form.cloudTicket;
      errorBox.textContent = error.message;
    }
    else notify(error.message);
  } finally {
    submit.disabled = false;
    delete form.dataset.saving;
    if (submit.textContent === 'Menyimpan bukti…') submit.textContent = 'Coba simpan lagi';
  }
});

dialog.addEventListener('cancel', event => {
  if (dialog.querySelector('form[data-saving]')) event.preventDefault();
});
dialog.addEventListener('close', () => { if (!dialog.open) releaseCamera?.(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
refresh().catch(error => chooseRole(error.status === 401 ? '' : 'Server belum terhubung. Muat ulang setelah koneksi tersedia.'));
