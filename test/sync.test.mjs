import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatch, configurationFingerprint, recordValidation, requireConfiguration } from '../src/sync.mjs';
import { dateDaysAgo, getSallaReader, validateResource } from '../src/sources.mjs';

const at = new Date('2026-10-14T21:30:00.000Z');
const env = { SALLA_ACCESS_TOKEN: 'TEST_VALUE_NOT_A_TOKEN', WINDSOR_API_KEY: 'TEST_VALUE_NOT_A_KEY', ADS_ACCOUNT_ID: 'test-account' };
const products = Array.from({ length: 9 }, (_, index) => ({
  id: 6000000 + index, name: `أداة اختبار متعددة الاستخدام رقم ${index}`,
  description: 'هذا وصف بيانات اختبار، ليس منتجًا منشورًا.', quantity: 10,
  price: { amount: 39 }, status: 'sale', categories: [{ id: `cat${Math.floor(index / 3)}`, name: 'فئة اختبار' }],
  urls: { customer: `https://barahstore.com/ar/test/p${6000000 + index}` },
  main_image: `https://cdn.salla.sa/test/${index}.png`,
}));
function fixture(overrides = {}) {
  return {
    reader: () => () => { throw Error('Unexpected remote request'); },
    catalog: async () => products,
    homepage: async () => ({ verified: true, exclusions: new Set() }),
    ads: async (e, sources) => {
      sources.ads_available = true;
      sources.ads30 = Object.fromEntries(products.map(p => [p.id, { clicks: 9, impressions: 100, conversions: 1 }]));
      sources.ads7 = sources.ads30;
    },
    ga4: async () => {}, sales: async () => {}, validate: async p => p,
    ...overrides,
  };
}

test('missing credentials stop before any network request', () => {
  assert.throws(() => requireConfiguration({}), /SALLA_ACCESS_TOKEN.*WINDSOR_API_KEY.*ADS_ACCOUNT_ID/);
});
test('live pipeline keeps six diverse products and truthful source status', async () => {
  const { feed } = await buildBatch(env, { at, dependencies: fixture() });
  assert.equal(feed.products.length, 6);
  assert.equal(feed.date_batch, '20261015');
  assert.equal(Date.parse(feed.valid_until) - Date.parse(feed.generated_at), 86400000);
  assert.equal(feed.source_status.keyword_planner, 'unavailable');
  assert.equal(feed.source_status.search_console, 'unavailable');
  assert.equal(feed.source_status.salla_paid, 'unavailable');
  assert.ok(feed.products.every(p => !('quantity' in p) && !('price' in p) && !('metrics' in p)));
  assert.ok(feed.products.every(p => !/\d/.test(p.reason)));
});
test('a missing Ads source cannot publish an inventory-only replacement', async () => {
  await assert.rejects(buildBatch(env, { at, dependencies: fixture({ ads: async (e, s) => { s.ads_available = false; } }) }), /Google Ads product-level source is unavailable/);
});
test('homepage verification failure blocks unverifiable deduplication', async () => {
  await assert.rejects(buildBatch(env, { at, dependencies: fixture({ homepage: async () => ({ verified: false }) }) }), /deduplication/);
});
test('broken resources and fewer than six eligible products block a batch', async () => {
  await assert.rejects(buildBatch(env, { at, dependencies: fixture({ validate: async p => p.slice(0, 5) }) }), /minimum is 6/);
});
test('minimal catalog responses are hydrated from fresh read-only product details', async () => {
  let reads = 0;
  const d = fixture({
    catalog: async () => products.map(({ description, ...p }) => p),
    reader: () => async path => {
      reads++;
      return { data: products.find(p => path === 'products/' + p.id) };
    },
  });
  const result = await buildBatch(env, { at, dependencies: d });
  assert.equal(reads, 9);
  assert.equal(result.feed.products.length, 6);
});
test('validation proofs require distinct recent cloud runs for the same code and scope', () => {
  const record = runId => ({ runId, at, validated: 6 });
  const first = recordValidation(null, 'code1', record('101'));
  const repeated = recordValidation(first, 'code1', record('101'));
  assert.equal(repeated.checks.length, 1);
  const second = recordValidation(first, 'code1', record('102'));
  assert.equal(second.checks.length, 2);
  assert.equal(recordValidation(second, 'code2', record('103')).checks.length, 1);
  const old = { fingerprint: 'code1', checks: [{ run_id: '1', at: '2026-10-10T00:00:00Z', validated: 6 }] };
  assert.equal(recordValidation(old, 'code1', record('104')).checks.length, 1);
  assert.throws(() => recordValidation(first, 'code1', { ...record('105'), validated: 5 }), /6 validated/);
});
test('fingerprint resets proofs for changed code or account scope and excludes credentials', () => {
  const fp = configurationFingerprint(['src'], env);
  assert.equal(fp, configurationFingerprint(['src'], { ...env, SALLA_ACCESS_TOKEN: 'different-test-value' }));
  assert.notEqual(fp, configurationFingerprint(['changed'], env));
  assert.notEqual(fp, configurationFingerprint(['src'], { ...env, ADS_ACCOUNT_ID: 'different-test-account' }));
});
test('report windows use the Riyadh calendar across the UTC day boundary', () => {
  assert.equal(dateDaysAgo(1, at), '2026-10-14');
  assert.equal(dateDaysAgo(7, at), '2026-10-08');
});
test('Salla transport uses GET and refuses credential-bearing redirects', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.salla.dev/admin/v2/products');
      assert.equal(options.method, undefined);
      assert.equal(options.redirect, 'error');
      return Response.json({ data: [] });
    };
    await getSallaReader(env)('products');
  } finally { globalThis.fetch = original; }
});
test('resource validation refuses redirects to unapproved origins', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async url => {
      calls.push(url);
      return new Response('', { status: 302, headers: { Location: 'https://example.com/unsafe' } });
    };
    assert.equal(await validateResource('https://cdn.salla.sa/test.png', 'image'), false);
    assert.ok(calls.every(url => new URL(url).hostname === 'cdn.salla.sa'));
  } finally { globalThis.fetch = original; }
});
