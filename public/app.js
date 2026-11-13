import { purchasePdf } from './purchase-pdf.js';

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
const menus = { home: 'Ringkasan', online: 'Marketplace', shop: 'Penjualan Toko', stock: 'Stok Barang', buy: 'Pembelian', suppliers: 'Supplier' };
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
let query = '';
let filter = '';
let marketplace = marketplaces[0];
const marketplaceFilters = new Map();
let noticeTimer;
let releaseCamera;
const accessFromLink = new URLSearchParams(location.hash.slice(1)).get('access');
if (accessFromLink) {
  sessionStorage.setItem('k2c-access', accessFromLink);
  history.replaceState(null, '', location.pathname + location.search);
}
const can = (...roles) => roles.includes(state.user.role);
const button = (title, action, key = '', kind = '') => '<button type="button" class="button ' + kind + '" data-action="' + action + '" data-key="' + esc(key) + '">' + esc(title) + '</button>';
const field = (name, title, value = '', type = 'text', extra = '') => '<label>' + esc(title) + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + extra + '></label>';
const amount = (name, title, value = '', min = 0, required = true) => field(name, title, value, 'number', 'min="' + min + '" step="1"' + (required ? ' required' : ''));
const select = (name, title, options, current = '') => '<label>' + esc(title) + '<select name="' + name + '" required>' + options.map(([value, text]) => '<option value="' + esc(value) + '"' + (current === value ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
const proof = (title, accept) => '<label>' + esc(title) + '<input type="file" name="proof" accept="' + accept + '" required></label>';
const options = () => [['', 'Pilih barang'], ...state.products.map(p => [p.id, label(p)])];
const stage = s => '<span class="tag ' + (['Dikirim', 'Selesai', 'Retur diperiksa'].includes(s) ? 'good' : s.startsWith('Retur') || s.includes('retur') ? 'warn' : s === 'Dibatalkan' ? 'neutral' : '') + '">' + esc(s) + '</span>';

async function api(path, body, submission) {
  const isForm = body instanceof FormData;
  const headers = isForm ? {} : { 'Content-Type': 'application/json' };
  if (submission) headers['X-K2C-Submission'] = submission;
  const cloudAccess = path === 'role' ? sessionStorage.getItem('k2c-access') : '';
  if (cloudAccess) headers['X-K2C-Access'] = cloudAccess;
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

function table(columns, rows, empty, className = '') {
  if (!rows.length) return '<p class="empty">' + esc(empty) + '</p>';
  return '<div class="table-wrap ' + className + '"><table><thead><tr>' + columns.map(s => '<th scope="col">' + esc(s) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((cell, i) =>
      '<td><span class="mobile-label" aria-hidden="true">' + esc(columns[i]) + '</span><div class="cell-value">' + cell + '</div></td>'
    ).join('') + '</tr>').join('') + '</tbody></table></div>';
}

function salesTable(rows, online, empty = 'Belum ada transaksi.') {
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
  }), empty, 'sales-list' + (online ? ' has-status' : '') + (can('admin') ? ' has-total' : ''));
}

const panel = (title, content) => '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2></div>' + content + '</section>';
const search = placeholder => '<input type="search" id="search" aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '" value="' + esc(query) + '">';
const matches = (...terms) => terms.some(term => String(term ?? '').toLowerCase().includes(query.toLowerCase().trim()));

function pageRows() {
  if (can('teknisi')) return technicianOrders();
  if (view === 'online' || view === 'shop') {
    const online = view === 'online';
    return salesTable(state.sales.filter(s => (online ? s.channel === marketplace : s.channel === 'Toko') && (!filter || s.status === filter) &&
      matches(s.order, s.tracking, s.channel, s.buyer, ...s.items.map(label))), online);
  }
  if (view === 'stock') {
    const columns = ['Nama barang', 'Varian', 'Tersedia', 'Dipesan', 'Harga toko', 'Harga marketplace', 'Aksi'];
    const rows = state.products.filter(p => matches(label(p), p.category)).map(p => [
      '<strong>' + esc(p.name) + '</strong><small>' + esc(p.category) + '</small>',
      esc(p.variant || '—'),
      '<strong>' + (p.stock - p.reserved) + '</strong>' + (p.inspection ? '<small>' + p.inspection + ' retur dicek</small>' : ''),
      p.reserved,
      fmt(p.retail),
      fmt(p.market),
      button('Edit', 'product', p.id),
    ]);
    return table(columns, rows, 'Belum ada barang yang sesuai.', 'stock-sheet');
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
    button('Ganti peran', 'logout', '', 'dark-button') + '</header><div class="tech-content">' +
    '<nav class="tech-tabs" aria-label="Marketplace">' + marketplaces.map(channel =>
      '<button type="button"' + marketTheme(channel) + ' data-action="navigate" data-key="' + channel + '"' + (view === channel ? ' aria-current="page"' : '') +
      '><strong>' + channel + '</strong><span>' + pending(channel) + ' perlu ditangani</span></button>').join('') +
    '</nav><div class="tech-title"><h1>Pesanan ' + view + '</h1>' + button('Muat ulang', 'reload') + '</div>' +
    search('Cari nomor pesanan atau resi') + '<div id="rows">' + technicianOrders() + '</div></div></main>';
}

function render() {
  if (can('teknisi')) return renderTechnician();
  const admin = can('admin');
  const nav = Object.entries(menus).filter(([key]) => admin || !['shop', 'buy'].includes(key));
  if (!nav.some(([key]) => key === view)) view = 'home';
  const online = state.sales.filter(s => s.channel !== 'Toko');
  let content;
  let action = '';
  if (view === 'home') {
    const cards = can('teknisi', 'admin') ? ['Pesanan masuk', 'Siap kirim', 'Retur diterima', 'Bukti retur lengkap'] : ['Siap kirim', 'Retur diterima'];
    if (admin) action = button('Input pesanan', 'sale-new', 'online', 'primary');
    content = '<div class="stats">' + cards.map(s => '<button class="stat" data-action="queue" data-key="' + esc(s) + '"><span>' + esc(s === 'Pesanan masuk' ? 'Perlu dites' : s === 'Bukti retur lengkap' ? 'Perlu diperiksa' : s) + '</span><strong>' + online.filter(o => o.status === s).length + '</strong></button>').join('') +
      '</div>' + panel('Antrean pesanan', salesTable(online.filter(o => cards.includes(o.status)).slice(0, 10), true, 'Antrean kerja kosong.'));
  } else {
    const titles = { online: ['Input pesanan', 'sale-new'], shop: ['Transaksi baru', 'sale-new'], stock: ['Tambah barang', 'product'], buy: ['Catat pembelian', 'purchase'], suppliers: ['Tambah supplier', 'supplier'] };
    if (admin && (view !== 'online' || marketplaces.includes(marketplace))) action = view === 'online' ? button('Input pesanan ' + marketplace, 'sale-new', marketplace, 'primary') : button(...titles[view], '', 'primary');
    const placeholders = { online: 'Cari resi, nomor pesanan, atau pembeli', shop: 'Cari pembeli atau barang', stock: 'Cari barang atau varian', buy: 'Cari supplier atau barang', suppliers: 'Cari nama atau nomor WhatsApp' };
    const statusFilter = view === 'online' ? '<div>' + select('status', 'Status', [['', 'Semua status'], ...statuses.map(s => [s, s])], filter) + '</div>' : '';
    content = '<section class="panel"><div class="toolbar' + (view === 'online' ? ' market-toolbar' : '') + '">' + search(placeholders[view]) + statusFilter + '</div><div id="rows">' + pageRows() + '</div></section>';
    if (view === 'online') {
      const channels = [...marketplaces, ...new Set(online.map(sale => sale.channel).filter(channel => !marketplaces.includes(channel)))];
      content = '<nav class="market-tabs" aria-label="Pilih marketplace">' + channels.map(channel =>
        '<button type="button" class="market-tab"' + marketTheme(channel) + ' data-action="market-channel" data-key="' + esc(channel) + '"' +
        (channel === marketplace ? ' aria-current="page"' : '') + '><strong>' + esc(channel) + '</strong><span>' +
        online.filter(sale => sale.channel === channel).length + ' pesanan</span></button>'
      ).join('') + '</nav>' + content;
    }
    if (view === 'stock' && admin && state.movements.length) content += '<details class="panel stock-history"><summary>Riwayat stok</summary>' + table(['Barang', 'Jumlah', 'Alasan', 'Petugas', 'Waktu'], state.movements.slice(0, 20).map(m => [
      esc(label(byId(state.products, m.product))), (m.qty > 0 ? '+' : '') + m.qty, esc(m.reason), esc(m.actor), esc(date(m.at)),
    ]), 'Belum ada pergerakan stok.') + '</details>';
  }
  app.innerHTML = '<div class="shell"><aside class="sidebar">' + brand + '<nav aria-label="Navigasi utama">' +
    nav.map(([key, title]) => '<button class="nav-button" data-action="navigate" data-key="' + key + '"' + (key === view ? ' aria-current="page"' : '') + '>' + title + '</button>').join('') +
    '</nav><div class="account"><strong>' + esc(state.user.name) + '</strong>' + button('Ganti peran', 'logout', '', 'dark-button') +
    '</div></aside><main><div class="topbar"><span>' + esc(new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date())) + '</span>' +
    button('Muat ulang', 'reload') + '</div><div class="content"><header class="page-header"><h1>' + menus[view] + '</h1>' + action + '</header>' + content + '</div></main></div>';
}

function open(title, body) {
  releaseCamera?.();
  dialog.innerHTML = '<header class="dialog-head"><h2 id="dialog-title">' + esc(title) + '</h2>' + button('Tutup', 'close') +
    '</header><div class="dialog-body">' + body + '</div>';
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function form(title, action, body, id = '', submit = 'Simpan') {
  open(title, '<form data-submit="' + action + '" data-id="' + esc(id) + '">' + body +
    '<p class="error" role="alert"></p><div class="actions">' + (id && !['product', 'supplier'].includes(action) ? button('Kembali', ['receive', 'purchase-delete'].includes(action) ? 'purchase-detail' : 'sale-detail', id) : '') +
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

function productNameField(name, current) {
  if (current) return field(name, 'Nama barang', current, 'text', 'readonly');
  const names = new Map();
  for (const product of state.products) {
    const key = product.name.trim().toLowerCase();
    if (!names.has(key)) names.set(key, product.name);
  }
  const choices = [...names.values()].sort((a, b) => a.localeCompare(b, 'id'));
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
  return select('product', 'Barang / Varian', [...options(), ['new', '+ Buat produk baru']], state.products.length ? '' : 'new');
}

function transactionProduct(sale = false) {
  return transactionProductSelect() + newProductFields(sale);
}

function newProductFields(sale) {
  return '<fieldset class="new-product"' + (state.products.length ? ' hidden disabled' : '') + '><legend>Produk baru</legend>' +
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
    '</td></tr><tr class="purchase-new"' + (state.products.length ? ' hidden' : '') +
    '><td colspan="5">' + newProductFields(false) + '</td></tr></tbody>';
}

function line() {
  return '<div class="line-item">' + transactionProduct(true) + '<div class="grid">' +
    amount('qty', 'Jumlah', 1, 1) + amount('price', 'Harga jual per unit') + '</div>' +
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
  if (s.status === 'Siap kirim') actions.push(button('Catat serah terima', 'ship', id, 'primary'));
  if (s.status === 'Dikirim') actions.push(button('Paket kembali', 'return-start', id));
  if (s.status === 'Retur diterima') actions.push(button('Unggah bukti retur', 'return-evidence', id, 'primary'));
  if (can('teknisi') && s.status === 'Bukti retur lengkap') actions.push(button('Catat hasil pemeriksaan', 'return-result', id, 'primary'));
  if (admin && ['Dikirim', 'Retur diterima', 'Bukti retur lengkap', 'Retur diperiksa'].includes(s.status)) actions.push(button('Catat dana cair', 'settlement', id));
  if (admin && ['Pesanan masuk', 'Siap kirim'].includes(s.status)) actions.push(button('Batalkan pesanan', 'cancel', id));
  const items = s.items.map((item, i) => '<li><strong>' + esc(label(item)) + '</strong> × ' + item.qty +
    (admin ? ' · ' + fmt(item.price) : '') + (item.parts ? '<small class="cell-sub">Rakitan pesanan' +
      (item.parts.length ? ' · ' + item.parts.map(part => esc(label(byId(state.products, part.product))) + ' × ' + part.qty).join(', ') : '') +
      '</small>' + (can('admin', 'teknisi') && s.status === 'Pesanan masuk' ? button('Catat komponen', 'parts', id + ':' + i) : '') : '') + '</li>');
  const evidenceLabels = { ready: 'Video tes', ship: 'Foto serah terima', 'return-evidence': 'Bukti retur' };
  const proofs = s.evidence.map(f => '<li><a href="/api/evidence/' + esc(f.id) + '" download>' + esc(evidenceLabels[f.stage] + ' · ' + f.name) + '</a><small class="cell-sub">' + esc(f.actor + ' · ' + date(f.at)) + '</small></li>');
  const history = s.history.map(h => '<li>' + esc([h.status, h.skipQc && 'QC tanpa video', h.skipHandover && 'Tanpa foto serah terima', h.actor, date(h.at)].filter(Boolean).join(' · ')) + '</li>');
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
    return chooseRole();
  }
  if (action === 'reload') return refresh();
  if (action === 'market-channel') {
    if (marketplace === key) return;
    marketplaceFilters.set(marketplace, { query, filter });
    marketplace = key;
    ({ query = '', filter = '' } = marketplaceFilters.get(key) || {});
    return render();
  }
  if (action === 'navigate' || action === 'queue') {
    if (view === 'online') marketplaceFilters.set(marketplace, { query, filter });
    view = action === 'queue' ? 'online' : key;
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
    const bytes = purchasePdf(['No. ' + number, 'Tanggal: ' + date(purchase.at), 'Supplier: ' + purchase.supplier, '',
      ...purchaseItems(purchase).flatMap((item, index) => [
        (index + 1) + '. ' + purchaseItemLabel(item),
        item.qty + ' unit x ' + fmt(item.cost) + ' = ' + fmt(item.qty * item.cost),
      ]), '', 'TOTAL: ' + fmt(purchaseTotal(purchase))]);
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
  if (action === 'product') {
    const p = byId(state.products, key);
    const canSetInitial = !p || (!p.stock && !p.reserved && !state.movements.some(m => m.product === p.id));
    const initial = canSetInitial ? '<fieldset><legend>Stok awal (opsional)</legend><div class="grid">' +
      amount('initialStock', 'Jumlah yang sudah ada', '', 0, false) + amount('initialCost', 'Modal per unit', '', 0, false) + '</div></fieldset>' : '';
    return form(p ? 'Edit barang' : 'Tambah barang', 'product', productNameField('name', p?.name) +
      field('variant', 'Varian', p?.variant) +
      categoryField('category', p?.category) +
      '<div class="grid">' + amount('retail', 'Harga toko', p?.retail) + amount('market', 'Harga marketplace', p?.market) + '</div>' + initial, key);
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
  if (action === 'parts') {
    const [id, index] = key.split(':');
    return form('Pemakaian komponen', 'parts', '<input type="hidden" name="line" value="' + esc(index) + '">' +
      select('product', 'Komponen', options()) + amount('qty', 'Jumlah terpakai', 1, 1), id);
  }
  const s = byId(state.sales, key);
  if (!s) return;
  if (action === 'ready-upload') return form('Unggah video QC', 'ready', proof('Video QC (MP4)', 'video/mp4,.mp4'), key, 'Simpan & tandai siap kirim');
  if (action === 'ready') return recordTest(key);
  if (action === 'ship') {
    const skipQc = s.status === 'Pesanan masuk';
    return form(skipQc ? 'Lewati QC & catat pengiriman' : 'Serah terima paket', action,
      (skipQc ? '<input type="hidden" name="skipQc" value="yes"><p>Pesanan akan ditandai dikirim tanpa video QC. Gunakan jika paket sudah dikirim.</p>' : '') +
      field('tracking', 'Nomor resi', s.tracking, 'text', 'required') +
      '<div class="handover-proof">' + proof('Foto bukti serah terima ke kurir atau gerai', 'image/*') + '</div>' +
      '<label class="check"><input type="checkbox" name="skipHandover" value="yes">Lewati foto serah terima</label>',
      key, 'Simpan & tandai dikirim');
  }
  if (action === 'return-start') return form('Terima paket kembali', action, '<p>Konfirmasi paket sudah diterima. Ambil dua foto paket sebelum dibuka dan rekam video unboxing.</p>', key, 'Tandai retur diterima');
  if (action === 'return-evidence') return form('Bukti paket kembali', action, proof('Foto paket 1', 'image/*') + proof('Foto paket 2', 'image/*') + proof('Video unboxing (MP4)', 'video/mp4,.mp4'), key);
  if (action === 'return-result') return form('Pemeriksaan retur', action, s.items.map(item => amount('quantities', label(item) + ' · Jumlah siap jual dari ' + item.qty, 0)).join('') +
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
  const row = event.target.closest('.purchase-entry');
  if (row && ['qty', 'cost'].includes(event.target.name)) {
    const qty = row.querySelector('[name=qty]');
    const cost = row.querySelector('[name=cost]');
    row.querySelector('.purchase-subtotal').textContent = qty.validity.valid && cost.validity.valid ? fmt(qty.valueAsNumber * cost.valueAsNumber) : '—';
  }
  if (event.target.id !== 'search') return;
  query = event.target.value;
  document.querySelector('#rows').innerHTML = pageRows();
});

document.addEventListener('change', event => {
  const target = event.target;
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
    row.querySelector('.assembly').hidden = !online || p?.category !== 'PC rakitan';
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
    }));
    if (action === 'product') {
      values.name = productNameValue(form, 'name');
      values.category = categoryValue(form, 'category');
    }
    if (action === 'purchase') values.items = Array.from(form.querySelectorAll('.purchase-item'), row => ({
      product: row.querySelector('[name=product]').value, newProduct: newProductFrom(row),
      qty: row.querySelector('[name=qty]').value, cost: row.querySelector('[name=cost]').value,
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
    else if (id && !['product', 'supplier', 'purchase-delete'].includes(action)) saleDetail(id);
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
