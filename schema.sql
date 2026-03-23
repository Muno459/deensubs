DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS videos_fts;
DROP TABLE IF EXISTS videos;
DROP TABLE IF EXISTS categories;

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#c4a44c'
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  title_ar TEXT,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id),
  source TEXT,
  duration INTEGER DEFAULT 0,
  video_key TEXT NOT NULL,
  srt_key TEXT,
  thumb_key TEXT,
  views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE videos_fts USING fts5(title, description, source, content=videos, content_rowid=id);

CREATE TRIGGER videos_ai AFTER INSERT ON videos BEGIN
  INSERT INTO videos_fts(rowid, title, description, source) VALUES (new.id, new.title, new.description, new.source);
END;
CREATE TRIGGER videos_ad AFTER DELETE ON videos BEGIN
  INSERT INTO videos_fts(videos_fts, rowid, title, description, source) VALUES ('delete', old.id, old.title, old.description, old.source);
END;

CREATE INDEX idx_videos_category ON videos(category_id);
CREATE INDEX idx_videos_created ON videos(created_at DESC);
CREATE INDEX idx_comments_video ON comments(video_id);

INSERT INTO categories (name, name_ar, slug, color) VALUES
  ('Khutbah', 'خطبة', 'khutbah', '#c4a44c'),
  ('Lecture', 'محاضرة', 'lecture', '#4c8ac4'),
  ('Tafsir', 'تفسير', 'tafsir', '#4ca476'),
  ('Hadith', 'حديث', 'hadith', '#8a4cc4'),
  ('Fiqh', 'فقه', 'fiqh', '#4cb4a4'),
  ('Seerah', 'سيرة', 'seerah', '#c44c6e'),
  ('Reminder', 'تذكير', 'reminder', '#c48a4c');

INSERT INTO videos (title, title_ar, slug, description, category_id, source, duration, video_key, srt_key, thumb_key) VALUES
  ('1st Shawwal Jumuah Khutbah', 'خطبة الجمعة ١ شوّال', '1st-shawwal-jumuah-khutbah',
   'Jumuah Khutbah delivered at Masjid al-Haram on the 1st of Shawwal. The Imam speaks about gratitude for the blessings of Allah, the importance of taqwa, and rejoicing in what He has allotted for the believers.',
   1, 'Masjid al-Haram, Makkah', 1860,
   'videos/1st-shawwal-jumuah-khutbah.mp4', 'subs/1st-shawwal-jumuah-khutbah.srt', 'thumbs/1st-shawwal-jumuah-khutbah.jpg');
