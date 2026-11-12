import { createServer, IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { db } from './db.mjs';
import { apply, fail, inspection, reserved } from './operations.mjs';

const files = new Map(Object.entries({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
}));
const readState = db.prepare('SELECT body FROM state WHERE id=1');
const writeState = db.prepare('UPDATE state SET body=? WHERE id=1');
const sessions = db.prepare("SELECT name, substr(name, 6) AS role FROM sessions WHERE token=? AND expires>? AND name IN ('role:admin', 'role:teknisi')");
const maxUpload = 120 * 1024 ** 2;
const secure = process.env.K2C_SECURE_COOKIE === '1';
const tokenCookie = (token, age) => 'k2c=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : '');

class LimitedRequest extends IncomingMessage {
  async *limited() {
    let total = 0;
    for await (const chunk of this.iterator({ destroyOnReturn: false })) {
      total += chunk.length;
      if (total > maxUpload) fail('Ukuran unggahan melebihi 120 MB.', 413);
      yield chunk;
    }
  }
}

const server = createServer({ IncomingMessage: LimitedRequest }, async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const send = (value, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    if (req.method === 'GET' && files.has(path)) {
      const [name, type] = files.get(path);
      const body = readFileSync(new URL('./public/' + name, import.meta.url));
      res.writeHead(200, { 'Content-Type': type });
      return res.end(body);
    }
    if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host && req.headers.origin !== process.env.K2C_ORIGIN) fail('Asal permintaan tidak valid.', 403);
    if (Number(req.headers['content-length']) > maxUpload) fail('Ukuran unggahan melebihi 120 MB.', 413);
    const type = req.headers['content-type'] || '';
    function request() {
      return new Request('http://localhost/', { method: 'POST', headers: { 'Content-Type': type }, body: Readable.toWeb(Readable.from(req.limited())), duplex: 'half' });
    }
    if (req.method === 'POST' && path === '/api/role') {
      if (!type.startsWith('application/json')) fail('Format permintaan tidak valid.');
      const now = Date.now();
      const { role } = await request().json() ?? {};
      if (!['admin', 'teknisi'].includes(role)) fail('Pilih Admin atau Teknisi.');
      const token = randomBytes(32).toString('hex');
      const age = 12 * 3600;
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(token, 'role:' + role, now + age * 1000);
      res.setHeader('Set-Cookie', tokenCookie(token, age));
      return send({ role });
    }
    const token = /(?:^|;\s*)k2c=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const session = token && sessions.get(token, Date.now());
    if (!session) fail('Pilih peran untuk melanjutkan.', 401);
    const user = { role: session.role, name: session.role === 'admin' ? 'Admin' : 'Teknisi' };
    if (req.method === 'POST' && path === '/api/logout') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(token);
      res.setHeader('Set-Cookie', tokenCookie('', 0));
      return send({});
    }
    if (req.method === 'GET' && path === '/api/state') {
      const state = JSON.parse(readState.get().body);
      for (const product of state.products) {
        product.reserved = reserved(state, product.id);
        product.inspection = inspection(state, product.id);
      }
      if (user.role !== 'admin') {
        state.purchases = [];
        state.movements = [];
        for (const p of state.products) for (const key of ['cost', 'retail', 'market']) delete p[key];
        state.sales = state.sales.filter(s => s.channel !== 'Toko');
        for (const sale of state.sales) {
          delete sale.settlement;
          for (const item of sale.items) {
            delete item.cost;
            delete item.price;
            for (const part of item.parts || []) delete part.cost;
          }
        }
      }
      return send({ user, ...state });
    }
    if (req.method === 'GET' && /^\/api\/evidence\/[a-f0-9-]{36}$/.test(path)) {
      const file = db.prepare('SELECT * FROM evidence WHERE id=?').get(path.split('/').at(-1));
      if (!file) fail('Bukti tidak ditemukan.', 404);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.name).replace(/'/g, '%27'), 'Content-Length': file.body.byteLength });
      return res.end(file.body);
    }
    if (req.method === 'POST' && path.startsWith('/api/action/')) {
      const action = path.split('/').at(-1);
      let input;
      const uploads = [];
      if (type.startsWith('multipart/form-data')) {
        const form = await request().formData();
        input = JSON.parse(form.get('payload'));
        const selected = form.getAll('proof');
        if (selected.length > 3) fail('Jumlah bukti tidak valid.');
        for (const file of selected) {
          if (!(file instanceof File) || !file.size) fail('File bukti kosong.');
          const kind = file.type.split(';')[0].toLowerCase();
          const body = Buffer.from(await file.arrayBuffer());
          if (kind.startsWith('video/')) {
            const boxSize = body.length >= 16 ? body.readUInt32BE(0) : 0;
            if (kind !== 'video/mp4' || !/\.mp4$/i.test(file.name) || boxSize < 16 || boxSize > body.length ||
                body.toString('ascii', 4, 8) !== 'ftyp' || body.toString('ascii', 8, 12) === 'qt  ') fail('Bukti video harus berupa file MP4.');
          } else if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(kind)) fail('Format bukti tidak didukung.');
          uploads.push({ id: randomUUID(), kind, name: file.name, body });
        }
      } else if (type.startsWith('application/json')) input = await request().json();
      else fail('Format permintaan tidak valid.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Data permintaan tidak valid.');
      if (uploads.length && !['ready', 'ship', 'return-evidence'].includes(action)) fail('Aksi ini tidak menerima unggahan.');
      const submission = req.headers['x-k2c-submission'];
      if (submission && !/^[a-f0-9-]{36}$/.test(submission)) fail('Referensi penyimpanan tidak valid.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (submission && !db.prepare('INSERT OR IGNORE INTO submissions VALUES (?, ?)').run(user.name, submission).changes) {
          db.exec('COMMIT');
          return send({ ok: true });
        }
        const state = JSON.parse(readState.get().body);
        apply(state, action, input, user, uploads);
        for (const f of uploads) db.prepare('INSERT INTO evidence VALUES (?, ?, ?, ?)').run(f.id, f.kind, f.name, f.body);
        writeState.run(JSON.stringify(state));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return send({ ok: true });
    }
    fail('Halaman tidak ditemukan.', 404);
  } catch (error) {
    const status = error.status ?? (error instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error(error);
    send({ error: status === 500 ? 'Terjadi gangguan saat menyimpan data.' : error.message }, status);
  }
});
const host = process.env.K2C_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
server.listen(port, host, () => console.log('K2C Management http://' + host + ':' + server.address().port));
