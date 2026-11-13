export function purchasePdf(lines) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const pages = [];
  const safe = value => [...value].map(c => c.codePointAt(0) <= 255 ? c : '?').join('').replace(/[\\()]/g, '\\$&');
  const wrapped = lines.flatMap(line => String(line).replace(/[\r\n\t]/g, ' ').match(/.{1,82}(?:\s|$)|.{1,82}/g) || ['']);
  for (let offset = 0; offset < wrapped.length; offset += 37) {
    const page = objects.length + 1;
    pages.push(page + ' 0 R');
    const commands = ['BT /F1 20 Tf 48 788 Td (NOTA PEMBELIAN) Tj ET',
      'BT /F1 11 Tf 48 765 Td (K2C Komputindo) Tj ET',
      '0.2 0.3 0.45 RG 48 752 m 547 752 l S',
      ...wrapped.slice(offset, offset + 37).map((line, index) =>
        'BT /F1 11 Tf 48 ' + (728 - 18 * index) + ' Td (' + safe(line.trim()) + ') Tj ET'),
      'BT /F1 9 Tf 48 42 Td (Halaman ' + pages.length + ') Tj ET'].join('\n');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (page + 1) + ' 0 R >>',
      '<< /Length ' + commands.length + ' >>\nstream\n' + commands + '\nendstream');
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = '<< /Type /Pages /Kids [' + pages.join(' ') + '] /Count ' + pages.length + ' >>';
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
