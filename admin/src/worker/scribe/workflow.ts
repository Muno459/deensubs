// The Scribe pipeline as a Cloudflare Workflow: durable, retried, resumable.
// Heavy artifacts live in R2; stage timestamps + cost telemetry in D1.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { download } from './download';
import { runAsr, loadAsr } from './asr';
import { translateWords, takeUsage } from './translate';
import { generateMetadata, generateChapters } from './metadata';
import { renderSrt } from './srt';
import { updateJob, type Cue, type ScribeEnv } from './types';

export type ScribeParams = {
  jobId: string;
  url: string;
  targetLang: string; // primary target
  targetLangs?: string[]; // full list incl. primary
  fullVideo?: boolean;
};

async function markStage(env: ScribeEnv, jobId: string, stage: string, extra: Record<string, any> = {}) {
  const row: any = await env.DB.prepare('SELECT stage_times FROM scribe_jobs WHERE id = ?').bind(jobId).first();
  let times: Record<string, string> = {};
  try { times = JSON.parse(row?.stage_times || '{}'); } catch {}
  times[stage] = new Date().toISOString();
  await updateJob(env.DB, jobId, { step: stage, stage_times: JSON.stringify(times), ...extra });
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
      const dl = await step.do(
        'download',
        { retries: { limit: 3, delay: '45 seconds', backoff: 'exponential' }, timeout: '30 minutes' },
        () => download(env, jobId, url, !!fullVideo)
      );
      const row: any = await env.DB.prepare('SELECT title, channel, thumb_url FROM scribe_jobs WHERE id = ?').bind(jobId).first();
      await markStage(env, jobId, 'asr', {
        source_key: dl.key,
        download_method: dl.method,
        download_pct: 100,
        title: row?.title || dl.title || null,
        channel: row?.channel || dl.channel || null,
        thumb_url: row?.thumb_url || dl.thumbUrl || null,
        duration: dl.durationSec || 0,
      });

      // 2. ASR (ElevenLabs Scribe v2; chunked automatically for long files)
      const asr = await step.do(
        'asr',
        { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '60 minutes' },
        () => runAsr(env, jobId, dl.key, dl.durationSec || 0)
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
      for (const lang of langs) {
        const tr = await step.do(
          `translate-${lang}`,
          { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '45 minutes' },
          async () => {
            const data = await loadAsr(env, asr.asrKey);
            const cues = await translateWords(env, data.words, lang);
            const cuesKey = lang === primary ? `scribe/${jobId}/cues.json` : `scribe/${jobId}/cues.${lang}.json`;
            await env.MEDIA_BUCKET.put(cuesKey, JSON.stringify(cues), {
              httpMetadata: { contentType: 'application/json' },
            });
            return { cuesKey, cueCount: cues.length, tokens: takeUsage() };
          }
        );
        await addTokens(env, jobId, tr.tokens);
        if (lang === primary) {
          primaryCueCount = tr.cueCount;
          await updateJob(env.DB, jobId, { cue_count: tr.cueCount });
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
      await markStage(env, jobId, 'metadata', { srt_key: out.srtKey, srt_source_key: out.srcKey });

      // 5. Metadata + chapters from the transcript
      const meta = await step.do(
        'metadata',
        { retries: { limit: 2, delay: '15 seconds' }, timeout: '10 minutes' },
        async () => {
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
          return { ...m, chapters, tokens: takeUsage() };
        }
      );
      await addTokens(env, jobId, meta.tokens);

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
