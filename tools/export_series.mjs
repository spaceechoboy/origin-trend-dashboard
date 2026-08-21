#!/usr/bin/env node
// 공개용 시계열 생성기 — 배치 스냅샷(jsonl) → data/series.json
// 규율: 주소·spine·경계 지갑 목록은 절대 출력하지 않는다(집계·순위만).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const DEFAULT_SUMMARY = process.env.HOME + '/origin-spider-web/backend/batch/data/summary.jsonl';
export const DEFAULT_DRIFT = process.env.HOME + '/origin-spider-web/backend/batch/data/drift.jsonl';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const day = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);

function readJsonl(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return []; }
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    try { return [JSON.parse(s)]; } catch { return []; }
  });
}

// 슬롯: share 내림차순 상위 6 + 나머지 합산. 주소는 버리고 순위 i만 남긴다.
function slotsOf(row) {
  const src = Array.isArray(row.slots) ? row.slots : [];
  if (!src.length) return [];
  const sorted = [...src].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  const mk = (i, list) => {
    const nodes = list.reduce((s, x) => s + (x.subtreeCount ?? 0), 0);
    const usd = list.reduce((s, x) => s + (x.subtreeUSD ?? 0), 0);
    return {
      i,
      share: list.reduce((s, x) => s + (x.share ?? 0), 0),
      nodes,
      usd,
      usdPerWallet: nodes > 0 ? usd / nodes : null,
    };
  };
  const out = sorted.slice(0, 6).map((s, k) => mk(k + 1, [s]));
  const rest = sorted.slice(6);
  if (rest.length) out.push(mk('rest', rest));
  return out;
}

export function buildSeries(summaryRows, driftRows) {
  const snaps = [...summaryRows].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const snapshots = snaps.map((row, idx) => {
    const nodes = int(row.nodes);
    const prev = idx > 0 ? int(snaps[idx - 1].nodes) : null;
    // 관측 간격 — 스냅샷은 보통 하루 1회지만 리허설처럼 18일 벌어진 점이 섞인다.
    // 그 점의 dNodes를 「일 증가량」으로 그리면 최근 추세가 통째로 눌린다 → 일 평균으로 환산해 쓴다.
    const prevAt = idx > 0 ? Date.parse(snaps[idx - 1].at) : NaN;
    const curAt = Date.parse(row.at);
    const gapDays = Number.isFinite(prevAt) && Number.isFinite(curAt)
      ? Math.round(((curAt - prevAt) / 86400000) * 100) / 100 : null;
    const sumAgg = num(row.sumAgg), sumVh = num(row.sumVh);
    const priceA = num(row.priceA), priceP = num(row.priceP);
    return {
      at: row.at ?? null,
      date: day(row.at),
      nodes,
      dNodes: nodes != null && prev != null ? nodes - prev : null,
      gapDays,
      dNodesPerDay: nodes != null && prev != null && gapDays > 0
        ? Math.round(((nodes - prev) / gapDays) * 10) / 10 : null,
      rootUSD: num(row.rootUSD),
      priceP, priceA,
      sumAgg, sumVh, sumStkA: num(row.sumStkA),
      nonzeroAgg: int(row.nonzeroAgg), nonzeroVh: int(row.nonzeroVh),
      rank: Array.isArray(row.rank) ? row.rank.map(int) : null,
      usdA: sumAgg != null && priceA != null ? sumAgg * priceA : null,
      usdP: sumVh != null && priceP != null ? sumVh * priceP : null,
      slots: slotsOf(row),
      boundary: Array.isArray(row.boundary)
        ? row.boundary.map((b) => ({ th: int(b.th), up: int(b.up), down: int(b.down) }))
        : [],
    };
  });

  const params = [...driftRows]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((d) => {
      const v = d.values ?? {};
      return {
        date: day(d.at) ?? day(d.probedAt),
        sellTaxPct: num(d.derived?.['anubis.lgns.sellTaxPct']),
        discountMul: num(d.derived?.['anubis.genesis360.discountMul']),
        quota: {
          genesis: num(v['anubis.genesis360.quota']),
          a600: num(v['anubis.long600.quota']),
          a360: num(v['anubis.long360.quota']),
          q360: num(v['anubis.quota360.quota']),
          p600: num(v['polygon.long600.quota']),
          p360: num(v['polygon.long360.quota']),
        },
        burnbondOn: typeof v['anubis.burnbond.lgnsDepositEnabled'] === 'boolean'
          ? v['anubis.burnbond.lgnsDepositEnabled'] : null,
        errors: Array.isArray(d.errors) ? d.errors.length : 0,
      };
    });

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    snapshots,
    params,
    latest: snapshots.length ? { ...snapshots[snapshots.length - 1], ageHours: null } : null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [sPath = DEFAULT_SUMMARY, dPath = DEFAULT_DRIFT] = process.argv.slice(2);
  const out = buildSeries(readJsonl(sPath), readJsonl(dPath));
  const dest = resolve(ROOT, 'data/series.json');
  mkdirSync(dirname(dest), { recursive: true });
  const json = JSON.stringify(out, null, 1);
  writeFileSync(dest, json + '\n');
  const L = out.latest;
  console.log(
    `series.json 기록: 스냅샷 ${out.snapshots.length}건 · 파라미터 ${out.params.length}건 · ` +
    `최신 ${L?.date ?? '—'} nodes=${L?.nodes ?? '—'} rootUSD=${L?.rootUSD?.toFixed(0) ?? '—'} · ${json.length}B`
  );
}
