// Common DB query fragments
export const VIDEO_COLS = 'v.*, c.name as category_name, c.slug as category_slug, c.color as category_color';
export const VIDEO_JOIN = 'FROM videos v LEFT JOIN categories c ON v.category_id = c.id WHERE v.enabled = 1';
export const VIDEO_WITH_SCHOLAR = `${VIDEO_COLS}, s.slug as scholar_slug, s.name as scholar_name, s.title as scholar_title, s.photo as scholar_photo`;
export const VIDEO_SCHOLAR_JOIN = 'FROM videos v LEFT JOIN categories c ON v.category_id = c.id LEFT JOIN scholars s ON v.scholar_id = s.id WHERE v.enabled = 1';

// D1 Sessions API helpers for read replication
// Reads go to nearest replica, writes go to primary

export function readDB(env) {
  // Read from nearest replica (fastest, may be slightly behind)
  return env.DB.withSession ? env.DB.withSession() : env.DB;
}

export function writeDB(env) {
  // Write to primary (consistent, always in WEUR)
  return env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
}
