// Analytics Engine SQL query helper + pre-built queries
// Dataset: deensubs_analytics
//
// Full schema (15 blobs, 10 doubles used):
//   blob1:  event_type (pageview|watch|api|watch_event|admin|error)
//   blob2:  path
//   blob3:  slug (video slug)
//   blob4:  country (ISO 2-letter)
//   blob5:  city
//   blob6:  referer
//   blob7:  ip
//   blob8:  device_type (mobile|tablet|desktop)
//   blob9:  browser (Chrome|Firefox|Safari|Edge|Other)
//   blob10: os (Windows|macOS|Android|iOS|Linux|Other)
//   blob11: method (GET|POST)
//   blob12: content_type OR watch event subtype (play/pause/seek/end/buffer)
//   blob13: category slug
//   blob14: scholar slug
//   blob15: user_agent OR fingerprint_id (for watch_events)
//   blob16: connection type (for watch_events)
//
//   double1:  user_id (0 = anonymous)
//   double2:  status_code
//   double3:  response_time_ms
//   double4:  content_length_bytes
//   double5:  position (watch events, seconds)
//   double6:  duration (watch events, seconds)
//   double7:  buffered (watch events, seconds)
//   double8:  bandwidth (watch events, mbps)
//   double9:  completion_pct (watch events, 0-100)
//   double10: has_engaged (watch events, 0 or 1)
//
// Sampling: use sum(_sample_interval) instead of count() for accurate totals

const D = 'deensubs_analytics';

export async function queryAE(env, sql) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  const resp = await fetch(api, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.CF_API_TOKEN },
    body: sql,
  });
  if (resp.status !== 200) return { error: await resp.text(), status: resp.status, data: [] };
  return await resp.json();
}

export const Q = {
  // ── Traffic ──
  realtimeTraffic: () => `SELECT blob1 AS type, sum(_sample_interval) AS hits, uniq(blob7) AS unique_visitors FROM ${D} WHERE timestamp > NOW() - INTERVAL '1' HOUR GROUP BY type ORDER BY hits DESC`,
  dailyTraffic: (days = 14) => `SELECT toDate(timestamp) AS day, sum(_sample_interval) AS hits, uniq(blob7) AS unique_visitors FROM ${D} WHERE blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY day ORDER BY day DESC`,
  hourlyTraffic: () => `SELECT toHour(timestamp) AS hour, sum(_sample_interval) AS hits FROM ${D} WHERE blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '24' HOUR GROUP BY hour ORDER BY hour`,

  // ── Geography ──
  topCountries: (days = 7) => `SELECT blob4 AS country, sum(_sample_interval) AS hits, uniq(blob7) AS unique_visitors FROM ${D} WHERE blob4 != '' AND blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY country ORDER BY hits DESC LIMIT 30`,
  topCities: (days = 7) => `SELECT blob4 AS country, blob5 AS city, sum(_sample_interval) AS hits FROM ${D} WHERE blob5 != '' AND blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY country, city ORDER BY hits DESC LIMIT 30`,

  // ── Content ──
  topPages: (days = 7) => `SELECT blob2 AS path, sum(_sample_interval) AS hits FROM ${D} WHERE blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY path ORDER BY hits DESC LIMIT 20`,
  topVideos: (days = 7) => `SELECT blob3 AS slug, sum(_sample_interval) AS hits, uniq(blob7) AS unique_viewers FROM ${D} WHERE blob1 = 'watch' AND blob3 != '' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY slug ORDER BY hits DESC LIMIT 20`,
  topCategories: (days = 7) => `SELECT blob13 AS category, sum(_sample_interval) AS hits FROM ${D} WHERE blob13 != '' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY category ORDER BY hits DESC`,
  topScholars: (days = 7) => `SELECT blob14 AS scholar, sum(_sample_interval) AS hits FROM ${D} WHERE blob14 != '' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY scholar ORDER BY hits DESC`,

  // ── Devices ──
  deviceBreakdown: (days = 7) => `SELECT blob8 AS device, sum(_sample_interval) AS hits FROM ${D} WHERE blob8 != '' AND blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY device ORDER BY hits DESC`,
  browserBreakdown: (days = 7) => `SELECT blob9 AS browser, sum(_sample_interval) AS hits FROM ${D} WHERE blob9 != '' AND blob1 NOT IN ('watch_event','error') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY browser ORDER BY hits DESC`,
  osBreakdown: (days = 7) => `SELECT blob10 AS os, sum(_sample_interval) AS hits FROM ${D} WHERE blob10 != '' AND blob1 NOT IN ('watch_event','error') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY os ORDER BY hits DESC`,

  // ── Referrers ──
  topReferrers: (days = 7) => `SELECT blob6 AS referer, sum(_sample_interval) AS hits FROM ${D} WHERE blob6 != '' AND blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY referer ORDER BY hits DESC LIMIT 20`,

  // ── Performance ──
  avgResponseTime: () => `SELECT blob2 AS path, sum(double3 * _sample_interval) / sum(_sample_interval) AS avg_ms, max(double3) AS max_ms, sum(_sample_interval) AS hits FROM ${D} WHERE double3 > 0 AND blob1 NOT IN ('watch_event','error') AND timestamp > NOW() - INTERVAL '24' HOUR GROUP BY path HAVING hits > 2 ORDER BY avg_ms DESC LIMIT 20`,
  errorRate: (days = 7) => `SELECT toDate(timestamp) AS day, sum(if(double2 >= 400, _sample_interval, 0)) AS errors, sum(if(double2 >= 500, _sample_interval, 0)) AS server_errors, sum(_sample_interval) AS total FROM ${D} WHERE blob1 != 'watch_event' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY day ORDER BY day DESC`,
  slowestPages: () => `SELECT blob2 AS path, sum(double3 * _sample_interval) / sum(_sample_interval) AS avg_ms, max(double3) AS max_ms, sum(_sample_interval) AS hits FROM ${D} WHERE double3 > 0 AND timestamp > NOW() - INTERVAL '24' HOUR GROUP BY path HAVING hits > 3 ORDER BY avg_ms DESC LIMIT 15`,
  statusCodes: (days = 1) => `SELECT double2 AS status, sum(_sample_interval) AS hits FROM ${D} WHERE double2 > 0 AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY status ORDER BY hits DESC`,
  responseSizeByType: () => `SELECT blob12 AS content_type, sum(double4 * _sample_interval) / sum(_sample_interval) AS avg_bytes, sum(_sample_interval) AS hits FROM ${D} WHERE double4 > 0 AND blob1 != 'watch_event' AND timestamp > NOW() - INTERVAL '24' HOUR GROUP BY content_type ORDER BY hits DESC`,

  // ── Watch Events ──
  watchEventTypes: (days = 7) => `SELECT blob12 AS event_type, sum(_sample_interval) AS count FROM ${D} WHERE blob1 = 'watch_event' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY event_type ORDER BY count DESC`,
  watchCompletion: (days = 7) => `SELECT blob3 AS slug, sum(double9 * _sample_interval) / sum(_sample_interval) AS avg_completion, sum(_sample_interval) AS events, uniq(blob7) AS unique_viewers FROM ${D} WHERE blob1 = 'watch_event' AND blob12 IN ('pause','ended') AND double6 > 0 AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY slug ORDER BY unique_viewers DESC LIMIT 20`,
  watchByDevice: (days = 7) => `SELECT blob8 AS device, sum(_sample_interval) AS events, sum(double9 * _sample_interval) / sum(_sample_interval) AS avg_completion FROM ${D} WHERE blob1 = 'watch_event' AND blob12 IN ('pause','ended') AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY device ORDER BY events DESC`,
  watchByConnection: (days = 7) => `SELECT blob16 AS connection, sum(_sample_interval) AS events, sum(double8 * _sample_interval) / sum(_sample_interval) AS avg_bandwidth FROM ${D} WHERE blob1 = 'watch_event' AND blob16 != '' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY connection ORDER BY events DESC`,
  engagementRate: (days = 7) => `SELECT blob3 AS slug, sum(double10 * _sample_interval) AS engaged, sum(_sample_interval) AS total FROM ${D} WHERE blob1 = 'watch_event' AND blob12 = 'play' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY slug ORDER BY total DESC LIMIT 20`,
  bufferingIssues: (days = 7) => `SELECT blob3 AS slug, sum(_sample_interval) AS buffer_events, sum(double7 * _sample_interval) / sum(_sample_interval) AS avg_buffered FROM ${D} WHERE blob1 = 'watch_event' AND blob12 = 'buffer' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY slug ORDER BY buffer_events DESC LIMIT 15`,

  // ── Errors ──
  recentErrors: () => `SELECT blob2 AS path, blob9 AS browser, blob4 AS country, timestamp FROM ${D} WHERE blob1 = 'error' AND timestamp > NOW() - INTERVAL '24' HOUR ORDER BY timestamp DESC LIMIT 20`,

  // ── Realtime ──
  liveVisitors: () => `SELECT blob4 AS country, blob5 AS city, blob8 AS device, blob9 AS browser, blob2 AS path, double3 AS response_ms, timestamp FROM ${D} WHERE blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '5' MINUTE ORDER BY timestamp DESC LIMIT 30`,

  // ── API ──
  apiUsage: (days = 1) => `SELECT blob2 AS endpoint, sum(_sample_interval) AS hits, sum(double3 * _sample_interval) / sum(_sample_interval) AS avg_ms FROM ${D} WHERE blob1 = 'api' AND timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY endpoint ORDER BY hits DESC LIMIT 20`,
};
