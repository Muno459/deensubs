// Common DB query fragments
export const VIDEO_COLS = 'v.*, c.name as category_name, c.slug as category_slug, c.color as category_color';
export const VIDEO_JOIN = 'FROM videos v LEFT JOIN categories c ON v.category_id = c.id';
export const VIDEO_WITH_SCHOLAR = `${VIDEO_COLS}, s.slug as scholar_slug, s.name as scholar_name, s.title as scholar_title, s.photo as scholar_photo`;
export const VIDEO_SCHOLAR_JOIN = `${VIDEO_JOIN} LEFT JOIN scholars s ON v.scholar_id = s.id`;
