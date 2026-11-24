import { DurableObject } from 'cloudflare:workers';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const enc = new TextEncoder();
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (salt, ikm, info, len) => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
};

// RFC 8291 (aes128gcm) payload encryption
async function encrypt(sub, text) {
  const uaPub = b64d(sub.keys.p256dh), auth = b64d(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(86); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65; head.set(asPub, 21);
  return cat(head, ct);
}

export class Hub extends DurableObject {
  async vapid() {
    let v = await this.ctx.storage.get('vapid');
    if (!v) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      v = { pub: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
      await this.ctx.storage.put('vapid', v);
    }
    return v;
  }
  async push(sub, payload) {
    const v = await this.vapid();
    const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(sub.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:migym.avisos@gmail.com' })));
    const pk = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pk, enc.encode(head + '.' + claims)));
    const r = await fetch(sub.endpoint, { method: 'POST', body: await encrypt(sub, JSON.stringify(payload)), headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '120', Urgency: 'high',
      Authorization: `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.pub}` } });
    this.last = { status: r.status, reason: r.ok ? '' : (await r.text()).slice(0, 200) };
    if (!r.ok) console.log('push', r.status, this.last.reason);
    return r.status;
  }
  async timers() { return (await this.ctx.storage.get('timers')) || {}; }
  async save(t) {
    await this.ctx.storage.put('timers', t);
    const next = Math.min(...Object.values(t).map(x => x.at));
    if (isFinite(next)) await this.ctx.storage.setAlarm(next); else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const t = await this.timers(), now = Date.now() + 500;
    for (const [k, x] of Object.entries(t)) if (x.at <= now) { delete t[k]; await this.push(x.sub, { title: x.title, body: x.body }); }
    await this.save(t);
  }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/key') return json({ publicKey: (await this.vapid()).pub });
    if (req.method !== 'POST') return json({ ok: true, app: 'Mi Gym avisos' });
    const b = JSON.parse(await req.text() || '{}');
    if (path === '/test') { await this.push(b.sub, { title: 'Mi Gym', body: 'Los avisos de descanso están activados ✓' }); return json(this.last); }
    const t = await this.timers();
    if (path === '/schedule') { t[b.sub.endpoint] = { sub: b.sub, at: Math.max(Date.now() + 1000, +b.at), title: b.title || 'Descanso terminado', body: b.body || '' }; await this.save(t); return json({ ok: true }); }
    if (path === '/cancel') { delete t[b.endpoint]; await this.save(t); return json({ ok: true }); }
    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
  },
};
