export function getCookie(c, name) {
  const cookies = c.req.header('Cookie') || '';
  const match = cookies.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

export function genId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  for (const b of arr) id += chars[b % chars.length];
  return id;
}

export async function getUser(c) {
  const sid = getCookie(c, 'sid');
  if (!sid) return null;
  const session = await c.env.DB.prepare(
    "SELECT s.*, u.id as uid, u.name, u.email, u.avatar, u.google_id FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime('now')"
  ).bind(sid).first();
  return session ? { id: session.uid, name: session.name, email: session.email, avatar: session.avatar } : null;
}

export async function authMiddleware(c, next) {
  c.set('user', await getUser(c));
  await next();
}
