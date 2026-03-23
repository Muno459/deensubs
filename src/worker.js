export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      return handleAPI(path, request, env);
    }

    return serveStatic(path, env);
  },
};

async function handleAPI(path, request, env) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }

  if (path === '/api/videos' && request.method === 'GET') {
    try {
      const list = await env.MEDIA_BUCKET.list({ prefix: 'videos/' });
      const videos = list.objects.map((obj) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded,
      }));
      return new Response(JSON.stringify({ videos }), { headers });
    } catch {
      return new Response(JSON.stringify({ videos: [] }), { headers });
    }
  }

  if (path.startsWith('/api/media/') && request.method === 'GET') {
    const key = decodeURIComponent(path.replace('/api/media/', ''));
    const object = await env.MEDIA_BUCKET.get(key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }
    const respHeaders = new Headers();
    object.writeHttpMetadata(respHeaders);
    respHeaders.set('Cache-Control', 'public, max-age=86400');
    return new Response(object.body, { headers: respHeaders });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
}

async function serveStatic(path, env) {
  if (path === '/' || !path.includes('.')) {
    return new Response(HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return new Response('Not found', { status: 404 });
}

const HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="view-transition" content="same-origin">
  <title>DeenSubs — Islamic Content, Translated</title>
  <meta name="description" content="Arabic Islamic lectures with AI-powered English subtitles. Transcribed by ElevenLabs Scribe, translated with precision.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&family=Amiri:ital,wght@0,400;0,700;1,400&family=Outfit:wght@200;300;400;500;600&display=swap" rel="stylesheet">
  <style>
    @property --glow-intensity {
      syntax: '<number>';
      inherits: false;
      initial-value: 0.2;
    }

    @property --gradient-angle {
      syntax: '<angle>';
      inherits: false;
      initial-value: 0deg;
    }

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #050507;
      --surface: #0c0c11;
      --surface-2: #131319;
      --surface-3: #1a1a22;
      --border: rgba(196, 164, 76, 0.05);
      --border-hover: rgba(196, 164, 76, 0.16);
      --gold: #c4a44c;
      --gold-bright: #dbb960;
      --gold-pale: rgba(196, 164, 76, 0.06);
      --gold-glow: rgba(196, 164, 76, 0.1);
      --text: #eae6da;
      --text-2: #807c72;
      --text-3: #4a4840;
      --radius: 14px;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: 'Outfit', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
      cursor: default;
    }

    ::selection {
      background: rgba(196, 164, 76, 0.25);
      color: var(--text);
    }

    /* ═══ Grain ═══ */
    .grain {
      position: fixed; inset: 0; pointer-events: none; z-index: 9999; opacity: 0.022;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }

    /* ═══ Geometric Tiling ═══ */
    .geo-tile {
      position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.5;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'%3E%3Crect x='18' y='18' width='54' height='54' fill='none' stroke='rgba(196,164,76,0.025)' stroke-width='0.5'/%3E%3Crect x='18' y='18' width='54' height='54' fill='none' stroke='rgba(196,164,76,0.025)' stroke-width='0.5' transform='rotate(45 45 45)'/%3E%3Ccircle cx='45' cy='45' r='4' fill='none' stroke='rgba(196,164,76,0.015)' stroke-width='0.4'/%3E%3Ccircle cx='45' cy='45' r='1.2' fill='rgba(196,164,76,0.015)'/%3E%3C/svg%3E");
      background-size: 90px 90px;
    }

    /* ═══ Floating Geometry ═══ */
    .floater {
      position: fixed;
      pointer-events: none;
      z-index: 0;
      opacity: 0;
      animation: floaterIn 2s ease forwards, floaterDrift 20s ease-in-out infinite;
    }

    .floater svg { width: 100%; height: 100%; }

    @keyframes floaterIn { to { opacity: 1; } }
    @keyframes floaterDrift {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      33% { transform: translateY(-20px) rotate(5deg); }
      66% { transform: translateY(10px) rotate(-3deg); }
    }

    /* ═══ Container ═══ */
    .container { max-width: 1100px; margin: 0 auto; padding: 0 2rem; position: relative; z-index: 1; }

    /* ═══ Header ═══ */
    header {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      padding: 1.15rem 0;
      border-bottom: 1px solid transparent;
      transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);
    }
    header.scrolled {
      background: rgba(5, 5, 7, 0.88);
      backdrop-filter: blur(28px) saturate(1.3);
      border-bottom-color: var(--border);
    }

    nav { display: flex; align-items: center; justify-content: space-between; }

    .logo {
      display: flex; align-items: center; gap: 0.85rem;
      text-decoration: none; color: var(--text);
    }

    .logo-mark {
      width: 38px; height: 38px;
      position: relative;
      display: flex; align-items: center; justify-content: center;
    }
    .logo-mark svg {
      position: absolute; inset: 0;
      animation: logoSpin 40s linear infinite;
    }
    .logo-mark .ll {
      font-family: 'Amiri', serif; font-size: 1.1rem; font-weight: 700;
      color: var(--gold); position: relative; z-index: 1;
    }
    @keyframes logoSpin { to { transform: rotate(360deg); } }

    .logo-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.45rem; font-weight: 600; letter-spacing: 0.04em;
    }

    .nav-links { display: flex; gap: 2.5rem; list-style: none; }
    .nav-links a {
      color: var(--text-2); text-decoration: none;
      font-size: 0.8rem; font-weight: 400;
      letter-spacing: 0.08em; text-transform: uppercase;
      transition: color 0.3s; position: relative;
    }
    .nav-links a::after {
      content: ''; position: absolute; bottom: -4px; left: 0;
      width: 0; height: 1px; background: var(--gold);
      transition: width 0.4s cubic-bezier(0.23, 1, 0.32, 1);
    }
    .nav-links a:hover { color: var(--gold); }
    .nav-links a:hover::after { width: 100%; }

    .menu-btn {
      display: none; background: none; border: none; cursor: pointer; padding: 0.5rem;
    }
    .menu-btn span {
      display: block; width: 18px; height: 1.5px;
      background: var(--text-2); margin: 4px 0; transition: all 0.3s;
    }

    /* ═══ Hero ═══ */
    .hero {
      min-height: 100vh; min-height: 100dvh;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center;
      padding: 6rem 2rem 4rem;
      position: relative; overflow: hidden;
    }

    .hero::before {
      content: ''; position: absolute;
      top: 50%; left: 50%; width: 900px; height: 900px;
      transform: translate(-50%, -50%);
      background: radial-gradient(circle, rgba(196,164,76,0.035) 0%, transparent 65%);
      pointer-events: none;
    }

    .hero-ornament {
      width: 260px; height: 260px;
      margin-bottom: 2.5rem;
      position: relative;
      will-change: transform;
    }
    .hero-ornament svg { width: 100%; height: 100%; }

    .orn-ring-1 { animation: spinCW 80s linear infinite; transform-origin: center; }
    .orn-ring-2 { animation: spinCCW 55s linear infinite; transform-origin: center; }
    .orn-ring-3 { animation: spinCW 35s linear infinite; transform-origin: center; }

    @keyframes spinCW { to { transform: rotate(360deg); } }
    @keyframes spinCCW { to { transform: rotate(-360deg); } }

    @supports (animation-timeline: scroll()) {
      .hero-ornament {
        animation: ornamentScroll linear both;
        animation-timeline: scroll();
        animation-range: 0vh 60vh;
      }
      @keyframes ornamentScroll {
        to { opacity: 0; transform: scale(0.7) translateY(-60px); }
      }
    }

    .hero-bismillah {
      font-family: 'Amiri', serif;
      font-size: clamp(1.5rem, 3.2vw, 2.3rem);
      color: var(--gold);
      direction: rtl;
      margin-bottom: 1rem;
      text-shadow: 0 0 60px rgba(196,164,76, var(--glow-intensity)), 0 0 120px rgba(196,164,76,0.06);
      animation: heroFade 1.2s ease forwards 0.2s, glowPulse 5s ease-in-out infinite alternate 1.4s;
      opacity: 0;
      text-wrap: balance;
    }
    @keyframes glowPulse {
      from { --glow-intensity: 0.15; }
      to { --glow-intensity: 0.35; }
    }
    @keyframes heroFade {
      from { opacity: 0; transform: translateY(24px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .hero-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: clamp(3.2rem, 8vw, 6.5rem);
      font-weight: 300; letter-spacing: 0.14em;
      line-height: 1; margin-bottom: 0.4rem;
      opacity: 0; animation: heroFade 1.2s ease forwards 0.5s;
      text-wrap: balance;
    }
    .hero-title strong { font-weight: 700; color: var(--gold); }

    .hero-sub {
      font-family: 'Cormorant Garamond', serif;
      font-size: clamp(1rem, 1.8vw, 1.35rem);
      font-weight: 300; font-style: italic;
      color: var(--text-2); letter-spacing: 0.05em;
      margin-bottom: 1.75rem;
      opacity: 0; animation: heroFade 1s ease forwards 0.8s;
    }

    .hero-desc {
      max-width: 500px; color: var(--text-2);
      font-size: 0.9rem; font-weight: 300;
      line-height: 1.75;
      opacity: 0; animation: heroFade 1s ease forwards 1s;
      text-wrap: balance;
    }

    .hero-cta {
      margin-top: 2.5rem;
      display: inline-flex; align-items: center; gap: 0.6rem;
      padding: 0.8rem 2.2rem;
      background: transparent;
      border: 1px solid var(--border-hover);
      border-radius: 100px;
      color: var(--gold);
      text-decoration: none;
      font-size: 0.8rem; font-weight: 500;
      letter-spacing: 0.07em; text-transform: uppercase;
      transition: all 0.5s cubic-bezier(0.23,1,0.32,1);
      opacity: 0; animation: heroFade 1s ease forwards 1.2s;
      position: relative; overflow: hidden;
    }
    .hero-cta::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(circle at var(--mx, 50%) var(--my, 50%), rgba(196,164,76,0.12), transparent 60%);
      opacity: 0; transition: opacity 0.4s;
    }
    .hero-cta:hover::before { opacity: 1; }
    .hero-cta:hover {
      border-color: var(--gold);
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(196,164,76,0.1);
    }
    .hero-cta svg { transition: transform 0.3s; }
    .hero-cta:hover svg { transform: translateY(3px); }

    .scroll-hint {
      position: absolute; bottom: 2rem; left: 50%;
      transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
      color: var(--text-3); font-size: 0.65rem;
      letter-spacing: 0.18em; text-transform: uppercase;
      animation: scrollPulse 2.5s ease-in-out infinite;
    }
    .scroll-hint .ln {
      width: 1px; height: 28px;
      background: linear-gradient(to bottom, var(--gold), transparent);
    }
    @keyframes scrollPulse {
      0%,100% { opacity: 0.8; transform: translateX(-50%) translateY(0); }
      50% { opacity: 0.3; transform: translateX(-50%) translateY(8px); }
    }

    /* ═══ Divider ═══ */
    .divider {
      height: 1px; max-width: 500px; margin: 0 auto;
      background: linear-gradient(to right, transparent, rgba(196,164,76,0.12), transparent);
    }

    /* ═══ Section ═══ */
    .section { padding: 6rem 0; position: relative; }

    .section-label {
      font-size: 0.65rem; font-weight: 500;
      letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--gold); margin-bottom: 0.75rem;
      display: flex; align-items: center; gap: 1rem;
    }
    .section-label::before {
      content: ''; width: 20px; height: 1px; background: var(--gold);
    }

    .section-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: clamp(1.8rem, 3.5vw, 2.8rem);
      font-weight: 300; margin-bottom: 2.5rem;
      line-height: 1.15; text-wrap: balance;
    }
    .section-title em { font-style: italic; color: var(--gold); }

    /* ═══ Featured Card ═══ */
    .featured {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--surface);
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      margin-bottom: 2rem;
      transition: all 0.6s cubic-bezier(0.23,1,0.32,1);
      position: relative;
    }
    .featured::after {
      content: ''; position: absolute; inset: 0; border-radius: var(--radius);
      background: radial-gradient(800px circle at var(--mx, 50%) var(--my, 50%), rgba(196,164,76,0.04), transparent 40%);
      opacity: 0; transition: opacity 0.5s; pointer-events: none;
    }
    .featured:hover { border-color: var(--border-hover); }
    .featured:hover::after { opacity: 1; }

    .featured-thumb {
      aspect-ratio: 16/10;
      background: linear-gradient(135deg, #0a0a12 0%, #12121e 50%, #0e0e18 100%);
      position: relative; overflow: hidden; cursor: pointer;
    }
    .featured-thumb::before {
      content: ''; position: absolute; inset: 0;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Crect x='25' y='25' width='70' height='70' fill='none' stroke='rgba(196,164,76,0.04)' stroke-width='0.5'/%3E%3Crect x='25' y='25' width='70' height='70' fill='none' stroke='rgba(196,164,76,0.04)' stroke-width='0.5' transform='rotate(45 60 60)'/%3E%3C/svg%3E");
      background-size: 120px; opacity: 0.6;
    }
    .featured-thumb::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(135deg, transparent 40%, var(--surface) 100%);
    }

    .featured-play {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%); z-index: 2;
      width: 64px; height: 64px;
      border-radius: 50%;
      background: rgba(196,164,76,0.85);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 40px rgba(196,164,76,0.2);
      transition: all 0.5s cubic-bezier(0.23,1,0.32,1);
      cursor: pointer;
    }
    .featured-play::after {
      content: ''; width: 0; height: 0;
      border-style: solid; border-width: 11px 0 11px 18px;
      border-color: transparent transparent transparent var(--bg);
      margin-left: 4px;
    }
    .featured-play::before {
      content: ''; position: absolute; inset: -6px;
      border-radius: 50%;
      border: 1px solid rgba(196,164,76,0.2);
      animation: playRing 2s ease-in-out infinite;
    }
    @keyframes playRing {
      0%,100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0; }
    }
    .featured:hover .featured-play {
      transform: translate(-50%, -50%) scale(1.1);
      box-shadow: 0 12px 50px rgba(196,164,76,0.3);
    }

    .featured-badge {
      position: absolute; top: 1.25rem; left: 1.25rem; z-index: 2;
      padding: 0.3rem 0.85rem;
      background: rgba(5,5,7,0.7);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(196,164,76,0.12);
      border-radius: 100px;
      font-size: 0.68rem; font-weight: 500;
      color: var(--gold); letter-spacing: 0.04em;
    }

    .featured-info {
      padding: 2.5rem;
      display: flex; flex-direction: column; justify-content: center;
    }

    .featured-ar {
      font-family: 'Amiri', serif;
      font-size: 1.5rem; color: var(--gold);
      direction: rtl; margin-bottom: 0.5rem;
      text-shadow: 0 0 30px rgba(196,164,76,0.15);
    }

    .featured-info h3 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.75rem; font-weight: 500;
      margin-bottom: 0.35rem; line-height: 1.25;
    }

    .featured-source {
      color: var(--text-2); font-size: 0.82rem;
      font-weight: 300; margin-bottom: 1rem;
    }

    .featured-tags {
      display: flex; align-items: center; gap: 0.6rem;
      margin-bottom: 1.25rem;
    }

    .tag {
      display: inline-flex; align-items: center; gap: 0.3rem;
      padding: 0.2rem 0.6rem;
      background: var(--gold-pale);
      border: 1px solid rgba(196,164,76,0.06);
      border-radius: 100px;
      color: var(--gold); font-size: 0.68rem;
      font-weight: 500; letter-spacing: 0.02em;
    }

    .featured-quote {
      color: var(--text-2); font-size: 0.85rem;
      font-style: italic; font-weight: 300;
      line-height: 1.7; border-left: 2px solid rgba(196,164,76,0.15);
      padding-left: 1rem;
      font-family: 'Cormorant Garamond', serif;
      font-size: 1rem;
    }

    /* ═══ Video Grid ═══ */
    .video-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1.25rem;
    }

    .video-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden; cursor: pointer;
      transition: all 0.5s cubic-bezier(0.23,1,0.32,1);
      position: relative;
      transform-style: preserve-3d;
    }
    .video-card::after {
      content: ''; position: absolute; inset: 0; border-radius: var(--radius);
      background: radial-gradient(500px circle at var(--mx, 50%) var(--my, 50%), rgba(196,164,76,0.045), transparent 40%);
      opacity: 0; transition: opacity 0.4s; pointer-events: none;
    }
    .video-card:hover {
      border-color: var(--border-hover);
      transform: translateY(-5px);
      box-shadow: 0 20px 50px rgba(0,0,0,0.4), 0 0 30px rgba(196,164,76,0.03);
    }
    .video-card:hover::after { opacity: 1; }

    .video-thumb {
      aspect-ratio: 16/9;
      background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
      position: relative; overflow: hidden;
    }
    .video-thumb::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(to top, var(--surface) 0%, transparent 50%);
    }

    .play-sm {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 44px; height: 44px; border-radius: 50%;
      background: rgba(196,164,76,0.8);
      display: flex; align-items: center; justify-content: center;
      z-index: 2;
      transition: all 0.4s cubic-bezier(0.23,1,0.32,1);
      box-shadow: 0 6px 24px rgba(196,164,76,0.15);
    }
    .play-sm::after {
      content: ''; width: 0; height: 0;
      border-style: solid; border-width: 7px 0 7px 12px;
      border-color: transparent transparent transparent var(--bg);
      margin-left: 2px;
    }
    .video-card:hover .play-sm {
      transform: translate(-50%, -50%) scale(1.1);
    }

    .video-body { padding: 1.1rem 1.3rem 1.3rem; position: relative; z-index: 2; }
    .video-body h3 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.1rem; font-weight: 600;
      margin-bottom: 0.4rem; line-height: 1.3;
    }
    .video-meta {
      display: flex; align-items: center; gap: 0.6rem;
      font-size: 0.75rem; color: var(--text-2);
    }

    /* ═══ Pipeline ═══ */
    .pipeline {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
    }

    .pipe-card {
      padding: 2rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      position: relative; overflow: hidden;
      transition: all 0.5s cubic-bezier(0.23,1,0.32,1);
    }
    .pipe-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(to right, transparent, var(--gold), transparent);
      opacity: 0; transition: opacity 0.5s;
    }
    .pipe-card::after {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(400px circle at var(--mx, 50%) var(--my, 50%), rgba(196,164,76,0.035), transparent 40%);
      opacity: 0; transition: opacity 0.4s; pointer-events: none;
    }
    .pipe-card:hover {
      border-color: var(--border-hover);
      transform: translateY(-4px);
      box-shadow: 0 16px 44px rgba(0,0,0,0.3);
    }
    .pipe-card:hover::before { opacity: 0.4; }
    .pipe-card:hover::after { opacity: 1; }

    .pipe-num {
      font-family: 'Cormorant Garamond', serif;
      font-size: 3rem; font-weight: 300;
      color: var(--gold); opacity: 0.1;
      line-height: 1; margin-bottom: 0.75rem;
      transition: opacity 0.3s;
    }
    .pipe-card:hover .pipe-num { opacity: 0.25; }

    .pipe-icon {
      width: 40px; height: 40px;
      border-radius: 10px;
      background: var(--gold-pale);
      border: 1px solid rgba(196,164,76,0.06);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 1.1rem; color: var(--gold);
    }

    .pipe-card h3 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.2rem; font-weight: 600; margin-bottom: 0.4rem;
    }
    .pipe-card p {
      color: var(--text-2); font-size: 0.82rem;
      line-height: 1.65; font-weight: 300;
    }

    /* ═══ About ═══ */
    .about { text-align: center; padding: 5rem 0; }
    .about-ayah {
      font-family: 'Amiri', serif;
      font-size: clamp(1.3rem, 2.2vw, 1.7rem);
      color: var(--gold); direction: rtl;
      margin-bottom: 1.25rem;
      text-shadow: 0 0 40px rgba(196,164,76,0.12);
    }
    .about-text {
      max-width: 520px; margin: 0 auto;
      color: var(--text-2); font-size: 0.9rem;
      line-height: 1.8; font-weight: 300;
      text-wrap: balance;
    }
    .about-text strong { color: var(--text); font-weight: 500; }

    /* ═══ Footer ═══ */
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem 0; position: relative; z-index: 1;
    }
    .footer-inner {
      display: flex; align-items: center; justify-content: space-between;
    }
    .footer-copy { color: var(--text-3); font-size: 0.75rem; font-weight: 300; }
    .footer-links { display: flex; gap: 1.5rem; list-style: none; }
    .footer-links a {
      color: var(--text-3); text-decoration: none; font-size: 0.75rem;
      transition: color 0.3s;
    }
    .footer-links a:hover { color: var(--gold); }

    /* ═══ Reveal ═══ */
    .reveal {
      opacity: 0; transform: translateY(28px);
      transition: opacity 1s cubic-bezier(0.23,1,0.32,1), transform 1s cubic-bezier(0.23,1,0.32,1);
    }
    .reveal.vis { opacity: 1; transform: translateY(0); }
    .rd1 { transition-delay: 0.08s; }
    .rd2 { transition-delay: 0.16s; }
    .rd3 { transition-delay: 0.24s; }
    .rd4 { transition-delay: 0.32s; }

    @supports (animation-timeline: scroll()) {
      .section { animation: sectionFade linear both; animation-timeline: view(); animation-range: entry 0% entry 30%; }
      @keyframes sectionFade { from { opacity: 0.4; } to { opacity: 1; } }
    }

    /* ═══ Reduced Motion ═══ */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
      .reveal { opacity: 1; transform: none; }
    }

    /* ═══ Mobile ═══ */
    @media (max-width: 768px) {
      .nav-links { display: none; }
      .menu-btn { display: block; }
      .hero-ornament { width: 170px; height: 170px; }
      .hero-title { letter-spacing: 0.06em; }
      .featured { grid-template-columns: 1fr; }
      .featured-thumb { aspect-ratio: 16/9; }
      .featured-info { padding: 1.75rem; }
      .pipeline { grid-template-columns: 1fr; }
      .video-grid { grid-template-columns: 1fr; }
      .section { padding: 4rem 0; }
      .footer-inner { flex-direction: column; gap: 1rem; }
      .scroll-hint { display: none; }
      .floater { display: none; }
    }
    @media (max-width: 480px) {
      .container { padding: 0 1.25rem; }
      .hero { padding: 5rem 1.25rem 3rem; }
      .hero-ornament { width: 130px; height: 130px; }
      .pipe-card { padding: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="grain"></div>
  <div class="geo-tile"></div>

  <!-- Floating geometry -->
  <div class="floater" style="top:15%;left:5%;width:50px;height:50px;animation-delay:0s,0s;opacity:0.04">
    <svg viewBox="0 0 50 50" fill="none"><rect x="10" y="10" width="30" height="30" stroke="rgba(196,164,76,0.3)" stroke-width="0.5" transform="rotate(45 25 25)"/><rect x="10" y="10" width="30" height="30" stroke="rgba(196,164,76,0.3)" stroke-width="0.5"/></svg>
  </div>
  <div class="floater" style="top:45%;right:8%;width:35px;height:35px;animation-delay:1s,3s;opacity:0.03">
    <svg viewBox="0 0 35 35" fill="none"><circle cx="17.5" cy="17.5" r="14" stroke="rgba(196,164,76,0.3)" stroke-width="0.5"/><rect x="7" y="7" width="21" height="21" stroke="rgba(196,164,76,0.2)" stroke-width="0.5" transform="rotate(45 17.5 17.5)"/></svg>
  </div>
  <div class="floater" style="top:72%;left:12%;width:40px;height:40px;animation-delay:2s,6s;opacity:0.035">
    <svg viewBox="0 0 40 40" fill="none"><rect x="8" y="8" width="24" height="24" stroke="rgba(196,164,76,0.25)" stroke-width="0.5"/><rect x="8" y="8" width="24" height="24" stroke="rgba(196,164,76,0.25)" stroke-width="0.5" transform="rotate(45 20 20)"/></svg>
  </div>

  <!-- Header -->
  <header id="hdr">
    <div class="container">
      <nav>
        <a href="/" class="logo">
          <div class="logo-mark">
            <svg viewBox="0 0 38 38" fill="none">
              <rect x="7" y="7" width="24" height="24" stroke="rgba(196,164,76,0.35)" stroke-width="0.6"/>
              <rect x="7" y="7" width="24" height="24" stroke="rgba(196,164,76,0.35)" stroke-width="0.6" transform="rotate(45 19 19)"/>
              <circle cx="19" cy="19" r="3.5" stroke="rgba(196,164,76,0.25)" stroke-width="0.5"/>
            </svg>
            <span class="ll">د</span>
          </div>
          <span class="logo-name">DeenSubs</span>
        </a>
        <ul class="nav-links">
          <li><a href="#content">Content</a></li>
          <li><a href="#process">Process</a></li>
          <li><a href="#about">About</a></li>
        </ul>
        <button class="menu-btn" aria-label="Menu"><span></span><span></span><span></span></button>
      </nav>
    </div>
  </header>

  <!-- Hero -->
  <section class="hero" id="hero-section">
    <div class="hero-ornament" id="ornament">
      <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="200" cy="200" r="195" stroke="rgba(196,164,76,0.05)" stroke-width="0.5"/>
        <circle cx="200" cy="200" r="188" stroke="rgba(196,164,76,0.03)" stroke-width="0.5" stroke-dasharray="3 5"/>
        <g class="orn-ring-1">
          <rect x="73" y="73" width="254" height="254" stroke="rgba(196,164,76,0.08)" stroke-width="0.6" transform="rotate(45 200 200)"/>
          <rect x="73" y="73" width="254" height="254" stroke="rgba(196,164,76,0.08)" stroke-width="0.6"/>
          <circle cx="200" cy="200" r="180" stroke="rgba(196,164,76,0.03)" stroke-width="0.4"/>
        </g>
        <g class="orn-ring-2">
          <rect x="108" y="108" width="184" height="184" stroke="rgba(196,164,76,0.11)" stroke-width="0.6" transform="rotate(45 200 200)"/>
          <rect x="108" y="108" width="184" height="184" stroke="rgba(196,164,76,0.11)" stroke-width="0.6"/>
          <circle cx="200" cy="200" r="130" stroke="rgba(196,164,76,0.05)" stroke-width="0.4"/>
        </g>
        <g class="orn-ring-3">
          <rect x="150" y="150" width="100" height="100" stroke="rgba(196,164,76,0.15)" stroke-width="0.7" transform="rotate(45 200 200)"/>
          <rect x="150" y="150" width="100" height="100" stroke="rgba(196,164,76,0.15)" stroke-width="0.7"/>
          <circle cx="200" cy="200" r="70" stroke="rgba(196,164,76,0.06)" stroke-width="0.4"/>
        </g>
        <circle cx="200" cy="200" r="28" stroke="rgba(196,164,76,0.18)" stroke-width="0.6"/>
        <circle cx="200" cy="200" r="10" fill="rgba(196,164,76,0.06)" stroke="rgba(196,164,76,0.18)" stroke-width="0.5"/>
        <line x1="200" y1="5" x2="200" y2="395" stroke="rgba(196,164,76,0.02)" stroke-width="0.4"/>
        <line x1="5" y1="200" x2="395" y2="200" stroke="rgba(196,164,76,0.02)" stroke-width="0.4"/>
        <line x1="62" y1="62" x2="338" y2="338" stroke="rgba(196,164,76,0.02)" stroke-width="0.4"/>
        <line x1="338" y1="62" x2="62" y2="338" stroke="rgba(196,164,76,0.02)" stroke-width="0.4"/>
      </svg>
    </div>

    <div class="hero-bismillah">بِسْمِ ٱللَّٰهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ</div>
    <h1 class="hero-title">DEEN<strong>SUBS</strong></h1>
    <p class="hero-sub">Islamic Knowledge, Translated</p>
    <p class="hero-desc">Arabic Islamic lectures transcribed with AI precision and translated to English — making the words of scholars accessible across every language barrier.</p>
    <a href="#content" class="hero-cta" id="cta-btn">
      Explore Content
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v12m0 0l5-5m-5 5L2 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>
    <div class="scroll-hint"><div class="ln"></div>Scroll</div>
  </section>

  <div class="divider"></div>

  <!-- Content -->
  <section class="section" id="content">
    <div class="container">
      <div class="section-label reveal">Featured</div>
      <h2 class="section-title reveal">Latest <em>Content</em></h2>

      <!-- Featured Khutbah -->
      <div class="featured reveal rd1" id="featured-card">
        <div class="featured-thumb">
          <div class="featured-play"></div>
          <div class="featured-badge">Masjid al-Haram</div>
        </div>
        <div class="featured-info">
          <div class="featured-ar">خطبة الجمعة ١ شوّال</div>
          <h3>1st Shawwal Jumuah Khutbah</h3>
          <p class="featured-source">Masjid al-Haram, Makkah al-Mukarramah</p>
          <div class="featured-tags">
            <span class="tag">Arabic &rarr; English</span>
            <span class="tag">AI Subtitled</span>
          </div>
          <p class="featured-quote">"Praise be to Allah, who bestowed on us blessings, both outward and inward. We praise Him, Glorified be He, and thank Him..."</p>
        </div>
      </div>

      <div class="video-grid" id="video-grid"></div>
    </div>
  </section>

  <div class="divider"></div>

  <!-- Process -->
  <section class="section" id="process">
    <div class="container">
      <div class="section-label reveal">Process</div>
      <h2 class="section-title reveal">How It <em>Works</em></h2>
      <div class="pipeline">
        <div class="pipe-card reveal rd1">
          <div class="pipe-num">01</div>
          <div class="pipe-icon">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 7l7-5 7 5v8a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 16V10h4v6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <h3>Source Content</h3>
          <p>Arabic Islamic lectures and khutbahs collected from trusted scholars and masajid — Masjid al-Haram, Masjid an-Nabawi, and beyond.</p>
        </div>
        <div class="pipe-card reveal rd2">
          <div class="pipe-num">02</div>
          <div class="pipe-icon">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2a5 5 0 015 5v3a5 5 0 01-10 0V7a5 5 0 015-5z" stroke="currentColor" stroke-width="1.2"/><path d="M3 10a7 7 0 0014 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="10" y1="17" x2="10" y2="19" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </div>
          <h3>ASR Transcription</h3>
          <p>ElevenLabs Scribe v2 processes Arabic audio with state-of-the-art accuracy, capturing every word and nuance of the original speech.</p>
        </div>
        <div class="pipe-card reveal rd3">
          <div class="pipe-num">03</div>
          <div class="pipe-icon">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M2 5h8M2 10h5M2 15h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M12 5h6M12 10h6M12 15h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/><path d="M10 3v14" stroke="currentColor" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.3"/></svg>
          </div>
          <h3>AI Translation</h3>
          <p>Arabic transcription is translated to English with AI that deeply understands Islamic terminology, preserving scholarly meaning and intent.</p>
        </div>
        <div class="pipe-card reveal rd4">
          <div class="pipe-num">04</div>
          <div class="pipe-icon">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 17h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4 11h12" stroke="currentColor" stroke-width="0.8" opacity="0.4"/><path d="M5 9h6" stroke="currentColor" stroke-width="0.8" opacity="0.3"/></svg>
          </div>
          <h3>Subtitle Sync</h3>
          <p>Subtitles are precisely time-synced to the original audio and rendered on the video — a seamless bilingual viewing experience.</p>
        </div>
      </div>
    </div>
  </section>

  <div class="divider"></div>

  <!-- About -->
  <section class="about" id="about">
    <div class="container">
      <div class="about-ayah reveal">وَمَا أَرْسَلْنَاكَ إِلَّا رَحْمَةً لِّلْعَالَمِينَ</div>
      <p class="about-text reveal rd1">
        <strong>DeenSubs</strong> bridges the language gap between Arabic Islamic scholarship and English-speaking communities worldwide. Using cutting-edge AI transcription and translation, we make the knowledge of scholars accessible to everyone — preserving the depth and beauty of the original content.
      </p>
    </div>
  </section>

  <!-- Footer -->
  <footer>
    <div class="container">
      <div class="footer-inner">
        <span class="footer-copy">&copy; 2026 DeenSubs</span>
        <ul class="footer-links">
          <li><a href="https://github.com/Muno459/deensubs" target="_blank" rel="noopener">GitHub</a></li>
        </ul>
      </div>
    </div>
  </footer>

  <script>
    // ── Scroll Reveal ──
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('vis'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

    // ── Header scroll ──
    const hdr = document.getElementById('hdr');
    let tick = false;
    window.addEventListener('scroll', () => {
      if (!tick) { requestAnimationFrame(() => { hdr.classList.toggle('scrolled', scrollY > 50); tick = false; }); tick = true; }
    }, { passive: true });

    // ── Mouse-tracking glow on cards ──
    document.querySelectorAll('.featured, .video-card, .pipe-card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });

    // ── CTA button mouse glow ──
    const cta = document.getElementById('cta-btn');
    if (cta) {
      cta.addEventListener('mousemove', (e) => {
        const r = cta.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width * 100);
        const y = ((e.clientY - r.top) / r.height * 100);
        cta.style.setProperty('--mx', x + '%');
        cta.style.setProperty('--my', y + '%');
      });
    }

    // ── Hero parallax on mouse ──
    const ornament = document.getElementById('ornament');
    const hero = document.getElementById('hero-section');
    if (ornament && hero && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      hero.addEventListener('mousemove', (e) => {
        const x = (e.clientX / innerWidth - 0.5) * 2;
        const y = (e.clientY / innerHeight - 0.5) * 2;
        ornament.style.transform = 'translate(' + (x * 12) + 'px,' + (y * 12) + 'px)';
      });
      hero.addEventListener('mouseleave', () => {
        ornament.style.transition = 'transform 0.6s ease';
        ornament.style.transform = 'translate(0,0)';
        setTimeout(() => { ornament.style.transition = ''; }, 600);
      });
    }

    // ── Load API videos ──
    async function loadVideos() {
      try {
        const res = await fetch('/api/videos');
        const data = await res.json();
        if (data.videos && data.videos.length > 0) {
          const grid = document.getElementById('video-grid');
          grid.innerHTML = data.videos.map((v, i) => {
            const name = v.key.replace('videos/', '').replace(/\\.[^.]+$/, '').replace(/_/g, ' ');
            const d = Math.min(i + 1, 4);
            return '<div class="video-card reveal rd' + d + '">' +
              '<div class="video-thumb"><div class="play-sm"></div></div>' +
              '<div class="video-body">' +
              '<h3>' + name + '</h3>' +
              '<div class="video-meta">' +
              '<span class="tag">AR &rarr; EN</span>' +
              '<span>' + (v.size / 1048576).toFixed(1) + ' MB</span>' +
              '</div></div></div>';
          }).join('');
          grid.querySelectorAll('.reveal').forEach(el => obs.observe(el));
          grid.querySelectorAll('.video-card').forEach(card => {
            card.addEventListener('mousemove', (e) => {
              const r = card.getBoundingClientRect();
              card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
              card.style.setProperty('--my', (e.clientY - r.top) + 'px');
            });
          });
        }
      } catch {}
    }
    loadVideos();
  </script>
</body>
</html>\`;
