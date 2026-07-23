// Minimal TLS 1.3 client (RFC 8446) for Cloudflare Workers, driven over an
// arbitrary byte stream (a raw TCP socket, or a SOCKS5 tunnel). Exists because
// cloudflare:sockets startTls() sends the SNI of the connect() host and can't
// override it (verified: expectedServerHostname only affects cert validation,
// not the SNI byte), so it can't reach a Google-fronted host through a SOCKS
// proxy. Here WE build the ClientHello, so WE choose the SNI.
//
// Cipher suite: TLS_AES_128_GCM_SHA256, key share secp256r1 (P-256, Web Crypto
// native). The certificate chain is NOT validated: the transport is a SOCKS
// proxy the operator owns and the payload is a public R2 URL + a transcript, no
// secrets. (Add cert validation if that ever changes.)

const enc = new TextEncoder();
// crypto.subtle is typed as `any` here: at the Web Crypto boundary TS 5.7 fights
// over Uint8Array<ArrayBuffer> vs <ArrayBufferLike>/BufferSource, which is noise
// for a byte-level module. All values in/out are plain Uint8Array.
const subtle: any = crypto.subtle;

// ---- byte helpers ---------------------------------------------------------
function concat(arrs: Uint8Array[]): Uint8Array {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const be16 = (n: number) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const be24 = (n: number) => new Uint8Array([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const opq1 = (b: Uint8Array) => concat([new Uint8Array([b.length]), b]);
const opq2 = (b: Uint8Array) => concat([be16(b.length), b]);
const opq3 = (b: Uint8Array) => concat([be24(b.length), b]);

// ---- crypto primitives ----------------------------------------------------
async function sha256(b: Uint8Array): Promise<Uint8Array> { return new Uint8Array(await subtle.digest('SHA-256', b)); }
const SHA256_EMPTY_P = sha256(new Uint8Array(0));

async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []; let t: Uint8Array = new Uint8Array(0); let i = 1; let total = 0;
  while (total < length) { t = await hmac(prk, concat([t, info, new Uint8Array([i])])); chunks.push(t); total += t.length; i++; }
  return concat(chunks).slice(0, length);
}
function expandLabel(secret: Uint8Array, label: string, context: Uint8Array, length: number): Promise<Uint8Array> {
  const lbl = enc.encode('tls13 ' + label);
  return hkdfExpand(secret, concat([be16(length), opq1(lbl), opq1(context)]), length);
}
function deriveSecret(secret: Uint8Array, label: string, thash: Uint8Array): Promise<Uint8Array> { return expandLabel(secret, label, thash, 32); }

// ---- AEAD (AES-128-GCM) ---------------------------------------------------
function importAes(keyBytes: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
function nonce(iv: Uint8Array, seq: bigint): Uint8Array {
  const n = iv.slice();
  for (let i = 0; i < 8; i++) n[11 - i] ^= Number((seq >> BigInt(8 * i)) & 0xffn);
  return n;
}
type Aead = { key: CryptoKey; iv: Uint8Array; seq: bigint };
type Rec = { type: number; header: Uint8Array; payload: Uint8Array };

export class Tls13 {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private serverName: string;
  private inbuf: Uint8Array;
  private plain: Uint8Array = new Uint8Array(0);
  private cAP!: Aead;
  private sAP!: Aead;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>, serverName: string, initial?: Uint8Array) {
    this.reader = reader; this.writer = writer; this.serverName = serverName;
    this.inbuf = initial && initial.length ? initial : new Uint8Array(0);
  }

  private async _fill(n: number): Promise<void> {
    while (this.inbuf.length < n) {
      const { done, value } = await this.reader.read();
      if (done) throw new Error('tls: socket closed mid-record');
      this.inbuf = concat([this.inbuf, value]);
    }
  }
  private async _readRecord(): Promise<Rec> {
    await this._fill(5);
    const type = this.inbuf[0];
    const len = (this.inbuf[3] << 8) | this.inbuf[4];
    await this._fill(5 + len);
    const header = this.inbuf.slice(0, 5);
    const payload = this.inbuf.slice(5, 5 + len);
    this.inbuf = this.inbuf.slice(5 + len);
    return { type, header, payload };
  }
  private _write(bytes: Uint8Array): Promise<void> { return this.writer.write(bytes); }

  private async _seal(state: Aead, content: Uint8Array, contentType: number): Promise<Uint8Array> {
    const inner = concat([content, new Uint8Array([contentType])]);
    const header = concat([new Uint8Array([0x17, 0x03, 0x03]), be16(inner.length + 16)]);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce(state.iv, state.seq), additionalData: header, tagLength: 128 }, state.key, inner));
    state.seq++;
    return concat([header, ct]);
  }
  private async _open(state: Aead, header: Uint8Array, payload: Uint8Array): Promise<{ data: Uint8Array; contentType: number }> {
    const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce(state.iv, state.seq), additionalData: header, tagLength: 128 }, state.key, payload));
    state.seq++;
    let i = pt.length - 1;
    while (i >= 0 && pt[i] === 0) i--;
    return { data: pt.slice(0, i), contentType: pt[i] };
  }
  private async _keys(secret: Uint8Array): Promise<Aead> {
    return { key: await importAes(await expandLabel(secret, 'key', new Uint8Array(0), 16)), iv: await expandLabel(secret, 'iv', new Uint8Array(0), 12), seq: 0n };
  }

  async handshake(): Promise<void> {
    const eck = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const pub = new Uint8Array(await subtle.exportKey('raw', eck.publicKey));
    const random = crypto.getRandomValues(new Uint8Array(32));
    const sid = crypto.getRandomValues(new Uint8Array(32));
    const sni = enc.encode(this.serverName);
    const extSNI = concat([be16(0x0000), opq2(concat([be16(sni.length + 3), new Uint8Array([0x00]), opq2(sni)]))]);
    const extVers = concat([be16(0x002b), opq2(opq1(new Uint8Array([0x03, 0x04])))]);
    const extGroups = concat([be16(0x000a), opq2(opq2(be16(0x0017)))]);
    const extSigalgs = concat([be16(0x000d), opq2(opq2(concat([be16(0x0804), be16(0x0403), be16(0x0401)])))]);
    const extKeyShare = concat([be16(0x0033), opq2(opq2(concat([be16(0x0017), opq2(pub)])))]);
    const exts = concat([extVers, extGroups, extSigalgs, extKeyShare, extSNI]);
    const chBody = concat([new Uint8Array([0x03, 0x03]), random, opq1(sid), opq2(be16(0x1301)), opq1(new Uint8Array([0x00])), opq2(exts)]);
    const ch = concat([new Uint8Array([0x01]), opq3(chBody)]);
    const transcript: Uint8Array[] = [ch];
    await this._write(concat([new Uint8Array([0x16, 0x03, 0x01]), opq2(ch)]));

    let rec = await this._readRecord();
    while (rec.type === 0x14) rec = await this._readRecord();
    if (rec.type !== 0x16) throw new Error('tls: expected ServerHello, got ' + rec.type);
    const sh = rec.payload;
    transcript.push(sh);
    let serverPub: Uint8Array | null = null;
    {
      let p = 4 + 2 + 32;
      p += 1 + sh[p];
      p += 2 + 1;
      const extLen = (sh[p] << 8) | sh[p + 1]; p += 2;
      const end = p + extLen;
      while (p < end) {
        const et = (sh[p] << 8) | sh[p + 1]; const el = (sh[p + 2] << 8) | sh[p + 3]; p += 4;
        if (et === 0x0033) { const kl = (sh[p + 2] << 8) | sh[p + 3]; serverPub = sh.slice(p + 4, p + 4 + kl); }
        p += el;
      }
    }
    if (!serverPub) throw new Error('tls: no server key_share');

    const serverKey = await subtle.importKey('raw', serverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: serverKey }, eck.privateKey, 256));
    const z = new Uint8Array(32);
    const earlySecret = await hmac(z, z);
    const derived1 = await deriveSecret(earlySecret, 'derived', await SHA256_EMPTY_P);
    const hsSecret = await hmac(derived1, shared);
    const thashSH = await sha256(concat(transcript));
    const cHS = await deriveSecret(hsSecret, 'c hs traffic', thashSH);
    const sHS = await deriveSecret(hsSecret, 's hs traffic', thashSH);
    const cHSk = await this._keys(cHS);
    const sHSk = await this._keys(sHS);

    let hsbuf: Uint8Array = new Uint8Array(0);
    let sawFinished = false;
    while (!sawFinished) {
      const r = await this._readRecord();
      if (r.type === 0x14) continue;
      if (r.type !== 0x17) throw new Error('tls: expected encrypted handshake, got ' + r.type);
      const { data, contentType } = await this._open(sHSk, r.header, r.payload);
      if (contentType !== 0x16) throw new Error('tls: unexpected content type ' + contentType);
      hsbuf = concat([hsbuf, data]);
      while (hsbuf.length >= 4) {
        const mlen = (hsbuf[1] << 16) | (hsbuf[2] << 8) | hsbuf[3];
        if (hsbuf.length < 4 + mlen) break;
        const msg = hsbuf.slice(0, 4 + mlen);
        transcript.push(msg);
        if (msg[0] === 0x14) sawFinished = true;
        hsbuf = hsbuf.slice(4 + mlen);
      }
    }

    const thashSF = await sha256(concat(transcript));
    const cFinKey = await expandLabel(cHS, 'finished', new Uint8Array(0), 32);
    const verify = await hmac(cFinKey, thashSF);
    const finMsg = concat([new Uint8Array([0x14]), opq3(verify)]);
    await this._write(new Uint8Array([0x14, 0x03, 0x03, 0x00, 0x01, 0x01]));
    await this._write(await this._seal(cHSk, finMsg, 0x16));

    const derived2 = await deriveSecret(hsSecret, 'derived', await SHA256_EMPTY_P);
    const masterSecret = await hmac(derived2, z);
    this.cAP = await this._keys(await deriveSecret(masterSecret, 'c ap traffic', thashSF));
    this.sAP = await this._keys(await deriveSecret(masterSecret, 's ap traffic', thashSF));
  }

  async write(appBytes: Uint8Array): Promise<void> { await this._write(await this._seal(this.cAP, appBytes, 0x17)); }

  async read(): Promise<Uint8Array | null> {
    for (;;) {
      if (this.plain.length) { const out = this.plain; this.plain = new Uint8Array(0); return out; }
      let r: Rec;
      try { r = await this._readRecord(); } catch { return null; }
      if (r.type === 0x14) continue;
      if (r.type !== 0x17) throw new Error('tls: unexpected record type ' + r.type);
      const { data, contentType } = await this._open(this.sAP, r.header, r.payload);
      if (contentType === 0x15) return null;
      if (contentType === 0x16) continue;
      this.plain = data;
    }
  }
}
