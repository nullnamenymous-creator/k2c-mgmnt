import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { apply, fail, inspection, reserved } from '../operations.mjs';

const limit = 45 * 1024 ** 2;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const proofTypes = { ready: ['video'], ship: ['image'], 'return-evidence': ['image','image','video'] };

function equal(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const reply = (data, status = 200) => res.status(status).json(data);
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secret = process.env.SUPABASE_SECRET_KEY;
  const access = process.env.K2C_CLOUD_ACCESS_KEY;
  if (!base || !secret || !access || access.length < 32) return reply({ error: 'Konfigurasi cloud K2C belum lengkap.' }, 503);
  const body = req.body ?? {};
  const url = new URL(req.url, 'https://' + req.headers.host);
  const route = url.searchParams.get('route') || url.pathname.slice('/api/'.length);
  const bucket = 'k2c-evidence';
  const cookie = (token, age) => 'k2c_cloud=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + age;
  function sign(data) {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return payload + '.' + createHmac('sha256', access).update(payload).digest('base64url');
  }
  function verify(token) {
    const [payload, mac] = String(token || '').split('.');
    if (!payload || !equal(signToken(payload), mac)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  }
  function signToken(payload) {
    return createHmac('sha256', access).update(payload).digest('base64url');
  }
  async function upstream(path, options = {}) {
    const headers = { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: 'Bearer ' + secret } : {}), ...options.headers };
    const response = await fetch(base + path, { ...options, headers });
    if (!response.ok) {
      await response.body?.cancel();
      fail('Penyimpanan cloud belum bisa diakses. Coba lagi.', 502);
    }
    return response;
  }
  const requestJson = async (path, data) => (await upstream(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  })).json();
  async function snapshot() {
    const [row] = await (await upstream('/rest/v1/k2c_state?id=eq.1&select=revision,body')).json();
    if (!row) fail('Database cloud belum diinisialisasi.', 503);
    return row;
  }
  function validateFile(file, kind) {
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 200 ||
        !Number.isInteger(file.size) || file.size < 1 || file.size > limit) fail('Ukuran atau nama bukti tidak valid. Maksimum 45 MB per file.');
    if (kind === 'video' && (file.kind !== 'video/mp4' || !/\.mp4$/i.test(file.name))) fail('Video harus MP4.');
    if (kind === 'image' && !/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.kind)) fail('Foto tidak didukung.');
  }

  try {
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== url.origin) fail('Asal permintaan tidak valid.', 403);
    const previous = verify(/(?:^|;\s*)k2c_cloud=([^;]+)/.exec(req.headers.cookie || '')?.[1]);
    const session = previous?.purpose === 'session' ? previous : null;
    if (req.method === 'POST' && route === 'role') {
      if (!session && !equal(req.headers['x-k2c-access'], access)) fail('Buka tautan akses K2C yang diberikan pengelola.', 401);
      if (!['admin','teknisi'].includes(body.role)) fail('Pilih Admin atau Teknisi.');
      const age = 12 * 3600;
      res.setHeader('Set-Cookie', cookie(sign({ purpose: 'session', id: randomUUID(), role: body.role, exp: Date.now() + age * 1000 }), age));
      return reply({ role: body.role });
    }
    if (!session) fail('Pilih peran untuk melanjutkan.', 401);
    const user = { role: session.role, name: session.role === 'admin' ? 'Admin' : 'Teknisi' };
    if (req.method === 'POST' && route === 'logout') {
      res.setHeader('Set-Cookie', cookie('', 0));
      return reply({});
    }
    if (req.method === 'GET' && route === 'state') {
      const { body: state } = await snapshot();
      for (const p of state.products) {
        p.reserved = reserved(state, p.id);
        p.inspection = inspection(state, p.id);
        if (user.role === 'teknisi') for (const key of ['cost','retail','market']) delete p[key];
      }
      if (user.role === 'teknisi') {
        state.purchases = [];
        delete state.suppliers;
        state.movements = [];
        state.sales = state.sales.filter(sale => sale.channel !== 'Toko');
        for (const sale of state.sales) {
          delete sale.settlement;
          for (const item of sale.items) {
            delete item.cost;
            delete item.price;
            for (const part of [...(item.parts || []), ...(item.components || [])]) delete part.cost;
          }
        }
      }
      return reply({ user, ...state, cloudUploads: true, uploadLimit: limit });
    }
    if (req.method === 'GET' && route.startsWith('evidence/')) {
      const id = route.slice(9);
      if (!uuid.test(id)) fail('Bukti tidak ditemukan.', 404);
      const { body: state } = await snapshot();
      const evidence = state.sales.flatMap(sale => sale.evidence).find(item => item.id === id);
      if (!evidence) fail('Bukti tidak ditemukan.', 404);
      const signed = await requestJson('/storage/v1/object/sign/' + bucket + '/' + id, { expiresIn: 120 });
      const download = new URL(base + '/storage/v1' + signed.signedURL);
      download.searchParams.set('download', evidence.name);
      res.setHeader('Location', download.href);
      return res.status(302).end();
    }
    if (req.method === 'POST' && route === 'upload') {
      const kinds = proofTypes[body.action];
      if (!kinds || !Array.isArray(body.files) || body.files.length !== kinds.length || !uuid.test(body.id || '')) fail('Permintaan unggahan tidak valid.');
      const { body: state } = await snapshot();
      const files = body.files.map((file, index) => {
        validateFile(file, kinds[index]);
        return { id: randomUUID(), name: file.name, size: file.size, kind: file.kind };
      });
      apply(state, body.action, { id: body.id, tracking: body.tracking, skipQc: body.skipQc }, user, files);
      const urls = await Promise.all(files.map(async file => {
        const signed = await requestJson('/storage/v1/object/upload/sign/' + bucket + '/' + file.id, {});
        return base + '/storage/v1' + signed.url;
      }));
      return reply({ urls, ticket: sign({ purpose: 'upload', session: session.id, action: body.action, order: body.id, files, exp: Date.now() + 30 * 60 * 1000 }) });
    }
    if (req.method === 'POST' && route.startsWith('action/')) {
      const action = route.slice(7);
      const token = req.headers['x-k2c-submission'];
      if (!uuid.test(token || '')) fail('Referensi penyimpanan tidak valid.');
      const prior = await (await upstream('/rest/v1/k2c_submissions?select=token&session_id=eq.' + session.id + '&token=eq.' + token)).json();
      if (prior.length) return reply({ ok: true });
      let files = [];
      if (Object.hasOwn(proofTypes, action) && !(action === 'ship' && body.skipHandover === 'yes' && !body.ticket)) {
        const ticket = verify(body.ticket);
        if (ticket?.purpose !== 'upload' || ticket.session !== session.id || ticket.action !== action || ticket.order !== body.id) fail('Sesi unggahan berakhir. Coba simpan lagi.');
        files = ticket.files;
        await Promise.all(files.map(async file => {
          const object = '/storage/v1/object/authenticated/' + bucket + '/' + file.id;
          const head = await upstream(object, { method: 'HEAD' });
          if (Number(head.headers.get('content-length')) !== file.size || head.headers.get('content-type')?.split(';')[0] !== file.kind) fail('File bukti belum tersimpan dengan benar.');
          if (file.kind === 'video/mp4') {
            const response = await upstream(object, { headers: { Range: 'bytes=0-15' } });
            const reader = response.body.getReader();
            const prefix = Buffer.alloc(16);
            let written = 0;
            try {
              while (written < prefix.length) {
                const part = await reader.read();
                if (part.done) break;
                const chunk = Buffer.from(part.value);
                written += chunk.copy(prefix, written, 0, prefix.length - written);
              }
            } finally {
              await reader.cancel();
            }
            if (written < 16 || prefix.toString('ascii', 4, 8) !== 'ftyp' || prefix.toString('ascii', 8, 12) === 'qt  ' || prefix.readUInt32BE(0) < 16 || prefix.readUInt32BE(0) > file.size) fail('Bukti video harus berupa MP4.');
          }
        }));
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const { revision, body: state } = await snapshot();
        try {
          apply(state, action, body, user, files);
        } catch (error) {
          const accepted = await (await upstream('/rest/v1/k2c_submissions?select=token&session_id=eq.' + session.id + '&token=eq.' + token)).json();
          if (accepted.length) return reply({ ok: true });
          throw error;
        }
        const outcome = await requestJson('/rest/v1/rpc/k2c_commit', { expected_revision: revision, next_body: state, client_session: session.id, client_token: token });
        if (outcome === 'saved' || outcome === 'duplicate') return reply({ ok: true });
      }
      fail('Data sedang berubah. Coba simpan lagi.', 409);
    }
    fail('Halaman tidak ditemukan.', 404);
  } catch (error) {
    if (!error.status) console.error(error.name);
    return reply({ error: error.status ? error.message : 'Terjadi gangguan pada layanan cloud.' }, error.status || 500);
  }
}
