// The Scribe pipeline as a Cloudflare Workflow: durable, retried, resumable.
// Heavy artifacts live in R2; stage timestamps + cost telemetry in D1.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { download, needsBrowser } from './download';
import { runAsr, loadAsr } from './asr';
import { translateWords, qaPass, takeUsage, takeCost } from './translate';
import { translateWordsAudiobook, qaPassAudiobook, buildTranscript } from './audiobook';
import { generateChapters, generateMetaAndChapters } from './metadata';
import { generateThumbCandidates } from './publish';
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
  // Best-effort telemetry: a transient D1 overload here must never fail the
  // surrounding step (it once re-ran a completed 3GB download).
  await env.DB.prepare(
    `UPDATE scribe_jobs SET stage_times = CASE
       WHEN ?1 = 1 OR json_extract(COALESCE(stage_times, '{}'), ?2) IS NULL
       THEN json_patch(COALESCE(stage_times, '{}'), ?3)
       ELSE stage_times END
     WHERE id = ?4`
  ).bind(force ? 1 : 0, '$.' + key, JSON.stringify({ [key]: new Date().toISOString() }), jobId).run().catch(() => {});
}

const STAGE_RANK: Record<string, number> = { download: 1, asr: 2, enhance: 3, translate: 3, metadata: 4, done: 5 };

async function markStage(env: ScribeEnv, jobId: string, stage: string, extra: Record<string, any> = {}) {
  await stampTime(env, jobId, stage, false);
  // Forward-only: workflow replays (every deploy) re-execute the un-journaled
  // code between steps, and a naive write briefly reset mid-transcription jobs
  // back to "download" — a stale-step snapshot once deleted live jobs. The
  // step column may advance but never regress.
  const cur: any = await env.DB.prepare('SELECT step FROM scribe_jobs WHERE id = ?').bind(jobId).first();
  const back = (STAGE_RANK[stage] || 0) < (STAGE_RANK[cur?.step || ''] || 0);
  if (back) {
    if (Object.keys(extra).length) await updateJob(env.DB, jobId, { error: null, ...extra });
    return;
  }
  await updateJob(env.DB, jobId, { step: stage, error: null, ...extra });
}

async function addTokens(env: ScribeEnv, jobId: string, tokens: number, cost = 0) {
  if (tokens > 0) {
    await env.DB.prepare('UPDATE scribe_jobs SET llm_tokens = llm_tokens + ?, llm_cost = COALESCE(llm_cost, 0) + ? WHERE id = ?').bind(tokens, cost, jobId).run();
  }
}

export class ScribePipeline extends WorkflowEntrypoint<ScribeEnv, ScribeParams> {
  async run(event: WorkflowEvent<ScribeParams>, step: WorkflowStep) {
    const { jobId, url } = event.payload;
    let fullVideo = !!event.payload.fullVideo;
    const langs = event.payload.targetLangs?.length ? event.payload.targetLangs : [event.payload.targetLang];
    const primary = langs[0];
    const env = this.env;

    try {
      // 1. Download → R2
      await updateJob(env.DB, jobId, { status: 'running' });
      // Validate the ASR config BEFORE spending a download — a misconfig (e.g.
      // proxy mode with no proxies) otherwise only surfaced after the audio
      // download, ~50s in. This makes it fail in ~1s.
      await step.do('asr-preflight', { retries: { limit: 0, delay: '5 seconds' }, timeout: '20 seconds' }, async () => {
        const { getAsrPlan } = await import('./asr');
        await getAsrPlan(env);
        return 'ok';
      });
      await markStage(env, jobId, 'download');
      // Downloads are Worker-native: the /player extraction goes through the
      // proxy, then the media is pulled straight to R2 in parallel ranges.
      // Nothing is serialized, so playlist imports download fully in parallel.
      // The old single-slot gate existed to protect shared SOCKS proxies, which
      // no longer carry any media.
      // Retries are patient on purpose: a big playlist batch can exhaust the
      // container max_instances cap, and jobs must wait out the contention
      // (~35 min of linear backoff) rather than fail.
      // Audio-first (Browser Rendering full videos): the audio stream lands in
      // seconds, so transcription starts immediately while the full video +
      // mux completes concurrently — by the time ElevenLabs returns, the
      // muxed file exists and the pipeline never waited on it.
      let audioFirstKey: string | null = null;
      let audioFirstDur = 0;
      if (fullVideo && needsBrowser(url)) {
        try {
          // 3 minutes, not 15: a healthy extraction finishes in well under 30s
          // now that every proxied request carries its own 15s deadline, and
          // the audio itself moves in seconds. The old 15-minute ceiling meant
          // one silent proxy hang looked like a frozen job for a quarter hour.
          const aud = await step.do('download-audio',
            { retries: { limit: 3, delay: '20 seconds' }, timeout: '3 minutes' }, async () => {
            const { downloadAudioOnly } = await import('./download');
            return await downloadAudioOnly(env, jobId, url);
          });
          audioFirstKey = aud.key;
          audioFirstDur = aud.durationSec || 0;
        } catch { /* fall back to the classic sequential path */ }
      }
      const ASR_CFG = { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '2 hours' } as const;
      const asrBody = (srcKey: string, srcDur: number) => async () => {
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
        const res = await runAsr(env, jobId, srcKey, srcDur);
        await stampTime(env, jobId, 'asr_end');
        return { ...res, cached: false };
      };
      const dlStep = step.do(
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
      if (audioFirstKey) {
        // start transcription NOW; the same-named step later returns this
        // cached result instantly (journaled by name)
        await step.do('asr', ASR_CFG, asrBody(audioFirstKey, audioFirstDur));
      }
      const dl = await dlStep;
      // Background mux (Worker-native full-video path): the streams are already
      // in R2. Remux to source.mp4 as a step that runs IN PARALLEL with detect +
      // transcription so subtitles never wait on it. `dl.key` is the interim
      // video-only source (thumbnails/audiobook-detect only need frames); we swap
      // source_key to the muxed file just before marking the job done.
      const muxStep = (dl as any).muxPending && (dl as any).videoKey && (dl as any).audioKey
        ? step.do('mux', { retries: { limit: 2, delay: '30 seconds' }, timeout: '20 minutes' }, async () => {
            const { muxWorkerNative } = await import('./ytdl');
            return muxWorkerNative(env, jobId, (dl as any).videoKey, (dl as any).audioKey);
          })
        : null;
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
        // every fresh video download gets a definitive 4K verdict — 'none' too,
        // so nothing ever needs probing again (cached resumes keep their flag)
        ...(fullVideo && !(dl as any).cached ? { k4_status: (dl as any).fourK ? 'capable' : 'none' } : {}),
      });
      if (fullVideo && (dl as any).fourK && !(dl as any).cached) {
        const { nudgeCompanions } = await import('../companion');
        await nudgeCompanions(env, 'encode');
      }
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

      // 1b2. Audiobooks wearing a video container: many uploads are a static
      // artwork or an audio visualizer for the whole runtime. Detect it from
      // frames sampled across the video BEFORE translation, flip the job to
      // the audiobook pipeline, and let everything downstream (enhancement
      // offer, prose translation, karaoke transcript) follow.
      if (fullVideo) {
        const still = await step.do('detect-static-audiobook',
          { retries: { limit: 1, delay: '30 seconds' }, timeout: '8 minutes' }, async () => {
          try {
            const { generateThumbCandidates } = await import('./publish');
            const frames = await generateThumbCandidates(env as any, jobId);
            if (frames.length < 2) return false;
            const { detectStaticVideo } = await import('../thumbs');
            const st = await detectStaticVideo(env, frames.map((f) => f.key));
            if (st) await updateJob(env.DB, jobId, { full_video: 0 });
            return !!st;
          } catch {
            return false;
          }
        });
        if (still) fullVideo = false;
      }

      // 1c. Speech enhancement offer (audiobooks). ASR transcribes the RAW
      // audio — the ideal-timeline contract keeps the enhanced file's duration
      // exact, so word timestamps from the raw transcription stay sample-
      // accurate on the enhanced audio that ships. Offering here (and waiting
      // only at the end of the pipeline) lets Sidon run on a companion in
      // parallel with ASR + translation.
      const seOffered = !fullVideo
        ? await step.do('enhance-offer', async () => {
            const row: any = await env.DB.prepare('SELECT se_status, speech_enhanced FROM scribe_jobs WHERE id = ?').bind(jobId).first();
            if (row?.speech_enhanced || row?.se_status === 'done') return false;
            const { onlineCompanions, hasCap } = await import('../companion');
            if (!hasCap(await onlineCompanions(env), 'enhance')) return false;
            await env.DB.prepare(
              "UPDATE scribe_jobs SET se_status = 'wanted' WHERE id = ? AND (se_status IS NULL OR se_status = '' OR se_status = 'failed')"
            ).bind(jobId).run();
            const { nudgeCompanions } = await import('../companion');
            await nudgeCompanions(env, 'enhance');
            return true;
          })
        : false;

      // 2. ASR (ElevenLabs Scribe v2; chunked automatically for long files)
      // Audio source for ASR: audio-first, else the downloaded audio stream
      // (Worker-native full-video path), else the muxed/source key. Never dl.key
      // alone on the native path — that key is the video-ONLY stream.
      const audioSrcKey = audioFirstKey ?? (dl as any).audioKey ?? dl.key;
      const asr = await step.do('asr', ASR_CFG,
        asrBody(audioSrcKey, audioFirstKey ? audioFirstDur : dl.durationSec || 0));
      await markStage(env, jobId, 'translate', {
        asr_key: asr.asrKey,
        language_code: asr.languageCode,
        duration: asr.durationSec,
        asr_seconds: asr.durationSec,
        target_langs: JSON.stringify(langs),
      });

      // 3. Translate — one pass per target language (primary first).
      // Audio-only jobs take the AUDIOBOOK pipeline (prose units for the
      // karaoke player, word spans kept, no display constraints); video jobs
      // take the proven subtitle pipeline, untouched.
      // The queued intent decides here, NOT the file. Deciding by extension
      // looked right and was wrong: the audio-first video flow downloads audio
      // FIRST, so mid-run the source is source.m4a while the video is still on
      // its way — and a real lecture got reclassified as an audiobook. The
      // upload path already sets full_video from the file, and the video
      // fallback above clears it when no video can be fetched, so by this point
      // the flag is the truth.
      const isAudiobook = !fullVideo;
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
            // Audio-in-the-loop: each window's slice of the RAW recording is
            // attached so the model hears tone, pauses and emphasis while
            // translating and segmenting (fail-open — any clip failure falls
            // back to the text-only request).
            const audioOpts = { jobId, sourceUrl: `https://cdn.deensubs.com/${audioSrcKey}` };
            const cues = isAudiobook
              ? await translateWordsAudiobook(env, data.words, lang, audioOpts)
              : await translateWords(env, data.words, lang, audioOpts);
            await env.MEDIA_BUCKET.put(cuesKey, JSON.stringify(cues), {
              httpMetadata: { contentType: 'application/json' },
            });
            return { cuesKey, cueCount: cues.length, tokens: takeUsage(), cost: takeCost(), cached: false };
          }
        );
        await addTokens(env, jobId, tr.tokens, (tr as any).cost || 0);
        if (!tr.cached) anyFresh = true;

        // QA repair pass (skipped when cues came from a finished run)
        if (!tr.cached) {
          const qa = await step.do(
            `qa-${lang}`,
            { retries: { limit: 1, delay: '30 seconds' }, timeout: '30 minutes' },
            async () => {
              const obj = await env.MEDIA_BUCKET.get(cuesKey);
              if (!obj) throw new Error('cues missing for QA');
              const cues = await obj.json<Cue[]>();
              const repaired = isAudiobook
                ? await qaPassAudiobook(env, cues as any, lang)
                : await qaPass(env, cues, lang);
              await env.MEDIA_BUCKET.put(cuesKey, JSON.stringify(repaired.cues), {
                httpMetadata: { contentType: 'application/json' },
              });
              return { fixes: repaired.fixes, tokens: takeUsage(), cost: takeCost() };
            }
          );
          await addTokens(env, jobId, qa.tokens, (qa as any).cost || 0);
        }

        // Karaoke transcript document (audiobook, primary language): one
        // shared timed word array + English units as index spans into it.
        // Runs even when translate came from cache — a resume after a crash
        // between translate and transcript must still produce the document.
        if (isAudiobook && lang === primary) {
          await step.do('transcript', { retries: { limit: 2, delay: '30 seconds' }, timeout: '10 minutes' }, async () => {
            if (tr.cached && (await env.MEDIA_BUCKET.head(`scribe/${jobId}/transcript.json`))) {
              return { cached: true };
            }
            const [cuesObj, data] = await Promise.all([
              env.MEDIA_BUCKET.get(cuesKey),
              loadAsr(env, asr.asrKey),
            ]);
            if (!cuesObj) throw new Error('cues missing for transcript');
            const cues: any[] = await cuesObj.json();
            const row = await env.DB.prepare('SELECT chapters, title, channel FROM scribe_jobs WHERE id = ?').bind(jobId).first<any>();
            const { nameSpeakers, buildSpeakerTxt, elevenFormats, alignUnits } = await import('./audiobook');
            // ElevenLabs' native exports are the structural truth: their raw
            // txt is stored verbatim and their source-language segmentation
            // drives the paragraph blocks
            const native = elevenFormats(data);
            const doc: any = buildTranscript(data.words, cues as any, row?.chapters, native.segments);
            if (doc.turns) {
              // Name once, keep forever: reuse existing non-generic labels
              let existing: string[] | null = null;
              try {
                const prev = await env.MEDIA_BUCKET.get(`scribe/${jobId}/transcript.json`);
                const pj: any = prev ? await prev.json() : null;
                if (Array.isArray(pj?.speakers) && !pj.speakers.every((x: string) => /^Speaker \d+$/.test(x))) existing = pj.speakers;
              } catch {}
              doc.speakers = existing || await nameSpeakers(env, doc, { title: row?.title, channel: row?.channel });
            }
            doc.align = await alignUnits(env, doc);
            await env.MEDIA_BUCKET.put(`scribe/${jobId}/transcript.json`, JSON.stringify(doc), {
              httpMetadata: { contentType: 'application/json' },
            });
            const put = (key: string, body: string) =>
              env.MEDIA_BUCKET.put(key, body, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
            if (native.txt) await put(`scribe/${jobId}/elevenlabs.txt`, native.txt);
            await put(`scribe/${jobId}/transcript-source.txt`, native.txt || buildSpeakerTxt(doc, 'source'));
            await put(`scribe/${jobId}/transcript-${lang}.txt`, buildSpeakerTxt(doc, 'translated'));
            return { units: doc.units.length, words: doc.words.length, speakers: doc.speakers || null, native: !!native.segments, aligned: doc.align.filter((p: any) => p.length).length };
          });
        }

        if (lang === primary) {
          primaryCueCount = tr.cueCount;
          await updateJob(env.DB, jobId, { cue_count: tr.cueCount });
          // No quality step. It embedded every cue twice with bge-m3 to grade
          // the job C and list "low-similarity" cues that were fine — minutes
          // of tail latency per job for a card the operator asked to be rid
          // of. The review pass already fixes what it can fix; a grade nobody
          // trusts is not worth the wait. check-subs.py remains for offline
          // measurement when it matters.
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
          const cur: any = await env.DB.prepare('SELECT title, title_ar, description, chapters, channel, orig_description FROM scribe_jobs WHERE id = ?').bind(jobId).first();
          if (cur?.title && cur?.description) {
            let chapters: any[] = [];
            try { chapters = JSON.parse(cur.chapters || '[]'); } catch {}
            // Batch imports pre-store title/description before the transcript
            // exists — chapters still have to be generated from the cues here.
            if (!chapters.length) {
              const obj = await env.MEDIA_BUCKET.get(`scribe/${jobId}/cues.json`);
              if (obj) {
                chapters = await generateChapters(env, await obj.json<Cue[]>()).catch(() => []);
                if (chapters.length) {
                  await env.MEDIA_BUCKET.put(`scribe/${jobId}/chapters.json`, JSON.stringify(chapters), {
                    httpMetadata: { contentType: 'application/json' },
                  });
                }
              }
            }
            return { title: cur.title, title_ar: cur.title_ar, description: cur.description, chapters, tokens: takeUsage(), cost: takeCost() };
          }
          await stampTime(env, jobId, 'metadata');
          const obj = await env.MEDIA_BUCKET.get(`scribe/${jobId}/cues.json`);
          if (!obj) throw new Error('cues missing from R2');
          const cues = await obj.json<Cue[]>();
          const m = await generateMetaAndChapters(env, jobId, cues, asr.languageCode,
            { title: cur?.title, channel: cur?.channel, description: cur?.orig_description });
          const chapters = m.chapters;
          if (chapters.length) {
            await env.MEDIA_BUCKET.put(`scribe/${jobId}/chapters.json`, JSON.stringify(chapters), {
              httpMetadata: { contentType: 'application/json' },
            });
          }
          await stampTime(env, jobId, 'metadata_end');
          return { ...m, chapters, tokens: takeUsage(), cost: takeCost() };
        }
      );
      await addTokens(env, jobId, meta.tokens, (meta as any).cost || 0);

      // Pre-generate thumbnail candidates so the publish wizard opens instantly
      if (/\.(mp4|webm|mkv|mov)$/i.test(dl.key)) {
        await step.do('thumbs', { retries: { limit: 1, delay: '15 seconds' }, timeout: '5 minutes' }, async () => {
          const c = await generateThumbCandidates(env as any, jobId).catch(() => []);
          return { count: c.length };
        });
      }

      // Enhancement rendezvous: Sidon has been running on a companion since
      // the offer at 1c. Settle it before the job is marked reviewable, so
      // publish never races the source_key swap (publish would ship raw audio
      // while the flag says enhanced).
      if (seOffered) {
        await markStage(env, jobId, 'enhance');
        for (let w = 0; w < 200; w++) { // claimed jobs get hours (CPU Macs are ~realtime)
          const st: string = await step.do(`enhance-check-${w}`, async () => {
            const r: any = await env.DB.prepare('SELECT se_status FROM scribe_jobs WHERE id = ?').bind(jobId).first();
            if (r?.se_status === 'done') return 'done';
            if (r?.se_status === 'failed') return 'abandon';
            if (r?.se_status === 'wanted') {
              if (w >= 20) return 'abandon'; // still unclaimed after the whole pipeline + 20 min — move on
              const { onlineCompanions, hasCap } = await import('../companion');
              if (!hasCap(await onlineCompanions(env), 'enhance')) return 'abandon';
            }
            return 'wait';
          });
          if (st === 'done' || st === 'abandon') {
            if (st === 'abandon') {
              await step.do('enhance-cancel', async () => {
                await env.DB.prepare("UPDATE scribe_jobs SET se_status = NULL WHERE id = ? AND se_status IN ('wanted','failed')").bind(jobId).run();
              });
            }
            break;
          }
          try {
            await (step as any).waitForEvent(`enhance-ev-${w}`, { type: 'enhance-complete', timeout: '60 seconds' });
          } catch { /* timeout: re-check state */ }
        }
      }

      // Rendezvous with the background mux: subtitles are done; make sure the
      // muxed source.mp4 (video+audio) is ready and swap source_key to it before
      // the job becomes publishable (the intermediate streams were deleted by
      // muxWorkerNative). Fast in practice — the mux overlapped transcription.
      if (muxStep) {
        const muxed = await muxStep;
        await updateJob(env.DB, jobId, { source_key: muxed.key });
        // now safe to drop the intermediate streams — source_key points at the
        // muxed file and no parallel step will read the video stream anymore.
        env.MEDIA_BUCKET.delete((dl as any).videoKey).catch(() => {});
        env.MEDIA_BUCKET.delete((dl as any).audioKey).catch(() => {});
      }
      await markStage(env, jobId, 'done', {
        status: 'done',
        title: meta.title,
        title_ar: meta.title_ar,
        description: meta.description,
        chapters: meta.chapters?.length ? JSON.stringify(meta.chapters) : null,
        category_id: (meta as any).category_id ?? null,
        scholar_id: (meta as any).scholar_id ?? null,
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
