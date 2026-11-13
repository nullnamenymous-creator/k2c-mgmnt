const rupiah = new Intl.NumberFormat('id-ID');
const money = value => 'Rp ' + rupiah.format(value);
const latin = value => String(value ?? '').replace(/[\u2010-\u2015]/g, '-')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/\s/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/gu, '?');
const literal = value => latin(value).replace(/[\\()]/g, '\\$&');
const wrap = (value, width) => latin(value).trim().match(new RegExp('.{1,' + width + '}(?: |$)|.{1,' + width + '}', 'g')) || [''];

export function purchasePdf({ number, date, supplier, items }) {
  const objects = ['', '',
    ...['Helvetica', 'Helvetica-Bold', 'Courier'].map(font =>
      '<< /Type /Font /Subtype /Type1 /BaseFont /' + font + ' /Encoding /WinAnsiEncoding >>')];
  const rows = items.flatMap((item, index) => {
    const names = wrap(item.name, 22);
    const chunks = [];
    for (let i = 0; i < names.length; i += 24) {
      chunks.push({ item, index, names: names.slice(i, i + 24), continuation: i > 0 });
    }
    return chunks;
  });
  const navy = '0.07 0.15 0.27';
  const muted = '0.29 0.35 0.44';
  const blue = '0.12 0.34 0.64';
  const pages = [];
  let commands;
  let y;
  function text(value, x, at, size = 10, font = 'F1', color = navy) {
    commands.push('BT ' + color + ' rg /' + font + ' ' + size + ' Tf 1 0 0 1 ' + x + ' ' + at + ' Tm (' + literal(value) + ') Tj ET');
  }
  function right(value, edge, at, size = 9) {
    text(value, edge - latin(value).length * size * 0.6, at, size, 'F3');
  }
  function box(x, at, width, height, color) {
    commands.push(color + ' rg ' + x + ' ' + at + ' ' + width + ' ' + height + ' re f');
  }
  function startPage() {
    commands = [];
    pages.push(commands);
    box(40, 796, 515, 3, blue);
    text('K2C KOMPUTINDO', 40, 765, 20, 'F2');
    text('KP. RUMBIA PEBAYURAN KAB BEKASI', 40, 746, 9, 'F1', muted);
    text('081298406844', 40, 731, 9, 'F1', muted);
    text('NOTA PEMBELIAN', 413, 765, 14, 'F2');
    right('No. ' + number, 555, 746, 10);
    box(40, 659, 515, 55, '0.95 0.97 0.99');
    text('SUPPLIER', 52, 697, 8, 'F2', muted);
    wrap(latin(supplier).length > 70 ? latin(supplier).slice(0, 67) + '...' : supplier, 36).slice(0, 3).forEach((line, index) => text(line.trim(), 52, 680 - index * 9, 10, 'F2'));
    text('TANGGAL', 370, 697, 8, 'F2', muted);
    text(date, 370, 680);
    box(40, 619, 515, 25, navy);
    for (const [label, x] of [['NO.', 51], ['BARANG / VARIAN', 79], ['QTY', 290], ['HARGA SATUAN', 346], ['SUBTOTAL', 480]]) {
      text(label, x, 628, 8, 'F2', '1 1 1');
    }
    y = 619;
  }
  startPage();
  for (const row of rows) {
    const height = Math.max(26, row.names.length * 13 + 12);
    if (y - height < 95) startPage();
    if (row.index % 2 === 0) box(40, y - height, 515, height, '0.97 0.98 0.99');
    box(40, y - height, 515, 0.5, '0.86 0.89 0.93');
    row.names.forEach((line, index) => text(line.trim(), 79, y - 16 - index * 13, 10));
    if (!row.continuation) {
      text(row.index + 1, 51, y - 16, 9, 'F1', muted);
      right(String(row.item.qty), 322, y - 16, 8);
      right(money(row.item.cost), 433, y - 16, 8);
      right(money(row.item.qty * row.item.cost), 545, y - 16, 8);
    }
    y -= height;
  }
  if (y < 120) startPage();
  const total = items.reduce((sum, item) => sum + item.qty * item.cost, 0);
  box(285, y - 54, 270, 40, '0.92 0.95 0.99');
  text('TOTAL PEMBELIAN', 297, y - 38, 10, 'F2');
  right(money(total), 543, y - 38, 10);
  pages.forEach((pageCommands, index) => {
    commands = pageCommands;
    box(40, 51, 515, 0.5, '0.86 0.89 0.93');
    text('K2C KOMPUTINDO', 40, 36, 8, 'F2', muted);
    right('Halaman ' + (index + 1) + ' / ' + pages.length, 555, 36, 8);
  });
  const refs = pages.map(pageCommands => {
    const page = objects.length + 1;
    const stream = pageCommands.join('\n');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ' + (page + 1) + ' 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    return page + ' 0 R';
  });
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = '<< /Type /Pages /Kids [' + refs.join(' ') + '] /Count ' + refs.length + ' >>';
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.join('') +
    'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Uint8Array.from(pdf, character => character.charCodeAt(0));
}
