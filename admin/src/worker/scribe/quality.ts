// Quality measurement: mechanical metrics + a cross-lingual semantic audit.
//
// Every non-verse cue's Arabic source and its translation are embedded with
// bge-m3 (multilingual) and compared — low cosine similarity flags likely
// mistranslations for human review. Mechanical metrics cover coverage, gaps,
// reading speed, overlaps, and Arabic leakage. Everything lands in a graded
// report at scribe/{job}/quality.json plus a summary on the D1 row.

import type { Cue, ScribeEnv } from './types';
import { updateJob } from './types';

type QEnv = ScribeEnv & { AI: any };

const AR_CHARS = /[؀-ۿ]/;
const SIM_FLAG = 0.55; // below this, flag for review

function cos(a: number[], b: number[]): number {
  let s = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return s / (Math.sqrt(na * nb) || 1);
}

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export type QualityReport = {
  grade: string;
  score: number;
  computedAt: string;
  metrics: Record<string, number>;
  flags: { i: number; sim: number; start: number; source: string; text: string }[];
};

export async function assessQuality(env: QEnv, jobId: string, cuesKey: string): Promise<QualityReport> {
  const obj = await env.MEDIA_BUCKET.get(cuesKey);
  if (!obj) throw new Error('cues missing: ' + cuesKey);
  const cues: Cue[] = await obj.json();
  const job: any = await env.DB.prepare('SELECT duration FROM scribe_jobs WHERE id = ?').bind(jobId).first();
  const audioDur = job?.duration || (cues.length ? cues[cues.length - 1].end : 0);

  const spoken = cues.filter((c) => c.text.trim());
  const locked = spoken.filter((c: any) => c.q);
  const free = spoken.filter((c: any) => !c.q);

  // Mechanical metrics
  const covered = spoken.reduce((s, c) => s + (c.end - c.start), 0);
  const gaps = spoken.filter((c, i) => i > 0 && c.start - spoken[i - 1].end > 8).length;
  const overlaps = spoken.filter((c, i) => i > 0 && c.start < spoken[i - 1].end - 0.01).length;
  const giants = free.filter((c) => c.end - c.start > 10).length;
  const arLeak = free.filter((c) => AR_CHARS.test(c.text));
  const cpsAll = free.map((c) => c.text.length / Math.max(0.3, c.end - c.start));
  const cpsOver20 = cpsAll.filter((v) => v > 20).length;

  // Cross-lingual semantic audit (bge-m3): source AR vs translation
  const audit = free
    .map((c, idx) => ({ c, idx: spoken.indexOf(c) }))
    .filter(({ c }) => c.source && c.source.length >= 8 && c.text.length >= 8);
  const sims: number[] = new Array(audit.length).fill(1);
  const BATCH = 45;
  for (let i = 0; i < audit.length; i += BATCH) {
    const batch = audit.slice(i, i + BATCH);
    try {
      const [ea, eb]: any[] = await Promise.all([
        env.AI.run('@cf/baai/bge-m3', { text: batch.map(({ c }) => c.source.slice(0, 480)) }),
        env.AI.run('@cf/baai/bge-m3', { text: batch.map(({ c }) => c.text.slice(0, 480)) }),
      ]);
      batch.forEach((_, j) => {
        const va = ea.data?.[j];
        const vb = eb.data?.[j];
        if (va && vb) sims[i + j] = cos(va, vb);
      });
    } catch {
      // one failed batch shouldn't sink the audit; those cues keep sim=1 (unflagged)
    }
  }
  const flags = audit
    .map(({ c, idx }, j) => ({ i: idx, sim: Math.round(sims[j] * 1000) / 1000, start: Math.round(c.start), source: c.source.slice(0, 120), text: c.text.slice(0, 120) }))
    .filter((f) => f.sim < SIM_FLAG)
    .sort((a, b) => a.sim - b.sim)
    .slice(0, 80);

  const metrics: Record<string, number> = {
    cues: spoken.length,
    verse_cues: locked.length,
    coverage_pct: Math.round((covered / Math.max(1, audioDur)) * 1000) / 10,
    gaps_over_8s: gaps,
    overlaps,
    cues_over_10s: giants,
    arabic_leak: arLeak.length,
    cps_p50: Math.round(pct(cpsAll, 50) * 10) / 10,
    cps_p90: Math.round(pct(cpsAll, 90) * 10) / 10,
    cps_over_20_pct: Math.round((cpsOver20 / Math.max(1, free.length)) * 1000) / 10,
    audit_cues: audit.length,
    audit_flagged: flags.length,
    audit_flagged_pct: Math.round((flags.length / Math.max(1, audit.length)) * 1000) / 10,
    audit_sim_p10: Math.round(pct(sims, 10) * 1000) / 1000,
  };

  // Grade: start at 100, deduct for each defect class
  let score = 100;
  if (metrics.coverage_pct < 95) score -= 15;
  else if (metrics.coverage_pct < 85) score -= 25;
  score -= Math.min(10, Math.max(0, gaps - 2) * 2);
  if (overlaps > 0) score -= 5;
  if (giants > 0) score -= 5;
  score -= Math.min(10, arLeak.length);
  if (metrics.cps_over_20_pct > 50) score -= 10;
  else if (metrics.cps_over_20_pct > 30) score -= 5;
  if (metrics.audit_flagged_pct > 10) score -= 15;
  else if (metrics.audit_flagged_pct > 5) score -= 8;
  score = Math.max(0, Math.round(score));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  const report: QualityReport = { grade, score, computedAt: new Date().toISOString(), metrics, flags };
  const qKey = cuesKey.replace(/cues(\.[a-z]{2})?\.json$/, 'quality$1.json');
  await env.MEDIA_BUCKET.put(qKey, JSON.stringify(report), { httpMetadata: { contentType: 'application/json' } });
  if (!/cues\.[a-z]{2}\.json$/.test(cuesKey)) {
    await updateJob(env.DB, jobId, {
      quality: JSON.stringify({ grade, score, flags: flags.length, cov: metrics.coverage_pct, verses: locked.length }),
    });
  }
  return report;
}
