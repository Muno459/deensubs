// The Scribe pipeline as a Cloudflare Workflow: durable, retried, resumable.
// Heavy artifacts live in R2; stage timestamps + cost telemetry in D1.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { download } from './download';
import { runAsr, loadAsr } from './asr';
import { translateWords, qaPass, takeUsage } from './translate';
import { generateMetadata, generateChapters } from './metadata';
import { generateThumbCandidates } from './publish';
import { assessQuality } from './quality';
import { renderSrt } from './srt';
import { updateJob, type Cue, type ScribeEnv } from './types';

export type ScribeParams = {
  jobId: string;
  url: string;
  targetLang: string; // primary target
  targetLangs?: string[]; // full list incl. primary
  fullVideo?: boolean;
};

/** Atomically stamp a stage timestamp via SQL json_patch — no read-modify-write
 * race between concurrent instances. Keep-first unless force: real work restamps
 * its own start/end; cache-hit replays leave prior timings untouched. */
async function stampTime(env: ScribeEnv, jobId: string, key: string, force = true) {
  await env.DB.prepare(
    `UPDATE scribe_jobs SET stage_times = CASE
       WHEN ?1 = 1 OR json_extract(COALESCE(stage_times, '{}'), ?2) IS NULL
       THEN json_patch(COALESCE(stage_times, '{}'), ?3)
       ELSE stage_times END
     WHERE id = ?4`
  ).bind(force ? 1 : 0, '$.' + key, JSON.stringify({ [key]: new Date().toISOString() }), jobId).run();
}

async function markStage(env: ScribeEnv, jobId: string, stage: string, extra: Record<string, any> = {}) {
  await stampTime(env, jobId, stage, false);
  await updateJob(env.DB, jobId, { step: stage, error: null, ...extra });
}

async function addTokens(env: ScribeEnv, jobId: string, tokens: number) {
  if (tokens > 0) {
    await env.DB.prepare('UPDATE scribe_jobs SET llm_tokens = llm_tokens + ? WHERE id = ?').bind(tokens, jobId).run();
  }
}

export class ScribePipeline extends WorkflowEntrypoint<ScribeEnv, ScribeParams> {
  async run(event: WorkflowEvent<ScribeParams>, step: WorkflowStep) {
    const { jobId, url, fullVideo } = event.payload;
    const langs = event.payload.targetLangs?.length ? event.payload.targetLangs : [event.payload.targetLang];
    const primary = langs[0];
    const env = this.env;

    try {
      // 1. Download → R2
      await updateJob(env.DB, jobId, { status: 'running' });
      await markStage(env, jobId, 'download');
      // Retries are patient on purpose: a big playlist batch can exhaust the
      // container max_instances cap, and jobs must wait out the contention
      // (~35 min of linear backoff) rather than fail.
      const dl = await step.do(
        'download',
        { retries: { limit: 6, delay: '90 seconds', backoff: 'linear' }, timeout: '30 minutes' },
        async () => {
          // Resume: reuse the already-downloaded source if it exists
          const row: any = await env.DB.prepare('SELECT source_key, download_method, duration, title, channel, thumb_url FROM scribe_jobs WHERE id = ?').bind(jobId).first();
          if (row?.source_key && (await env.MEDIA_BUCKET.head(row.source_key))) {
            return {
              key: row.source_key, method: (row.download_method || 'direct') as any,
              contentType: '', bytes: 0, title: row.title, channel: row.channel,
              thumbUrl: row.thumb_url, durationSec: row.duration || 0, cached: true,
            };
          }
          await stampTime(env, jobId, 'download');
          const res = await download(env, jobId, url, !!fullVideo);
          await stampTime(env, jobId, 'download_end');
          return { ...res, cached: false };
        }
      );
      const row: any = await env.DB.prepare('SELECT title, channel, thumb_url, yt_id, orig_description, channel_image_key FROM scribe_jobs WHERE id = ?').bind(jobId).first();
      const ytId = row?.yt_id || (dl as any).ytId ||
        (url.match(/(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/(?:shorts|live|embed)\/)([\w-]{11})/) || [])[1] || null;
      await markStage(env, jobId, 'asr', {
        source_key: dl.key,
        download_method: dl.method,
        download_pct: 100,
        title: row?.title || dl.title || null,
        channel: row?.channel || dl.channel || null,
        thumb_url: row?.thumb_url || dl.thumbUrl || null,
        duration: dl.durationSec || 0,
        yt_id: ytId,
        orig_description: row?.orig_description || (dl as any).description || null,
      });
      // Channel avatar → R2 (shared per channel, fetched once), best-effort
      if ((dl as any).channelId && !row?.channel_image_key) {
        try {
          const chKey = `channels/${(dl as any).channelId}.jpg`;
          if (!(await env.MEDIA_BUCKET.head(chKey))) {
            const page = await fetch(`https://www.youtube.com/channel/${(dl as any).channelId}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
            });
            const html = await page.text();
            const m = html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:image"/);
            if (m) {
              const img = await fetch(m[1]);
              if (img.ok) await env.MEDIA_BUCKET.put(chKey, await img.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } });
            }
          }
          if (await env.MEDIA_BUCKET.head(chKey)) await updateJob(env.DB, jobId, { channel_image_key: chKey });
        } catch {}
      }

      // 2. ASR (ElevenLabs Scribe v2; chunked automatically for long files)
      const asr = await step.do(
        'asr',
        { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '60 minutes' },
        async () => {
          const asrKey = `scribe/${jobId}/asr.json`;
          const existing = await env.MEDIA_BUCKET.get(asrKey);
          if (existing) {
            const data: any = await existing.json();
            const words = (data.words || []).filter((w: any) => (w.type || 'word') === 'word');
            if (words.length) {
              return {
                asrKey, languageCode: data.language_code || '',
                wordCount: words.length,
                durationSec: data.audio_duration_secs || words[words.length - 1].end || 0,
                cached: true,
              };
            }
          }
          await stampTime(env, jobId, 'asr');
          const res = await runAsr(env, jobId, dl.key, dl.durationSec || 0);
          await stampTime(env, jobId, 'asr_end');
          return { ...res, cached: false };
        }
      );
      await markStage(env, jobId, 'translate', {
        asr_key: asr.asrKey,
        language_code: asr.languageCode,
        duration: asr.durationSec,
        asr_seconds: asr.durationSec,
        target_langs: JSON.stringify(langs),
      });

      // 3. Translate — one pass per target language (primary first)
      let primaryCueCount = 0;
      let anyFresh = false;
      for (const lang of langs) {
        const cuesKey = lang === primary ? `scribe/${jobId}/cues.json` : `scribe/${jobId}/cues.${lang}.json`;
        const tr = await step.do(
          `translate-${lang}`,
          { retries: { limit: 4, delay: '1 minute', backoff: 'exponential' }, timeout: '45 minutes' },
          async () => {
            const existing = await env.MEDIA_BUCKET.get(cuesKey);
            if (existing) {
              const cues: any[] = await existing.json();
              if (cues.length) return { cuesKey, cueCount: cues.length, tokens: 0, cached: true };
            }
            if (lang === primary) await stampTime(env, jobId, 'translate');
            const data = await loadAsr(env, asr.asrKey);
            const cues = await translateWords(env, data.words, lang);
            await env.MEDIA_BUCKET.put(cuesKey, JSON.stringify(cues), {
              httpMetadata: { contentType: 'application/json' },
            });
            return { cuesKey, cueCount: cues.length, tokens: takeUsage(), cached: false };
          }
        );
        await addTokens(env, jobId, tr.tokens);
        if (!tr.cached) anyFresh = true;

        // Netflix QA repair pass (skipped when cues came from a finished run)
        if (!tr.cached) {
          const qa = await step.do(
            `qa-${lang}`,
            { retries: { limit: 1, delay: '30 seconds' }, timeout: '30 minutes' },
            async () => {
              const obj = await env.MEDIA_BUCKET.get(cuesKey);
              if (!obj) throw new Error('cues missing for QA');
              const cues = await obj.json<Cue[]>();
              const repaired = await qaPass(env, cues, lang);
              await env.MEDIA_BUCKET.put(cuesKey, JSON.stringify(repaired.cues), {
                httpMetadata: { contentType: 'application/json' },
              });
              return { fixes: repaired.fixes, tokens: takeUsage() };
            }
          );
          await addTokens(env, jobId, qa.tokens);
        }

        if (lang === primary) {
          primaryCueCount = tr.cueCount;
          await updateJob(env.DB, jobId, { cue_count: tr.cueCount });
          // Quality report: mechanical metrics + cross-lingual semantic audit
          const qKey = `scribe/${jobId}/quality.json`;
          if (!tr.cached || !(await env.MEDIA_BUCKET.head(qKey))) {
            await step.do('quality', { retries: { limit: 1, delay: '30 seconds' }, timeout: '15 minutes' }, async () => {
              try {
                const r = await assessQuality(env as any, jobId, cuesKey);
                return { grade: r.grade, score: r.score, flagged: r.flags.length };
              } catch (e: any) {
                return { error: String(e?.message || e).slice(0, 200) };
              }
            });
          }
        }
      }
      await markStage(env, jobId, 'render');

      // 4. Render SRT files (per language) + source SRT once
      const out = await step.do('render', async () => {
        let srtKey = '';
        for (const lang of langs) {
          const cuesKey = lang === primary ? `scribe/${jobId}/cues.json` : `scribe/${jobId}/cues.${lang}.json`;
          const obj = await env.MEDIA_BUCKET.get(cuesKey);
          if (!obj) throw new Error('cues missing: ' + cuesKey);
          const cues = await obj.json<Cue[]>();
          const key = `scribe/${jobId}/${lang}.srt`;
          await env.MEDIA_BUCKET.put(key, renderSrt(cues, 'text'), {
            httpMetadata: { contentType: 'text/plain; charset=utf-8' },
          });
          if (lang === primary) {
            srtKey = key;
            await env.MEDIA_BUCKET.put(`scribe/${jobId}/source.srt`, renderSrt(cues, 'source'), {
              httpMetadata: { contentType: 'text/plain; charset=utf-8' },
            });
          }
        }
        return { srtKey, srcKey: `scribe/${jobId}/source.srt` };
      });
      if (anyFresh) await stampTime(env, jobId, 'translate_end');
      await markStage(env, jobId, 'metadata', { srt_key: out.srtKey, srt_source_key: out.srcKey });

      // 5. Metadata + chapters from the transcript
      const meta = await step.do(
        'metadata',
        { retries: { limit: 2, delay: '15 seconds' }, timeout: '10 minutes' },
        async () => {
          const cur: any = await env.DB.prepare('SELECT title, title_ar, description, chapters FROM scribe_jobs WHERE id = ?').bind(jobId).first();
          if (cur?.title && cur?.description) {
            let chapters: any[] = [];
            try { chapters = JSON.parse(cur.chapters || '[]'); } catch {}
            return { title: cur.title, title_ar: cur.title_ar, description: cur.description, chapters, tokens: 0 };
          }
          await stampTime(env, jobId, 'metadata');
          const obj = await env.MEDIA_BUCKET.get(`scribe/${jobId}/cues.json`);
          if (!obj) throw new Error('cues missing from R2');
          const cues = await obj.json<Cue[]>();
          const m = await generateMetadata(env, jobId, cues, asr.languageCode);
          const chapters = await generateChapters(env, cues).catch(() => []);
          if (chapters.length) {
            await env.MEDIA_BUCKET.put(`scribe/${jobId}/chapters.json`, JSON.stringify(chapters), {
              httpMetadata: { contentType: 'application/json' },
            });
          }
          await stampTime(env, jobId, 'metadata_end');
          return { ...m, chapters, tokens: takeUsage() };
        }
      );
      await addTokens(env, jobId, meta.tokens);

      // Pre-generate thumbnail candidates so the publish wizard opens instantly
      if (/\.(mp4|webm|mkv|mov)$/i.test(dl.key)) {
        await step.do('thumbs', { retries: { limit: 1, delay: '15 seconds' }, timeout: '5 minutes' }, async () => {
          const c = await generateThumbCandidates(env as any, jobId).catch(() => []);
          return { count: c.length };
        });
      }

      await markStage(env, jobId, 'done', {
        status: 'done',
        title: meta.title,
        title_ar: meta.title_ar,
        description: meta.description,
        chapters: meta.chapters?.length ? JSON.stringify(meta.chapters) : null,
        error: null,
      });
      return { ok: true, srt: out.srtKey, cues: primaryCueCount, title: meta.title, langs };
    } catch (err: any) {
      await updateJob(env.DB, jobId, {
        status: 'error',
        error: String(err?.message || err).slice(0, 500),
      });
      throw err;
    }
  }
}
