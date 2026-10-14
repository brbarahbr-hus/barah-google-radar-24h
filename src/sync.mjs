import { createHash } from 'node:crypto';
import { SECTION_ID, pickProducts, publicProjection, idOf } from './radar-core.mjs';
import { getSallaReader, sallaCatalog, sourceAds, sourceGA4, sourceSallaPaid, getHomepageExclusions, validateCandidates } from './sources.mjs';

export function requireConfiguration(env) {
  const missing = ['SALLA_ACCESS_TOKEN', 'WINDSOR_API_KEY', 'ADS_ACCOUNT_ID'].filter(key => !env[key]);
  if (missing.length) throw Error('Configure GitHub Secrets/Variables: ' + missing.join(', '));
}

const defaultSources = {
  reader: getSallaReader, catalog: sallaCatalog, homepage: getHomepageExclusions,
  ads: sourceAds, ga4: sourceGA4, sales: sourceSallaPaid, validate: validateCandidates,
};

export function publicFeed(batch) {
  const out = publicProjection(batch);
  // Ranking uses private metrics; customer-facing JSON does not disclose them.
  out.products = out.products.map(product => ({
    ...product,
    reason: product.evidence.includes('salla:verified:30d')
      ? 'اختيار عملي مع طلبات شراء موثّقة'
      : 'اختيار عملي مع إشارات اهتمام موثّقة',
  }));
  return out;
}

export async function buildBatch(env, { at = new Date(), dependencies = defaultSources } = {}) {
  requireConfiguration(env);
  const read = dependencies.reader(env);
  const errors = {}, sources = { keyword_sa: {}, margin_verified: {} };
  const [catalog, homepage] = await Promise.all([
    dependencies.catalog(read), dependencies.homepage(env, errors),
  ]);
  if (!homepage.verified) throw Error('Homepage deduplication could not be verified');
  sources.homepage_verified = true;
  await dependencies.ads(env, sources, errors);
  if (!sources.ads_available) throw Error('Google Ads product-level source is unavailable; no replacement feed created');
  if (env.GA4_ACCOUNT_ID) await dependencies.ga4(env, sources, errors);
  if (env.SALLA_PAID_ORDERS_ENABLED === 'true') await dependencies.sales(read, sources, errors);

  // A minimal catalog response may omit the description, quantity or category.
  // Hydrate only products with observed interest, using GET requests.
  const relevant = catalog.filter(product => {
    const id = idOf(product.id);
    return Number(sources.ads30?.[id]?.clicks) > 0 || Number(sources.ga7?.[id]?.items_added_to_cart) > 0 || Number(sources.salla30?.[id]?.quantity) > 0;
  });
  const hydrated = [];
  for (const product of relevant.slice(0, 120)) {
    if (product.description && product.quantity != null && product.categories?.length) {
      hydrated.push(product);
    } else {
      try {
        const response = await read('products/' + encodeURIComponent(product.id));
        if (String(response.data?.id) === String(product.id)) hydrated.push(response.data);
      } catch { /* An unreadable product is excluded. */ }
    }
  }
  const ranked = pickProducts(hydrated, sources, homepage.exclusions, 32);
  const products = (await dependencies.validate(ranked)).slice(0, 16);
  if (products.length < 6) throw Error(`Only ${products.length} validated products; minimum is 6`);
  const dateBatch = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at).replaceAll('-', '');
  const batch = {
    section_id: SECTION_ID, schema_version: 1, date_batch: dateBatch,
    generated_at: at.toISOString(), valid_until: new Date(at.getTime() + 86400000).toISOString(),
    market: { location: 'SA', ads_scope: 'Riyadh PMAX campaign only', keyword_market_available: false },
    source_status: {
      google_ads: 'available', ads_geo: 'Riyadh campaign; not all Saudi demand',
      salla_catalog: 'available', salla_paid: sources.salla_paid_complete ? 'verified' : 'unavailable',
      ga4: sources.ga_available ? 'available' : 'unavailable', homepage_exposure: 'server-rendered-and-curated',
      keyword_planner: 'unavailable', search_console: 'unavailable', trends: 'unavailable', profitability: 'unavailable',
      unavailable_sources: Object.keys(errors),
    },
    products,
  };
  return { feed: publicFeed(batch), summary: { catalog: catalog.length, observed: relevant.length, validated: products.length, source_status: batch.source_status } };
}

export function configurationFingerprint(sourceTexts, env) {
  const config = ['ADS_ACCOUNT_ID', 'ADS_CAMPAIGN_ID', 'GA4_ACCOUNT_ID', 'EXCLUDED_PRODUCT_IDS', 'SALLA_PAID_ORDERS_ENABLED'].map(key => [key, env[key] || '']);
  return createHash('sha256').update(JSON.stringify([sourceTexts, config])).digest('hex');
}

export function recordValidation(previous, fingerprint, { runId, at, validated }) {
  if (!runId || validated < 6) throw Error('A live GitHub run with 6 validated products is required');
  const recent = previous?.fingerprint === fingerprint && Array.isArray(previous.checks)
    ? previous.checks.filter(check => {
      const age = at.getTime() - Date.parse(check.at);
      return Number.isFinite(age) && age >= 0 && age <= 72 * 3600000 && check.validated >= 6;
    }) : [];
  const checks = recent.filter(check => check.run_id !== String(runId));
  checks.push({ run_id: String(runId), at: at.toISOString(), validated });
  return { schema_version: 1, fingerprint, checks: checks.slice(-8) };
}
