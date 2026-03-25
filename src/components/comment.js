import { e, ago, avatarColor } from '../lib/helpers.js';

export function commentHTML(c) {
  const initials = e(c.author).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const col = avatarColor(c.author);
  return `<div class="cm"><div class="cm-av" style="background:${col}">${initials}</div><div class="cm-body"><div class="cm-h"><strong>${e(c.author)}</strong><time>${ago(c.created_at)}</time></div><p>${e(c.content)}</p></div></div>`;
}
