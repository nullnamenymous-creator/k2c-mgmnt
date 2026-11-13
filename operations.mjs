import { randomUUID } from 'node:crypto';

export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
const id = () => randomUUID();
const clean = value => typeof value === 'string' ? value.trim() : '';
function required(value, label) {
  if (!clean(value)) fail(label + ' wajib diisi.');
  return clean(value);
}
function number(value, label, min = 0) {
  if (value === '' || value == null || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > 1e12) fail(label + ' tidak valid.');
  return Number(value);
}
const find = (rows, key) => rows.find(row => row.id === key) ?? fail('Data tidak ditemukan.', 404);
function stockLines(item) {
  return item.components ?? (item.parts ? [] : [item]);
}
const active = ['Pesanan masuk', 'Siap kirim'];
export function reserved(state, product) {
  return state.sales.filter(s => s.channel !== 'Toko' && active.includes(s.status))
    .flatMap(s => s.items).flatMap(stockLines).filter(item => item.product === product).reduce((sum, item) => sum + item.qty, 0);
}
export function inspection(state, product) {
  return state.sales.filter(s => ['Retur diterima', 'Bukti retur lengkap'].includes(s.status))
    .flatMap(s => s.items).filter(item => item.product === product).reduce((sum, item) => sum + item.qty, 0);
}
const free = (state, product) => product.stock - reserved(state, product.id);

export function apply(state, action, input, user, files = []) {
  const at = new Date().toISOString();
  const actor = user.name;
  function allow(...roles) {
    if (!roles.includes(user.role)) fail('Akses ditolak.', 403);
  }
  function move(product, qty, reason, reference) {
    const p = find(state.products, product);
    if (p.stock + qty < 0) fail('Stok fisik tidak cukup.');
    p.stock += qty;
    state.movements.unshift({ product, qty, reason, reference, actor, at });
  }
  function history(sale, status) {
    sale.status = status;
    sale.history.push({ status, actor, at });
  }
  function transactionProduct(line, channel) {
    if (line.product !== 'new') return find(state.products, line.product);
    const draft = line.newProduct;
    if (!draft || typeof draft !== 'object') fail('Isi data produk baru.');
    const purchase = channel === undefined;
    return apply(state, 'product', {
      name: draft.name, variant: draft.variant, category: draft.category,
      retail: purchase ? draft.retail || 0 : channel === 'Toko' ? line.price : 0,
      market: purchase ? draft.market || 0 : channel === 'Toko' ? 0 : line.price,
      initialStock: purchase ? undefined : number(draft.initialStock, 'Stok fisik sebelum dijual', 1),
      initialCost: draft.initialCost,
    }, user);
  }
  if (action === 'build-stock') {
    allow('admin');
    const product = find(state.products, input.id);
    const qty = number(input.qty, 'Jumlah paket', 1);
    if (!product.recipe?.length) fail('Isi daftar komponen paket dulu.');
    const lines = product.recipe.map(line => ({ part: find(state.products, line.product), qty: number(line.qty * qty, 'Jumlah komponen', 1) }));
    for (const line of lines) if (free(state, line.part) < line.qty) fail('Stok tersedia tidak cukup untuk ' + line.part.name + '.');
    for (const line of lines) move(line.part.id, -line.qty, 'Perakitan paket', product.id);
    move(product.id, qty, 'Paket siap jual', product.id);
    return product;
  }
  if (action === 'recipe') {
    allow('admin');
    const product = find(state.products, input.id);
    if (!Array.isArray(input.components)) fail('Daftar komponen tidak valid.');
    const seen = new Set();
    product.recipe = input.components.map(line => {
      const component = find(state.products, line.product);
      if (component.id === product.id || component.recipe?.length || seen.has(component.id)) fail('Pilih komponen berbeda yang bukan paket.');
      seen.add(component.id);
      return { product: component.id, qty: number(line.qty, 'Jumlah per paket', 1) };
    });
    if (product.recipe.length && state.products.some(other => other.recipe?.some(line => line.product === product.id))) fail('Barang ini sudah dipakai sebagai komponen paket lain.');
    return product;
  }
  if (action === 'product') {
    allow('admin');
    const p = input.id ? find(state.products, input.id) : { id: id(), stock: 0, cost: 0 };
    const requestedName = required(input.name, 'Nama barang');
    const existingName = state.products.find(row => row.name.trim().toLowerCase() === requestedName.toLowerCase());
    const name = input.id ? p.name : existingName?.name ?? requestedName;
    const variant = clean(input.variant);
    if (state.products.some(row => row.id !== p.id && row.name.toLowerCase() === name.toLowerCase() && row.variant.toLowerCase() === variant.toLowerCase())) fail('Barang dan varian sudah ada.');
    Object.assign(p, { name, variant, category: required(input.category, 'Kategori'), retail: number(input.retail, 'Harga toko'), market: number(input.market, 'Harga marketplace') });
    if (!input.id) state.products.push(p);
    if (input.initialStock !== undefined && input.initialStock !== '') {
      const qty = number(input.initialStock, 'Stok awal');
      if (qty) {
        if (p.stock || state.movements.some(m => m.product === p.id) || reserved(state, p.id)) fail('Stok awal sudah tercatat. Gunakan Pembelian untuk barang masuk.');
        p.cost = number(input.initialCost || 0, 'Modal per unit');
        move(p.id, qty, 'Stok awal', null);
      }
    }
    return p;
  }
  if (action === 'adjust') {
    allow('admin');
    const p = find(state.products, input.product);
    const target = number(input.stock, 'Stok fisik');
    if (target < reserved(state, p.id)) fail('Stok fisik lebih kecil dari jumlah yang sudah dipesan.');
    const reason = required(input.reason, 'Alasan koreksi');
    if (input.cost !== undefined && input.cost !== '') p.cost = number(input.cost, 'Modal per unit');
    move(p.id, target - p.stock, reason, null);
    return p;
  }
  if (action === 'supplier') {
    allow('admin');
    const suppliers = state.suppliers ??= [];
    const supplier = input.id ? find(suppliers, input.id) : { id: id() };
    const name = required(input.name, 'Nama supplier');
    const rawPhone = required(input.phone, 'Nomor WhatsApp');
    let phone = rawPhone.replace(/[+\s().-]/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);
    if (!/^[1-9][0-9]{7,14}$/.test(phone)) fail('Isi nomor WhatsApp yang valid, misalnya 081234567890.');
    Object.assign(supplier, { name, phone });
    if (!input.id) suppliers.push(supplier);
    return supplier;
  }
  if (action === 'purchase') {
    allow('admin');
    const supplier = find(state.suppliers ?? [], input.supplier);
    const purchaseId = input.purchaseId || id();
    if (typeof purchaseId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(purchaseId)) fail('Referensi pembelian tidak valid.');
    if (state.purchases.some(row => row.id === purchaseId)) fail('Pembelian sudah tersimpan.');
    const lines = input.items ?? [input];
    if (!Array.isArray(lines) || !lines.length) fail('Tambahkan barang pembelian.');
    const items = lines.map(line => {
      const product = transactionProduct(line);
      return { product: product.id, itemLabel: [product.name, product.variant].filter(Boolean).join(' / '),
        qty: number(line.qty, 'Jumlah', 1), cost: number(line.cost, 'Harga beli'), received: 0 };
    });
    const purchase = { id: purchaseId, supplier: supplier.name, supplierId: supplier.id,
      supplierPhone: supplier.phone, items, receipts: [], at, actor };
    state.purchases.unshift(purchase);
    return apply(state, 'receive', { id: purchase.id, quantities: items.map(item => item.qty) }, user);
  }
  if (action === 'receive' || action === 'purchase-delete') {
    allow('admin');
    const purchase = find(state.purchases, input.id);
    const items = purchase.items ?? [purchase];
    if (action === 'purchase-delete') {
      const totals = new Map();
      for (const item of items) totals.set(item.product, (totals.get(item.product) || 0) + item.received);
      for (const [product, qty] of totals) {
        if (qty && free(state, find(state.products, product)) < qty) fail('Stok tersedia tidak cukup untuk membalik penerimaan pembelian ini.');
      }
      for (const [product, qty] of totals) {
        if (qty) move(product, -qty, 'Pembelian dihapus', purchase.id);
      }
      state.purchases.splice(state.purchases.indexOf(purchase), 1);
      return purchase;
    }
    const quantities = input.quantities ?? [input.qty];
    if (!Array.isArray(quantities) || quantities.length !== items.length) fail('Isi jumlah diterima per barang.');
    const amounts = quantities.map((qty, index) => {
      const received = number(qty, 'Jumlah diterima');
      if (received > items[index].qty - items[index].received) fail('Jumlah melebihi sisa pembelian.');
      return received;
    });
    if (!amounts.some(Boolean)) fail('Isi minimal satu jumlah diterima.');
    items.forEach((item, index) => {
      const qty = amounts[index];
      if (!qty) return;
      move(item.product, qty, 'Penerimaan pembelian', purchase.id);
      item.received += qty;
      purchase.receipts.push({ qty, itemLabel: item.itemLabel, at, actor });
    });
    return purchase;
  }
  if (action === 'sale') {
    allow('admin');
    const channel = required(input.channel, 'Kanal');
    if (!['Toko', 'Shopee', 'Tokopedia'].includes(channel)) fail('Pilih Toko, Shopee, atau Tokopedia.');
    const online = channel !== 'Toko';
    const order = online ? required(input.order, 'Nomor pesanan') : '';
    const tracking = online ? clean(input.tracking) : '';
    const buyer = online ? required(input.buyer, 'Nama pembeli') : clean(input.buyer);
    if (online && state.sales.some(s => s.channel.toLowerCase() === channel.toLowerCase() && s.order.toLowerCase() === order.toLowerCase())) fail('Nomor pesanan sudah tercatat di kanal ini.');
    if (!Array.isArray(input.items) || !input.items.length) fail('Tambahkan barang.');
    const claimed = new Map();
    const items = input.items.map(line => {
      const p = transactionProduct(line, channel);
      const qty = number(line.qty, 'Jumlah', 1);
      const components = online && p.recipe?.length && !line.readyStock ? p.recipe.map(component => ({
        product: component.product, qty: number(component.qty * qty, 'Jumlah komponen', 1),
        cost: find(state.products, component.product).cost,
      })) : undefined;
      const parts = !p.recipe?.length && line.assemble && online && p.category === 'PC rakitan' ? [] : null;
      for (const line of stockLines({ product: p.id, qty, parts, components })) {
        const product = find(state.products, line.product);
        const needed = (claimed.get(product.id) ?? 0) + line.qty;
        if (free(state, product) < needed) fail('Stok tersedia tidak cukup untuk ' + product.name + '.');
        claimed.set(product.id, needed);
      }
      const cost = components ? components.reduce((sum, line) => sum + line.cost * line.qty, 0) / qty : parts ? 0 : p.cost;
      return { product: p.id, name: p.name, variant: p.variant, qty, price: number(line.price, 'Harga jual'), cost, parts, ...(components ? { components } : {}) };
    });
    const sale = { id: id(), channel, order, tracking, buyer, items, history: [], evidence: [], at, actor };
    history(sale, online ? 'Pesanan masuk' : 'Selesai');
    if (!online) for (const item of items) move(item.product, -item.qty, 'Penjualan toko', sale.id);
    state.sales.unshift(sale);
    return sale;
  }
  const sale = find(state.sales, input.id);
  if (sale.channel === 'Toko') fail('Aksi ini khusus pesanan marketplace.');
  function step(expected) {
    if (!expected.includes(sale.status)) fail('Status pesanan sudah berubah.', 409);
  }
  function attach(kinds) {
    if (files.length !== kinds.length || kinds.some((kind, i) => kind === 'video' ? files[i].kind !== 'video/mp4' : !files[i].kind.startsWith('image/'))) fail('Lengkapi bukti sesuai jenis file yang diminta. Video harus MP4.');
    sale.evidence.push(...files.map(({ id, kind, name }) => ({ id, kind, name, actor, at, stage: action })));
  }
  if (action === 'component-swap') {
    allow('admin', 'teknisi');
    step(['Pesanan masuk']);
    const item = sale.items[number(input.line, 'Baris pesanan')];
    const part = item?.components?.[number(input.part, 'Baris komponen')];
    if (!part) fail('Komponen pesanan tidak ditemukan.', 404);
    const replacement = find(state.products, input.product);
    if (replacement.id === part.product || replacement.id === item.product || replacement.recipe?.length) fail('Pilih barang pengganti yang berbeda dan bukan paket.');
    if (free(state, replacement) < part.qty) fail('Stok tersedia tidak cukup untuk ' + replacement.name + '.');
    const previous = find(state.products, part.product);
    item.cost += (replacement.cost - (part.cost ?? previous.cost)) * part.qty / item.qty;
    part.product = replacement.id;
    part.cost = replacement.cost;
    sale.history.push({ status: sale.status, actor, at, note: 'Komponen diganti: ' + previous.name + ' → ' + replacement.name });
  } else if (action === 'parts') {
    allow('admin', 'teknisi');
    step(['Pesanan masuk']);
    const item = sale.items[number(input.line, 'Baris barang')];
    if (!item?.parts) fail('Barang ini tidak menunggu rakitan.');
    const p = find(state.products, input.product);
    const qty = number(input.qty, 'Jumlah komponen', 1);
    if (p.id === item.product || free(state, p) < qty) fail('Komponen tidak tersedia.');
    move(p.id, -qty, 'Pemakaian komponen', sale.id);
    item.parts.push({ product: p.id, qty, cost: p.cost });
  } else if (action === 'ready') {
    allow('admin', 'teknisi');
    step(['Pesanan masuk']);
    if (sale.items.some(item => item.parts && !item.parts.length)) fail('Catat pemakaian komponen rakitan dulu.');
    attach(['video']);
    history(sale, 'Siap kirim');
  } else if (action === 'ship') {
    allow('admin', 'teknisi');
    const skipQc = input.skipQc === 'yes' && sale.status === 'Pesanan masuk';
    const skipHandover = input.skipHandover === 'yes';
    step(skipQc ? ['Pesanan masuk'] : ['Siap kirim']);
    if (skipQc && sale.items.some(item => item.parts && !item.parts.length)) fail('Catat komponen rakitan sebelum menandai pesanan dikirim.');
    sale.tracking = required(input.tracking, 'Nomor resi');
    attach(skipHandover ? [] : ['image']);
    for (const item of sale.items.flatMap(stockLines)) move(item.product, -item.qty, 'Pengiriman marketplace', sale.id);
    history(sale, 'Dikirim');
    if (skipQc || skipHandover) Object.assign(sale.history.at(-1), { skipQc, skipHandover });
  } else if (action === 'return-start') {
    allow('admin', 'teknisi');
    step(['Dikirim']);
    history(sale, 'Retur diterima');
  } else if (action === 'return-evidence') {
    allow('admin', 'teknisi');
    step(['Retur diterima']);
    attach(['image', 'image', 'video']);
    history(sale, 'Bukti retur lengkap');
  } else if (action === 'return-result') {
    allow('teknisi');
    step(['Bukti retur lengkap']);
    const quantities = Array.isArray(input.quantities) ? input.quantities : [];
    sale.items.forEach((item, i) => {
      const qty = number(quantities[i], 'Jumlah kembali siap jual');
      if (qty > item.qty) fail('Jumlah retur melebihi pesanan.');
      if (qty) {
        const p = find(state.products, item.product);
        const unitCost = item.parts ? item.parts.reduce((sum, part) => sum + part.cost * part.qty, 0) / item.qty : item.cost;
        p.cost = Math.round((p.stock * p.cost + qty * unitCost) / (p.stock + qty));
        move(item.product, qty, 'Retur siap jual', sale.id);
      }
    });
    sale.returnResult = { note: required(input.note, 'Catatan pemeriksaan'), quantities, at, actor };
    history(sale, 'Retur diperiksa');
  } else if (action === 'cancel') {
    allow('admin');
    step(active);
    if (sale.items.some(item => item.parts?.length)) {
      const mode = required(input.mode, 'Penanganan rakitan');
      if (!['dilepas', 'disimpan'].includes(mode)) fail('Pilih penanganan rakitan.');
      for (const item of sale.items.filter(item => item.parts?.length)) {
        if (mode === 'dilepas') {
          for (const part of item.parts) move(part.product, part.qty, 'Komponen rakitan dibongkar', sale.id);
        } else {
          if (sale.status !== 'Siap kirim') fail('Rakitan harus sudah dites agar bisa masuk stok.');
          const p = find(state.products, item.product);
          const cost = item.parts.reduce((sum, part) => sum + part.qty * part.cost, 0);
          p.cost = Math.round((p.cost * p.stock + cost) / (p.stock + item.qty));
          move(p.id, item.qty, 'Rakitan siap jual dari pesanan batal', sale.id);
        }
      }
    }
    history(sale, 'Dibatalkan');
  } else if (action === 'settlement') {
    allow('admin');
    step(['Dikirim', 'Retur diterima', 'Bukti retur lengkap', 'Retur diperiksa']);
    sale.settlement = { fee: number(input.fee, 'Potongan'), payout: number(input.payout, 'Dana cair'), at, actor };
  } else {
    fail('Aksi tidak dikenal.', 404);
  }
  return sale;
}
