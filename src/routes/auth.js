import { Hono } from 'hono';
import { getCookie, genId } from '../middleware/auth.js';

const auth = new Hono();

auth.get('/auth/google', (c) => {
  const redirect_uri = new URL(c.req.url).origin + '/auth/callback';
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  });
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

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
});

auth.get('/auth/logout', async (c) => {
  const sid = getCookie(c, 'sid');
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': 'sid=; Path=/; HttpOnly; Secure; Max-Age=0',
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
      'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
});

export default auth;
