import HTML from './index.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      return handleAPI(path, request, env);
    }

    return new Response(HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
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
    const rangeHeader = request.headers.get('Range');
    let object;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const offset = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : undefined;
        const length = end !== undefined ? end - offset + 1 : undefined;
        object = await env.MEDIA_BUCKET.get(key, { range: { offset, length } });
      }
    }

    if (!object) {
      object = await env.MEDIA_BUCKET.get(key);
    }

    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const respHeaders = new Headers();
    object.writeHttpMetadata(respHeaders);
    respHeaders.set('Accept-Ranges', 'bytes');
    respHeaders.set('Cache-Control', 'public, max-age=86400');

    if (rangeHeader && object.range) {
      const { offset, length } = object.range;
      respHeaders.set('Content-Range', 'bytes ' + offset + '-' + (offset + length - 1) + '/' + object.size);
      respHeaders.set('Content-Length', String(length));
      return new Response(object.body, { status: 206, headers: respHeaders });
    }

    respHeaders.set('Content-Length', String(object.size));
    return new Response(object.body, { headers: respHeaders });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
}
