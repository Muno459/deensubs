CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
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
  views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO categories (name, name_ar, slug) VALUES
  ('Khutbah', 'خطبة', 'khutbah'),
  ('Lecture', 'محاضرة', 'lecture'),
  ('Tafsir', 'تفسير', 'tafsir'),
  ('Hadith', 'حديث', 'hadith'),
  ('Fiqh', 'فقه', 'fiqh'),
  ('Seerah', 'سيرة', 'seerah'),
  ('Reminder', 'تذكير', 'reminder');

INSERT INTO videos (title, title_ar, slug, description, category_id, source, video_key, srt_key, views) VALUES
  ('1st Shawwal Jumuah Khutbah', 'خطبة الجمعة ١ شوّال', '1st-shawwal-jumuah-khutbah',
   'Jumuah Khutbah delivered at Masjid al-Haram on the 1st of Shawwal. The Imam speaks about gratitude for the blessings of Allah, the importance of taqwa, and rejoicing in what He has allotted for the believers.',
   1, 'Masjid al-Haram, Makkah', 'videos/1st-shawwal-jumuah-khutbah.mp4', 'subs/1st-shawwal-jumuah-khutbah.srt', 0);
