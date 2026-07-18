// Clip Studio: AI-selected viral moments + container-rendered 9:16 clips.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { llmChat } from './translate';
import { buildClipAss, type ClipStyle } from './ass';
import type { Cue, ScribeEnv } from './types';

const CDN_BASE = 'https://cdn.deensubs.com';

export type Moment = { start: number; end: number; hook: string; reason: string; score: number };

/** The viral formula, encoded as a selection prompt. */
export async function suggestMoments(env: ScribeEnv, cues: Cue[], count = 5): Promise<Moment[]> {
  const lines = cues.map((c, i) => `${i}\t${Math.round(c.start)}-${Math.round(c.end)}s\t${c.text}`).join('\n');
  const raw = await llmChat(
    env,
    [
      {
        role: 'system',
        content: `You find VIRAL short-form moments in Islamic lecture transcripts. A winning clip:
- opens on a HOOK: a bold claim, a question, the start of a story, or a striking statement (the first 3 seconds decide everything)
- is 20-60 seconds long, a single self-contained thought that needs no context
- is emotional, quotable, surprising, or practically useful (a duʿa, a hadith, a life rule)
- ENDS resolved — the thought completes, no cliffhanger mid-sentence
- avoids housekeeping, greetings, tangents, and anything that needs the full lecture

Answer with ONLY a JSON array (no markdown):
[{"start_cue": n, "end_cue": n, "hook": "5-9 word title that stops the scroll", "reason": "why this works", "score": 1-10}]
Pick the ${count} strongest, ranked best first. hook: punchy, faithful to content, no clickbait lies, keep honorifics (ﷺ, ﷻ).`,
      },
      { role: 'user', content: `Cues (index, seconds, text):\n${lines.slice(0, 30000)}` },
    ],
    2000
  );
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  let arr: any[] = [];
  if (start >= 0 && end > start) {
    try { arr = JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  const moments: Moment[] = [];
  for (const m of Array.isArray(arr) ? arr : []) {
    const a = cues[Math.max(0, Math.min(m.start_cue ?? 0, cues.length - 1))];
    const b = cues[Math.max(0, Math.min(m.end_cue ?? 0, cues.length - 1))];
    if (!a || !b) continue;
    const s = a.start;
    const e = Math.max(b.end, s + 5);
    if (e - s < 8 || e - s > 120) continue;
    moments.push({
      start: Math.round(s * 10) / 10,
      end: Math.round(e * 10) / 10,
      hook: String(m.hook || '').slice(0, 90),
      reason: String(m.reason || '').slice(0, 200),
      score: Math.max(1, Math.min(10, Number(m.score) || 5)),
    });
  }
  return moments.slice(0, count);
}

export type ClipParams = { clipId: string };

type ClipEnv = ScribeEnv & { CACHE: KVNamespace };

async function containerCall(env: ClipEnv, name: string, path: string, init?: RequestInit): Promise<Response> {
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(env.YTDLP as any, name);
  const auth = { Authorization: 'Bearer ' + (env.YTDLP_TOKEN || 'internal') };
  return container.fetch(new Request('http://ytdlp' + path, { ...init, headers: { ...auth, ...(init?.headers as any) } }));
}

export class ClipRenderer extends WorkflowEntrypoint<ClipEnv, ClipParams> {
  async run(event: WorkflowEvent<ClipParams>, step: WorkflowStep) {
    const { clipId } = event.payload;
    const env = this.env;

    try {
      const result = await step.do(
        'render',
        { retries: { limit: 2, delay: '20 seconds' }, timeout: '25 minutes' },
        async () => {
          const clip: any = await env.DB.prepare('SELECT * FROM clips WHERE id = ?').bind(clipId).first();
          if (!clip) throw new Error('clip row missing');
          const job: any = await env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(clip.job_id).first();
          if (!job?.source_key) throw new Error('source media missing');
          if (!/\.(mp4|webm|mkv|mov)$/i.test(job.source_key)) {
            throw new Error('clips need a video source — re-run the job with "full video" enabled');
          }

          const cuesObj = await env.MEDIA_BUCKET.get(`scribe/${clip.job_id}/cues.json`);
          if (!cuesObj) throw new Error('cues missing');
          const cues = (await cuesObj.json<Cue[]>()).filter((c) => c.end > clip.start && c.start < clip.end);

          const ass = buildClipAss({
            cues,
            start: clip.start,
            end: clip.end,
            hook: clip.hook || '',
            style: (clip.style as ClipStyle) || 'bold',
          });

          const start = await containerCall(env, 'clip-' + clipId, '/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: `${CDN_BASE}/${job.source_key}`,
              start: clip.start,
              end: clip.end,
              ass_b64: btoa(unescape(encodeURIComponent(ass))),
            }),
          });
          if (!start.ok) throw new Error(`clip start failed: HTTP ${start.status} ${await start.text().catch(() => '')}`);
          const { id } = (await start.json()) as { id: string };

          let info: any = null;
          for (let i = 0; i < 240; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            const st = await containerCall(env, 'clip-' + clipId, `/jobs/${id}`);
            info = st.ok ? await st.json() : null;
            if (info?.status === 'done' || info?.status === 'error') break;
          }
          if (info?.status !== 'done') throw new Error('render failed: ' + (info?.error || 'timeout'));

          const file = await containerCall(env, 'clip-' + clipId, `/files/${id}`);
          if (!file.ok || !file.body) throw new Error('clip file fetch failed');
          const key = `clips/${clipId}.mp4`;
          // Clips are small (a minute of 1080x1920) — buffered put is fine
          await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: 'video/mp4' },
          });
          containerCall(env, 'clip-' + clipId, `/files/${id}`, { method: 'DELETE' }).catch(() => {});
          return { key };
        }
      );

      await env.DB.prepare("UPDATE clips SET status = 'done', r2_key = ?, error = NULL WHERE id = ?")
        .bind(result.key, clipId).run();
      return { ok: true, key: result.key };
    } catch (err: any) {
      await env.DB.prepare("UPDATE clips SET status = 'error', error = ? WHERE id = ?")
        .bind(String(err?.message || err).slice(0, 400), clipId).run();
      throw err;
    }
  }
}
