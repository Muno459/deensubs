// Shared types for the Scribe pipeline (download → ASR → translate → SRT)

export type ScribeEnv = {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  MYBROWSER: Fetcher; // Cloudflare Browser Rendering (primary YouTube download)
  YTDLP: DurableObjectNamespace; // container: mux fallback + grade/clips/thumbs (NOT download)
  ELEVENLABS_API_KEY?: string;
  SCRIBE_LLM_URL?: string;
  SCRIBE_LLM_KEY?: string;
  SCRIBE_LLM_MODEL?: string;
  YTDLP_TOKEN?: string;
  YTDLP_PROXIES?: string;
};

/** One word from ElevenLabs Scribe with timestamps (seconds). */
export type Word = {
  text: string;
  start: number;
  end: number;
  type?: string; // 'word' | 'spacing' | 'audio_event'
  speaker_id?: string;
};

/** A subtitle cue addressed by word indices into the clean word list. */
export type Cue = {
  start: number; // seconds, from words[w0].start
  end: number; // seconds, from words[w1].end
  text: string; // translated text
  source: string; // original-language text (joined words)
  q?: string; // Quran verse key ("2:255") — canonical LOCKED cue, never LLM-edited
};

export type AsrResult = {
  asrKey: string;
  languageCode: string;
  wordCount: number;
  durationSec: number;
};

export type DownloadResult = {
  key: string;
  method: 'direct' | 'yt-dlp' | 'browser';
  /** Full-video only: separate video+audio keys handed to the encoder to mux. */
  videoKey?: string;
  audioKey?: string;
  contentType: string;
  bytes: number;
  title?: string;
  channel?: string;
  thumbUrl?: string;
  durationSec?: number;
  description?: string;
  channelId?: string;
  ytId?: string;
  /** Source has formats above 1080p — upgradable by the local 4K encoder queue. */
  fourK?: boolean;
};

/** Update a scribe_jobs row. */
export async function updateJob(
  db: D1Database,
  id: string,
  fields: Record<string, string | number | null>
): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  await db
    .prepare(`UPDATE scribe_jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...keys.map((k) => fields[k]), id)
    .run();
}
