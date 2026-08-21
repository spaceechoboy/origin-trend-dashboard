import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeries } from './export_series.mjs';

const ADDR = /0x[0-9a-fA-F]{40}/;
const a = (n) => '0x' + String(n).padStart(40, 'a');

const slot = (share, count, usd) => ({
  addr: a(Math.round(share * 1e6)), subtreeCount: count, subtreeUSD: usd,
  share, subtreeVh: usd / 3, subtreeStkA: usd / 2,
});

// 상위 6 + 나머지 3 = 9슬롯, share 합 1.0
const shares = [0.4, 0.2, 0.15, 0.1, 0.06, 0.04, 0.02, 0.02, 0.01];
const mkSnap = (at, nodes) => ({
  schema: 1, snap: 'snap-' + at.slice(0, 10), at, nodes, maxDepth: 300, recSize: 112,
  priceP: 1.25, priceA: 1.8, rootUSD: 1000, nonzeroAgg: 10, nonzeroVh: 20,
  sumAgg: 100, sumSl: 5, sumVh: 200, sumStkA: 300,
  rank: [nodes - 100, 40, 30, 10, 10, 8, 2],
  spine: [{ depth: 0, addr: a(1), subtreeCount: nodes, subtreeUSD: 1000, childCount: 8 }],
  slots: shares.map((s, i) => slot(s, 1000 * (i + 1), 10000 * s)),
  boundary: [{ th: 50000, up: 3, down: 4 }],
  generatedAt: at,
});

const drift = {
  schema: 1, at: '2026-08-21', probedAt: '2026-08-21T13:00:00Z',
  values: {
    'anubis.genesis360.quota': 21631363.6, 'anubis.long600.quota': 42187606.8,
    'anubis.long360.quota': 19993701.1, 'anubis.quota360.quota': 18826976.7,
    'polygon.long600.quota': 0.58, 'polygon.long360.quota': 657198979.9,
    'anubis.burnbond.lgnsDepositEnabled': true,
  },
  derived: { 'anubis.lgns.sellTaxPct': 38.25, 'anubis.genesis360.discountMul': 1.538462 },
  errors: [],
};

const rows = [mkSnap('2026-08-20T20:00:00Z', 3000), mkSnap('2026-08-21T20:00:00Z', 3050)];

test('주소 문자열이 결과 JSON에 한 건도 없다', () => {
  const json = JSON.stringify(buildSeries(rows, [drift]));
  assert.equal(json.match(new RegExp(ADDR.source, 'g')), null);
});

test('dNodes: 첫 행 null, 이후 차분', () => {
  const s = buildSeries(rows, []).snapshots;
  assert.equal(s[0].dNodes, null);
  assert.equal(s[1].dNodes, 50);
});

test('슬롯 상위6+rest 합이 100%±0.01', () => {
  const s = buildSeries(rows, []).snapshots[0];
  assert.equal(s.slots.length, 7);
  assert.equal(s.slots[6].i, 'rest');
  const sum = s.slots.reduce((t, x) => t + x.share, 0) * 100;
  assert.ok(Math.abs(sum - 100) < 0.01, `합 ${sum}`);
  assert.deepEqual(s.slots.map((x) => x.i), [1, 2, 3, 4, 5, 6, 'rest']);
  assert.ok(s.slots[0].share > s.slots[1].share); // share 내림차순
});

test('params 매핑', () => {
  const p = buildSeries(rows, [drift]).params[0];
  assert.equal(p.date, '2026-08-21');
  assert.equal(p.sellTaxPct, 38.25);
  assert.equal(p.discountMul, 1.538462);
  assert.equal(p.quota.p600, 0.58);
  assert.equal(p.burnbondOn, true);
  assert.equal(p.errors, 0);
});

test('usdA/usdP 파생과 정렬', () => {
  const out = buildSeries([rows[1], rows[0]], []); // 역순 입력도 시간순 정렬
  assert.equal(out.snapshots[0].nodes, 3000);
  assert.equal(out.snapshots[0].usdA, 100 * 1.8);
  assert.equal(out.snapshots[0].usdP, 200 * 1.25);
  assert.equal(out.latest.nodes, 3050);
});

test('구 스냅샷(필드 결손)에도 죽지 않고 null', () => {
  const out = buildSeries([{ at: '2026-07-01T00:00:00Z', nodes: 10 }], [{ at: '2026-07-01' }]);
  const s = out.snapshots[0];
  assert.equal(s.sumAgg, null);
  assert.equal(s.usdA, null);
  assert.equal(s.rank, null);
  assert.deepEqual(s.slots, []);
  assert.deepEqual(s.boundary, []);
  assert.equal(out.params[0].sellTaxPct, null);
  assert.equal(out.params[0].quota.genesis, null);
});
