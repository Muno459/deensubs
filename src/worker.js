export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes
    if (path.startsWith('/api/')) {
      return handleAPI(path, request, env);
    }

    // Serve static assets
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

  // GET /api/videos - list available videos
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

  // GET /api/media/:key - serve media from R2
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
  // SPA fallback
  if (path === '/' || !path.includes('.')) {
    return new Response(HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response('Not found', { status: 404 });
}

const HTML = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeenSubs - Islamic Content with English Subtitles</title>
  <meta name="description" content="Arabic Islamic content translated into English using AI-powered transcription and translation.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Amiri:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #0a0a0a;
      --surface: #141414;
      --surface-2: #1e1e1e;
      --border: #2a2a2a;
      --text: #f0f0f0;
      --text-muted: #888;
      --accent: #c8a96e;
      --accent-soft: rgba(200, 169, 110, 0.1);
      --radius: 12px;
    }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* Header */
    header {
      border-bottom: 1px solid var(--border);
      padding: 1rem 0;
      position: sticky;
      top: 0;
      background: rgba(10, 10, 10, 0.9);
      backdrop-filter: blur(20px);
      z-index: 100;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: var(--text);
    }

    .logo-icon {
      width: 36px;
      height: 36px;
      background: var(--accent);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Amiri', serif;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--bg);
    }

    .logo-text {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .nav-links {
      display: flex;
      gap: 2rem;
      list-style: none;
    }

    .nav-links a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: color 0.2s;
    }

    .nav-links a:hover { color: var(--text); }

    /* Hero */
    .hero {
      padding: 6rem 0 4rem;
      text-align: center;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 1rem;
      background: var(--accent-soft);
      border: 1px solid rgba(200, 169, 110, 0.2);
      border-radius: 100px;
      font-size: 0.8rem;
      color: var(--accent);
      margin-bottom: 1.5rem;
    }

    .hero h1 {
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 1rem;
    }

    .hero h1 .arabic {
      font-family: 'Amiri', serif;
      color: var(--accent);
      display: block;
      font-size: 0.7em;
      margin-bottom: 0.25rem;
      direction: rtl;
    }

    .hero p {
      color: var(--text-muted);
      font-size: 1.1rem;
      max-width: 600px;
      margin: 0 auto 2.5rem;
    }

    /* Video Grid */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .section-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .videos-section {
      padding: 3rem 0;
    }

    .video-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1.25rem;
    }

    .video-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition: border-color 0.2s, transform 0.2s;
      cursor: pointer;
    }

    .video-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }

    .video-thumb {
      aspect-ratio: 16/9;
      background: var(--surface-2);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .video-thumb .play-icon {
      width: 48px;
      height: 48px;
      background: rgba(200, 169, 110, 0.9);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .play-icon::after {
      content: '';
      display: block;
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 8px 0 8px 14px;
      border-color: transparent transparent transparent var(--bg);
      margin-left: 3px;
    }

    .video-info {
      padding: 1rem 1.25rem;
    }

    .video-info h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.35rem;
      letter-spacing: -0.01em;
    }

    .video-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .tag {
      background: var(--accent-soft);
      color: var(--accent);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    /* How it works */
    .how-section {
      padding: 4rem 0;
      border-top: 1px solid var(--border);
    }

    .how-section h2 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 2rem;
      letter-spacing: -0.02em;
    }

    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.5rem;
    }

    .step {
      padding: 1.5rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .step-num {
      width: 32px;
      height: 32px;
      background: var(--accent-soft);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--accent);
      margin-bottom: 0.75rem;
    }

    .step h3 {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 0.35rem;
    }

    .step p {
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* Footer */
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem 0;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted);
    }

    .empty-state p { margin-bottom: 0.5rem; }

    @media (max-width: 640px) {
      .video-grid { grid-template-columns: 1fr; }
      .nav-links { display: none; }
      .hero { padding: 4rem 0 2rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <nav>
        <a href="/" class="logo">
          <div class="logo-icon">د</div>
          <span class="logo-text">DeenSubs</span>
        </a>
        <ul class="nav-links">
          <li><a href="#videos">Videos</a></li>
          <li><a href="#how">How it works</a></li>
          <li><a href="#about">About</a></li>
        </ul>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="container">
        <div class="hero-badge">AI-Powered Subtitles</div>
        <h1>
          <span class="arabic">دين سبز</span>
          Islamic Content, Translated
        </h1>
        <p>Arabic Islamic lectures and content with accurate English subtitles, powered by ElevenLabs Scribe and AI translation.</p>
      </div>
    </section>

    <section class="videos-section" id="videos">
      <div class="container">
        <div class="section-header">
          <h2>Latest Videos</h2>
        </div>
        <div class="video-grid" id="video-grid">
          <div class="empty-state">
            <p>No videos yet</p>
            <p style="font-size: 0.8rem;">Content is being prepared — check back soon.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="how-section" id="how">
      <div class="container">
        <h2>How it works</h2>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <h3>Source Content</h3>
            <p>Arabic Islamic lectures and talks are collected from trusted scholars and sources.</p>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <h3>ASR Transcription</h3>
            <p>ElevenLabs Scribe v2 transcribes the Arabic audio with high accuracy.</p>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <h3>AI Translation</h3>
            <p>The transcription is translated into English while preserving Islamic terminology.</p>
          </div>
          <div class="step">
            <div class="step-num">4</div>
            <h3>Subtitle Sync</h3>
            <p>Subtitles are synced and rendered on the video for a seamless viewing experience.</p>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer id="about">
    <div class="container">
      <p>&copy; 2026 DeenSubs. Making Islamic knowledge accessible.</p>
    </div>
  </footer>

  <script>
    async function loadVideos() {
      try {
        const res = await fetch('/api/videos');
        const data = await res.json();
        if (data.videos && data.videos.length > 0) {
          const grid = document.getElementById('video-grid');
          grid.innerHTML = data.videos.map(v => \`
            <div class="video-card" onclick="window.location='/watch/\${encodeURIComponent(v.key)}'">
              <div class="video-thumb"><div class="play-icon"></div></div>
              <div class="video-info">
                <h3>\${v.key.replace('videos/', '').replace(/\\.[^.]+$/, '')}</h3>
                <div class="video-meta">
                  <span class="tag">Arabic → English</span>
                  <span>\${(v.size / 1048576).toFixed(1)} MB</span>
                </div>
              </div>
            </div>
          \`).join('');
        }
      } catch {}
    }
    loadVideos();
  </script>
</body>
</html>`;
