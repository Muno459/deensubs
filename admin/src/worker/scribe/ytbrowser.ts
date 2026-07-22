// Browser-Rendering YouTube download — the primary technique.
//
// YouTube bot-walls datacenter IPs on /youtubei/v1/player, so a plain Worker
// fetch gets LOGIN_REQUIRED. A REAL headless Chrome (Cloudflare Browser
// Rendering) running on a CF IP passes the live BotGuard check, so we drive it
// to fetch the ANDROID_VR player response from the page context — that returns
// DIRECT googlevideo URLs (no nsig, no PO token). Because the mint happened on
// a CF IP, the URLs are locked to Cloudflare's network and a plain Worker can
// then range-stream them at ~100 MB/s. No yt-dlp, no cookies, no proxies.

import puppeteer from '@cloudflare/puppeteer';

export type YtFormat = { itag: number; url: string; clen: number | null; mime: string; height?: number; abr?: number };
export type YtMint = {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  durationSec: number;
  description: string;
  thumbUrl: string;       // highest-resolution thumbnail available
  fourK: boolean;
  video: YtFormat[];      // adaptive video-only, highest first
  audio: YtFormat[];      // adaptive audio-only, best first
  progressive: YtFormat[]; // muxed (itag 18/22), highest first
};

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus',
  deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L',
  hl: 'en', gl: 'US',
};

export function parseYouTube(url: string): { videoId: string | null; listId: string | null } {
  let videoId: string | null = null, listId: string | null = null;
  try {
    const u = new URL(url);
    listId = u.searchParams.get('list');
    if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1) || null;
    else if (u.pathname.startsWith('/shorts/')) videoId = u.pathname.split('/')[2] || null;
    else if (u.pathname.startsWith('/embed/')) videoId = u.pathname.split('/')[2] || null;
    else videoId = u.searchParams.get('v');
  } catch {}
  if (videoId && !/^[\w-]{11}$/.test(videoId)) videoId = null;
  return { videoId, listId };
}

/** Best thumbnail: the player response's largest, else maxres → sd → hq fallback. */
function bestThumb(thumbs: any[], videoId: string): string {
  const arr = Array.isArray(thumbs) ? thumbs.filter((t) => t?.url) : [];
  if (arr.length) {
    const top = arr.sort((a, b) => (a.width || 0) - (b.width || 0)).pop();
    if (top?.url) return top.url as string;
  }
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

/** Drive Browser Rendering to mint ANDROID_VR direct URLs + metadata for a video. */
/** browserMint with a short KV cache: the composer's deep probe already
    minted this video's URLs seconds before Transcribe is pressed — reusing
    them skips an entire headless-browser session on download. */
export async function browserMintCached(env: any, videoId: string): Promise<YtMint> {
  const key = 'ytmint:' + videoId;
  try {
    const hit: any = await env.CACHE?.get(key, 'json');
    if (hit && hit.status === 'OK') return hit;
  } catch {}
  const m = await browserMint(env, videoId);
  if (m && (m as any).status === 'OK') {
    try { await env.CACHE?.put(key, JSON.stringify(m), { expirationTtl: 1800 }); } catch {}
  }
  return m;
}

export async function browserMint(env: any, videoId: string): Promise<YtMint> {
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    await page.goto('https://www.youtube.com/watch?v=' + videoId, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const data = await page.evaluate(async (client: any, vid: string) => {
      const visitor = (window as any).ytcfg?.data_?.INNERTUBE_CONTEXT?.client?.visitorData || null;
      const r = await fetch('/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '28', 'X-YouTube-Client-Version': '1.65.10', 'X-Goog-Visitor-Id': visitor || '' },
        body: JSON.stringify({ context: { client: { ...client, visitorData: visitor } }, videoId: vid, contentCheckOk: true, racyCheckOk: true, playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } } }),
      });
      const d: any = await r.json();
      const st = d.streamingData || {};
      const vd = d.videoDetails || {};
      const mf = d.microformat?.playerMicroformatRenderer || {};
      return {
        status: d.playabilityStatus?.status,
        reason: d.playabilityStatus?.reason,
        title: vd.title || '',
        channel: vd.author || '',
        channelId: vd.channelId || '',
        duration: parseInt(vd.lengthSeconds || '0', 10),
        description: (vd.shortDescription || mf.description?.simpleText || '').slice(0, 4000),
        thumbs: vd.thumbnail?.thumbnails || [],
        adaptive: (st.adaptiveFormats || []).map((f: any) => ({ itag: f.itag, url: f.url, clen: f.contentLength || null, mime: f.mimeType || '', height: f.height, abr: f.averageBitrate || f.bitrate })),
        progressive: (st.formats || []).map((f: any) => ({ itag: f.itag, url: f.url, clen: f.contentLength || null, mime: f.mimeType || '', height: f.height })),
      };
    }, ANDROID_VR_CLIENT, videoId);

    if (data.status !== 'OK') throw new Error(`not playable: ${data.status}${data.reason ? ' — ' + data.reason : ''}`);

    const all = [...data.adaptive, ...data.progressive].filter((f: any) => f.url);
    const video = data.adaptive.filter((f: YtFormat) => f.url && (f.mime || '').startsWith('video/')).sort((a: YtFormat, b: YtFormat) => (b.height || 0) - (a.height || 0));
    const audio = data.adaptive.filter((f: YtFormat) => f.url && (f.mime || '').startsWith('audio/')).sort((a: YtFormat, b: YtFormat) => (b.abr || 0) - (a.abr || 0));
    const progressive = data.progressive.filter((f: YtFormat) => f.url).sort((a: YtFormat, b: YtFormat) => (b.height || 0) - (a.height || 0));

    return {
      videoId,
      title: data.title,
      channel: data.channel,
      channelId: data.channelId,
      durationSec: data.duration,
      description: data.description,
      thumbUrl: bestThumb(data.thumbs, videoId),
      fourK: all.some((f: YtFormat) => (f.height || 0) > 1080),
      video, audio, progressive,
    };
  } finally {
    await browser.close();
  }
}

// ---- parallel range streaming (defeats googlevideo's per-connection throttle) ----

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
      if (r.status === 206 || r.status === 200) return new Uint8Array(await r.arrayBuffer());
      if (attempt === 5) throw new Error(`range ${r.status} at ${start}`);
    } catch (e) { if (attempt === 5) throw e; }
    await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
  }
  throw new Error('unreachable');
}

/** Ordered ReadableStream over parallel byte-range fetches (sliding window). */
export function rangeStream(url: string, totalLen: number, chunk = 4 * 1024 * 1024, concurrency = 16): ReadableStream<Uint8Array> {
  const nChunks = Math.ceil(totalLen / chunk);
  const inflight = new Map<number, Promise<Uint8Array>>();
  let nextToFetch = 0, nextToEmit = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (nextToEmit >= nChunks) { controller.close(); return; }
      while (inflight.size < concurrency && nextToFetch < nChunks) {
        const idx = nextToFetch++;
        inflight.set(idx, fetchRange(url, idx * chunk, Math.min((idx + 1) * chunk - 1, totalLen - 1)));
      }
      try {
        const data = await inflight.get(nextToEmit)!;
        inflight.delete(nextToEmit);
        nextToEmit++;
        controller.enqueue(data);
      } catch (e) { controller.error(e); }
    },
  });
}

export type PlaylistEntry = { id: string; title: string };

/** Resolve a playlist to {id, title} via InnerTube browse (one browser session).
 *  JSON-walks the browse response inside Chrome (free CPU there) for titles. */
export async function resolvePlaylist(env: any, listId: string, maxPages = 8): Promise<{ title: string; entries: PlaylistEntry[] }> {
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    // any watch page bootstraps a trusted session for the same-origin browse call
    await page.goto('https://www.youtube.com/watch?list=' + listId, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    return await page.evaluate(async (list: string, pages: number) => {
      const visitor = (window as any).ytcfg?.data_?.INNERTUBE_CONTEXT?.client?.visitorData || null;
      const cver = (window as any).ytcfg?.data_?.INNERTUBE_CONTEXT_CLIENT_VERSION || '2.20240101.00.00';
      const ctx = { client: { clientName: 'WEB', clientVersion: cver, hl: 'en', gl: 'US', visitorData: visitor } };
      const entries: { id: string; title: string }[] = [];
      const seen = new Set<string>();
      let cont: string | null = null, plTitle = '';

      // Pull {videoId, title} out of a lockup / playlistVideoRenderer item.
      const grab = (o: any) => {
        if (!o || typeof o !== 'object') return;
        const lv = o.lockupViewModel, pv = o.playlistVideoRenderer;
        if (lv && lv.contentId && /^[\w-]{11}$/.test(lv.contentId)) {
          const t = lv.metadata?.lockupMetadataViewModel?.title?.content || '';
          if (!seen.has(lv.contentId)) { seen.add(lv.contentId); entries.push({ id: lv.contentId, title: String(t).slice(0, 200) }); }
        } else if (pv && pv.videoId) {
          const t = pv.title?.runs?.[0]?.text || pv.title?.simpleText || '';
          if (!seen.has(pv.videoId)) { seen.add(pv.videoId); entries.push({ id: pv.videoId, title: String(t).slice(0, 200) }); }
        }
        if (Array.isArray(o)) o.forEach(grab); else for (const k in o) grab(o[k]);
      };

      for (let p = 0; p < pages; p++) {
        const body: any = cont ? { context: ctx, continuation: cont } : { context: ctx, browseId: 'VL' + list };
        const r = await fetch('/youtubei/v1/browse?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d: any = await r.json();
        if (!plTitle) plTitle = d?.header?.playlistHeaderRenderer?.title?.simpleText || d?.metadata?.playlistMetadataRenderer?.title || '';
        const before = entries.length;
        grab(d);
        // continuation token for the next page
        const findCont = (o: any): string | null => {
          if (!o || typeof o !== 'object') return null;
          const t = o.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          if (t) return t;
          if (Array.isArray(o)) { for (const x of o) { const r = findCont(x); if (r) return r; } }
          else { for (const k in o) { const r = findCont(o[k]); if (r) return r; } }
          return null;
        };
        cont = findCont(d);
        if (!cont || entries.length === before) break;
      }
      return { title: plTitle, entries };
    }, listId, maxPages);
  } finally {
    await browser.close();
  }
}

/** Discover contentLength for formats that omit it (progressive), via Content-Range. */
export async function discoverLength(url: string): Promise<number> {
  const p = await fetch(url, { headers: { Range: 'bytes=0-1' } });
  const cr = p.headers.get('content-range');
  return cr ? parseInt(cr.split('/')[1], 10) : 0;
}
