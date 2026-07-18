// Clip Studio: AI-selected viral moments + container-rendered 9:16 clips.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { llmChat } from './translate';
import { buildClipAss, normalizeStyle, type CaptionCard, type ClipStyle } from './ass';
import type { Cue, ScribeEnv } from './types';

const CDN_BASE = 'https://cdn.deensubs.com';

export type Moment = { start: number; end: number; hook: string; reason: string; score: number };

/** The viral formula, encoded as a selection prompt. */
export async function suggestMoments(env: ScribeEnv, cues: Cue[], count = 5): Promise<Moment[]> {
  // Group ~4 cues per line: full-lecture coverage in a compact prompt
  // (the old version sliced to 30k chars = only the first ~15% of a long talk)
  const lines: string[] = [];
  for (let i = 0; i < cues.length; i += 8) {
    const g = cues.slice(i, i + 8);
    lines.push(`${i}\t${Math.round(g[0].start)}s\t${g.map((c) => c.text).join(' ').slice(0, 160)}`);
  }
  const linesText = lines.join('\n').slice(0, 45000);
  const callOnce = (model?: string, maxTokens = 2000) => llmChat(
    env,
    [
      {
        role: 'system',
        content: `You find VIRAL short-form moments in Islamic lecture transcripts. A winning clip:
- opens on a SCROLL-STOPPER inside the first 1.3 seconds: a bold claim, a challenge to a popular belief, a question, the start of a story, or a striking statement
- is ideally 15-35 seconds (peak TikTok completion range; up to 60s only when the thought truly needs it — completion rate and REPLAYS carry the most algorithmic weight)
- is emotional, quotable, surprising, or practically useful (a duʿa, a hadith, a life rule)
- ENDS resolved AND clean — the thought completes with no trailing dead air; a closing line that circles back to the opening makes the clip LOOP, and seamless loops earn maximum replay weight
- avoids housekeeping, greetings, tangents, and anything that needs the full lecture
- hook style guide (write the hook using the strongest fitting formula): Curiosity ("what no one tells you about…"), Controversy ("[common belief] is wrong"), Story ("he was about to give up when…"), Result-first, or Self-ID ("if you're someone who…")

Answer with ONLY a JSON array (no markdown):
[{"start_cue": n, "end_cue": n, "hook": "5-9 word title that stops the scroll", "reason": "why this works", "score": 1-10}]
Pick the ${count} strongest, ranked best first. hook: punchy, faithful to content, no clickbait lies, keep honorifics (ﷺ, ﷻ).`,
      },
      { role: 'user', content: `Cue groups (startIndex, startSeconds, text — indices are cue numbers, use them for start_cue/end_cue):\n${linesText}` },
    ],
    maxTokens,
    model
  );
  let raw = '';
  try {
    raw = await callOnce();
  } catch {}
  if (!raw.includes('[')) {
    // fallback: the strong model with a shorter budget
    try { raw = await callOnce('ag/claude-sonnet-4-6', 2500); } catch (e: any) {
      throw new Error('moment scan failed on both models: ' + String(e?.message || e).slice(0, 150));
    }
  }
  let start = raw.indexOf('[');
  let end = raw.lastIndexOf(']');
  let arr: any[] = [];
  if (start >= 0 && end > start) {
    try { arr = JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  if (!arr.length) {
    // model answered but not in-format — one strong-model retry
    try {
      raw = await callOnce('ag/claude-sonnet-4-6', 2500);
      start = raw.indexOf('[');
      end = raw.lastIndexOf(']');
      if (start >= 0 && end > start) arr = JSON.parse(raw.slice(start, end + 1));
    } catch {}
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

/** LLM edit-direction: caption cards timed to speech + effect cues.
 * Returns null on any failure — the mechanical splitter is the fallback. */
export async function aiClipDirection(
  env: ScribeEnv,
  cues: Cue[],
  start: number,
  end: number,
  hook: string,
  words?: { text: string; start: number; end: number }[]
): Promise<CaptionCard[] | null> {
  try {
    // Source-first: the director translates DIRECTLY from the timed Arabic
    // words, producing caption-native English phrasing with exact beat timing.
    const wordLines = (words || [])
      .slice(0, 800)
      .map((w) => `${w.start.toFixed(2)} ${w.text}`)
      .join('\n');
    if (!wordLines) return null;
    const raw = await llmChat(env, [
      { role: 'system', content: `You are a professional subtitle editor for viral Islamic short-form clips. You receive the ORIGINAL ARABIC speech as timestamped words. Translate it into English caption CARDS. Output ONLY JSONL, one card per line:
{"a":ABS_START_SEC,"b":ABS_END_SEC,"t":"a complete readable English phrase"}
Rules:
- Every card is a COMPLETE, STANDALONE phrase: 3-9 words, max ~80 characters, a full clause with its own meaning. NEVER 1-2 word fragments, never a phrase that only makes sense with the previous card.
- "a" = the timestamp of the first Arabic word the card covers; "b" = when its last word ends. Cards appear exactly as their words are spoken. Typical card: 1.2-3.5s. No overlaps, chronological.
- Translation: faithful, natural, dignified. Keep honorifics (Allah ﷻ, the Prophet ﷺ, RA/AS). Established transliterations stay (fiqh, dua, Sharia...). Quranic quotes use established translation wording.
- PUNCTUATE properly so the reader always knows where the thought stands: a card that COMPLETES a sentence ends with . ! or ?; a card continuing into the next ends with a comma or nothing (use … only for a genuinely suspended thought). Never leave a sentence-final card unpunctuated.
- The FIRST card lands within 1.3s of ${start.toFixed(1)}s; the FINAL card ends cleanly on the last spoken word before ${end.toFixed(1)}s.
- Cover ALL the speech. No commentary, no markdown.` },
      { role: 'user', content: `Hook (for tone): ${hook}\nTimed Arabic words (sec word):\n${wordLines}` },
    ], 6000, 'ag/claude-opus-4-6-thinking').catch(() =>
      llmChat(env, [
        { role: 'system', content: 'Return the JSONL caption cards as instructed.' },
        { role: 'user', content: `Hook: ${hook}\nTimed Arabic words:\n${wordLines}` },
      ], 4000, 'ag/claude-sonnet-4-6')
    );
    const cards: CaptionCard[] = [];
    for (let line of raw.split('\n')) {
      line = line.trim().replace(/^```(json)?|```$/g, '').trim();
      if (!line.startsWith('{')) continue;
      try {
        const o = JSON.parse(line);
        const a = Math.max(start, Number(o.a));
        const b = Math.min(end, Number(o.b));
        const t = String(o.t || '').trim();
        if (!t || isNaN(a) || isNaN(b) || b - a < 0.25) continue;
        if (t.split(/\s+/).length < 2 && cards.length) continue; // no fragment cards
        let text = t;
        if (text.length > 88) {
          const cut = text.lastIndexOf(' ', 88);
          text = text.slice(0, cut > 40 ? cut : 88);
        }
        cards.push({ a, b, t: text });
      } catch {}
    }
    cards.sort((x, y) => x.a - y.a);
    for (let i = 0; i < cards.length - 1; i++) {
      if (cards[i].b > cards[i + 1].a) cards[i].b = Math.max(cards[i].a + 0.25, cards[i + 1].a - 0.02);
    }
    // Reading-time relief: a card stays up long enough to actually read
    // (~15 chars/sec, min 0.9s), borrowing any gap before the next card.
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const need = c.a + Math.max(0.9, c.t.length / 15);
      const limit = i + 1 < cards.length ? cards[i + 1].a - 0.05 : end;
      if (c.b < need) c.b = Math.max(c.b, Math.min(need, limit));
    }
    return cards.length >= 3 ? cards : null;
  } catch {
    return null;
  }
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

          // LLM edit direction (captions + effects); mechanical fallback.
          // Arabic word-level timestamps give the model exact speech beats.
          let words: { text: string; start: number; end: number }[] = [];
          try {
            const asrObj = job.asr_key ? await env.MEDIA_BUCKET.get(job.asr_key) : null;
            if (asrObj) {
              const asr: any = await asrObj.json();
              words = (asr.words || [])
                .filter((w: any) => (w.type || 'word') === 'word' && w.end > clip.start && w.start < clip.end)
                .map((w: any) => ({ text: w.text, start: w.start, end: w.end }));
            }
          } catch {}
          // Snap bounds to actual speech (mechanical dead-air removal)
          let cStart = clip.start;
          let cEnd = clip.end;
          if (words.length) {
            cStart = Math.max(clip.start, Math.round((words[0].start - 0.25) * 10) / 10);
            cEnd = Math.min(clip.end, Math.round((words[words.length - 1].end + 0.35) * 10) / 10);
            if (cEnd - cStart < 5) { cStart = clip.start; cEnd = clip.end; }
          }
          const cards = await aiClipDirection(env, cues, cStart, cEnd, clip.hook || '', words);
          const ass = buildClipAss({
            cues,
            start: cStart,
            end: cEnd,
            hook: clip.hook || '',
            style: normalizeStyle(clip.style || 'tiktok'),
            cards: cards || undefined,
            framing: clip.framing === 'fit' ? 'fit' : 'fill',
          });


          const start = await containerCall(env, 'clip-' + clipId, '/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: `${CDN_BASE}/${job.source_key}`,
              start: cStart,
              end: cEnd,
              ass_b64: btoa(unescape(encodeURIComponent(ass))),
              framing: clip.framing === 'fit' ? 'fit' : 'fill',
              poster: 1,
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
          // Poster frame for the gallery (best-effort)
          try {
            const poster = await containerCall(env, 'clip-' + clipId, `/files/${id}?name=poster.jpg`);
            if (poster.ok) {
              await env.MEDIA_BUCKET.put(`clips/${clipId}.jpg`, await poster.arrayBuffer(), {
                httpMetadata: { contentType: 'image/jpeg' },
              });
            }
          } catch {}
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
