import { Hono } from 'hono';
import { getCookie, genId } from '../middleware/auth.js';

const auth = new Hono();

// Only allow post-login redirects back to deensubs.com or its subdomains
function safeRedirect(target) {
  try {
    const u = new URL(target);
    if (u.protocol === 'https:' && (u.hostname === 'deensubs.com' || u.hostname.endsWith('.deensubs.com'))) {
      return u.toString();
    }
  } catch {}
  return '/';
}

auth.get('/auth/google', (c) => {
  const redirect_uri = new URL(c.req.url).origin + '/auth/callback';
  const params = {
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  };
  // Carry an optional return URL (e.g. admin.deensubs.com) through OAuth state.
  // The native app passes ?app=1 and gets handed back via its URL scheme instead.
  const redirect = c.req.query('redirect');
  if (c.req.query('app') === '1') params.state = 'app';
  else if (redirect) params.state = safeRedirect(redirect);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(params);
  return c.redirect(url);
});

auth.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.redirect('/');
  const redirect_uri = new URL(c.req.url).origin + '/auth/callback';

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.access_token) return c.redirect('/');

  // Get user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + tokens.access_token },
  });
  const guser = await userRes.json();
  if (!guser.id || !guser.email) return c.redirect('/');

  // Upsert user
  const db = c.env.DB;
  let user = await db.prepare('SELECT id FROM users WHERE google_id = ?').bind(guser.id).first();
  if (!user) {
    const r = await db.prepare('INSERT INTO users (google_id, email, name, avatar) VALUES (?, ?, ?, ?)').bind(guser.id, guser.email, guser.name || guser.email, guser.picture || '').run();
    user = { id: r.meta.last_row_id };
  } else {
    await db.prepare('UPDATE users SET name = ?, avatar = ?, email = ? WHERE google_id = ?').bind(guser.name || guser.email, guser.picture || '', guser.email, guser.id).run();
  }

  // Create session (30 days)
  const sid = genId();
  await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").bind(sid, user.id).run();

  const state = c.req.query('state');

  // Native app flow: hand the session over via a short-lived one-time code
  // instead of a browser cookie the app can't reach.
  if (state === 'app') {
    const code = genId();
    await c.env.CACHE.put('appx:' + code, sid, { expirationTtl: 120 });
    return c.redirect('deensubs://auth?code=' + code);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: state ? safeRedirect(state) : '/',
      // Domain-wide so admin.deensubs.com shares the session
      'Set-Cookie': `sid=${sid}; Domain=.deensubs.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
});

// Exchange the one-time code from the app OAuth flow for the session cookie
auth.post('/auth/app-exchange', async (c) => {
  const { code } = await c.req.json().catch(() => ({}));
  if (!code || typeof code !== 'string') return c.json({ error: 'Missing code' }, 400);
  const key = 'appx:' + code;
  const sid = await c.env.CACHE.get(key);
  if (!sid) return c.json({ error: 'Invalid or expired code' }, 401);
  await c.env.CACHE.delete(key);

  const db = c.env.DB.withSession ? c.env.DB.withSession() : c.env.DB;
  const row = await db.prepare(
    "SELECT u.id, u.name, u.email, u.avatar, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime('now')"
  ).bind(sid).first();
  if (!row) return c.json({ error: 'Session not found' }, 401);

  return new Response(JSON.stringify({ user: row }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `sid=${sid}; Domain=.deensubs.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
});

auth.get('/auth/logout', async (c) => {
  const sid = getCookie(c, 'sid');
  if (sid) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    try { await c.env.CACHE.delete('session:' + sid); } catch {}
  }
  // Clear both the new domain-wide cookie and the legacy host-only one
  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', 'sid=; Domain=.deensubs.com; Path=/; HttpOnly; Secure; Max-Age=0');
  headers.append('Set-Cookie', 'sid=; Path=/; HttpOnly; Secure; Max-Age=0');
  return new Response(null, { status: 302, headers });
});

// ── Sign in with Apple (native iOS) ──
// The app performs the Apple flow natively and POSTs the resulting identity
// token (a JWT signed by Apple). We verify it against Apple's public keys,
// then mint the same session cookie the rest of the site uses.
const APPLE_AUD = 'deensubs.deensubs'; // iOS bundle identifier

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyAppleToken(env, idToken) {
  const [headerB64, payloadB64, sigB64] = idToken.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));

  // Apple's signing keys rotate; cache the JWKS briefly.
  let jwks = await env.CACHE.get('apple:jwks', 'json');
  if (!jwks) {
    jwks = await (await fetch('https://appleid.apple.com/auth/keys')).json();
    await env.CACHE.put('apple:jwks', JSON.stringify(jwks), { expirationTtl: 3600 });
  }
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(headerB64 + '.' + payloadB64)
  );
  if (!ok) throw new Error('Bad signature');

  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  if (claims.iss !== 'https://appleid.apple.com') throw new Error('Bad issuer');
  if (claims.aud !== APPLE_AUD) throw new Error('Bad audience');
  if (claims.exp * 1000 < Date.now()) throw new Error('Token expired');
  return claims;
}

auth.post('/auth/apple', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid request' }, 400); }
  const { identityToken, name } = body;
  if (!identityToken) return c.json({ error: 'Missing token' }, 400);

  let claims;
  try {
    claims = await verifyAppleToken(c.env, identityToken);
  } catch (e) {
    return c.json({ error: 'Verification failed' }, 401);
  }
  if (!claims.sub) return c.json({ error: 'Invalid token' }, 401);

  // Namespace Apple's subject so it never collides with a Google sub.
  const providerId = 'apple:' + claims.sub;
  const email = claims.email || '';
  const db = c.env.DB;
  let user = await db.prepare('SELECT id, name FROM users WHERE google_id = ?').bind(providerId).first();
  if (!user) {
    // Apple only sends the name on the very first authorization.
    const displayName = (name && name.trim()) || (email ? email.split('@')[0] : 'DeenSubs User');
    const r = await db.prepare('INSERT INTO users (google_id, email, name, avatar) VALUES (?, ?, ?, ?)').bind(providerId, email, displayName, '').run();
    user = { id: r.meta.last_row_id, name: displayName };
  } else if (email) {
    await db.prepare('UPDATE users SET email = ? WHERE google_id = ?').bind(email, providerId).run();
  }

  const sid = genId();
  await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").bind(sid, user.id).run();
  const row = await db.prepare('SELECT id, name, email, avatar, role FROM users WHERE id = ?').bind(user.id).first();

  return new Response(JSON.stringify({ user: row }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `sid=${sid}; Domain=.deensubs.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
});

auth.post('/auth/onetap', async (c) => {
  const { credential } = await c.req.json();
  if (!credential) return c.json({ error: 'Missing credential' }, 400);

  // Decode JWT payload (Google One Tap sends a signed JWT)
  const parts = credential.split('.');
  if (parts.length !== 3) return c.json({ error: 'Invalid token' }, 400);
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

  if (!payload.sub || !payload.email) return c.json({ error: 'Invalid payload' }, 400);

  // Upsert user
  const db = c.env.DB;
  let user = await db.prepare('SELECT id FROM users WHERE google_id = ?').bind(payload.sub).first();
  if (!user) {
    const r = await db.prepare('INSERT INTO users (google_id, email, name, avatar) VALUES (?, ?, ?, ?)').bind(payload.sub, payload.email, payload.name || payload.email, payload.picture || '').run();
    user = { id: r.meta.last_row_id };
  } else {
    await db.prepare('UPDATE users SET name = ?, avatar = ?, email = ? WHERE google_id = ?').bind(payload.name || payload.email, payload.picture || '', payload.email, payload.sub).run();
  }

  const sid = genId();
  await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").bind(sid, user.id).run();

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `sid=${sid}; Domain=.deensubs.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
});

export default auth;
