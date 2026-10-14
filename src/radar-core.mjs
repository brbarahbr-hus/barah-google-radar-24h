/** BARAH GOOGLE RADAR 24H — pure scoring / eligibility, no secrets or IO. */
export const SECTION_ID = 'barah-google-radar-24h';
export const WEIGHTS = Object.freeze({ sa_keyword: 25, ads: 25, salla_paid: 20, underexposed: 15, margin: 10, freshness: 5 });
export const BASE_EXCLUSIONS = new Set([
  // V67.27.2 discovery shelf (12) plus homepage hero and visible native bestsellers.
  '122136640','1349833566','1601578360','81233259','134301521','544932232','1435457964','1508084346','1609572776','1153827766','1600022680','1389291778',
  '1810209528','2109998159','2146218363','314048946','1737673536','1923506631','898468432','1747191075','1839284002',
]);
const n = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
const clamp = x => Math.max(0, Math.min(100, x));
export const idOf = x => String(x ?? '').replace(/^p/i, '').trim();
export function normalizeProduct(p) {
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const id = idOf(p.id);
  const price = p.price?.amount ?? p.price;
  const image = p.main_image || p.thumbnail || p.images?.[0]?.image || p.images?.[0]?.original || '';
  const url = p.urls?.customer || p.url || '';
  const cats = (p.categories || []);
  const cat = cats.at(-1) || cats[0] || {};
  return { id, name, price: Number(price), quantity: Number(p.quantity), image, url,
    category: cat.name || 'متنوع', family: String(cat.id || cat.name || 'other'),
    status: p.status, available: p.is_available !== false, description: p.description,
    cost_price: Number(p.cost_price), created_at: p.created_at, image_ok: p.image_ok !== false, url_ok: p.url_ok !== false };
}
function isValidHTTPS(url,kind) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    if (kind === 'url') return h === 'barahstore.com' || h === 'www.barahstore.com';
    return h === 'cdn.salla.sa' || h.endsWith('.salla.network') || h.endsWith('.files.salla.network');
  } catch { return false; }
}
export function eligible(p, exclusions = BASE_EXCLUSIONS, { minQuantity = 3 } = {}) {
  return /^\d{3,}$/.test(p.id) && p.status === 'sale' && p.available &&
    Number.isFinite(p.quantity) && p.quantity >= minQuantity &&
    Number.isFinite(p.price) && p.price > 0 && p.name.length > 7 &&
    !!p.description && isValidHTTPS(p.url, 'url') && isValidHTTPS(p.image,'image') &&
    p.url_ok && p.image_ok && !exclusions.has(p.id);
}
export function mergeMetricRows(rows = [], idKey = 'product_item_id', fields = []) {
  const out = {};
  for (const row of rows) {
    const id = idOf(row[idKey]); if (!/^\d+$/.test(id)) continue;
    const dst = out[id] ||= {};
    for (const k of fields) dst[k] = (dst[k] || 0) + n(row[k]);
  }
  return out;
}
export function scoreProduct(p, sources) {
  const a7 = sources.ads7?.[p.id]; const a30 = sources.ads30?.[p.id];
  const s7 = sources.salla7?.[p.id]; const s30 = sources.salla30?.[p.id];
  const g7 = sources.ga7?.[p.id]; const g30 = sources.ga30?.[p.id];
  const scores = {}, reasons = [], evidence = [];
  if (sources.keyword_sa?.[p.id]?.verified === true) {
    scores.sa_keyword = clamp(sources.keyword_sa[p.id].normalized_score);
    reasons.push('إشارة بحث سعودية موثقة'); evidence.push('keyword_planner:sa');
  }
  // Empirical-Bayes CTR and volume saturation. Impression volume is not search demand.
  if (sources.ads_available && (a30 || a7)) {
    const imp = n(a30?.impressions), clicks = n(a30?.clicks);
    const ctrShrunk = (clicks + 2) / (imp + 200);
    const clickLevel = Math.min(1, Math.log1p(clicks) / Math.log1p(30));
    const ctrLevel = Math.min(1, ctrShrunk / .035);
    const saleClicks = Math.min(1, n(a30?.conversions) / Math.max(3, clicks) * 8);
    const recent = Math.min(1, n(a7?.clicks) / Math.max(3, clicks) * (30/7));
    scores.ads = clamp((.36 * clickLevel + .28 * ctrLevel + .24 * saleClicks + .12 * recent) * 100);
    reasons.push(n(a7?.clicks) > 0 ? `اهتمام إعلاني: ${n(a7.clicks)} نقرة خلال 7 أيام` : 'ظهور ونقرات إعلانية خلال 30 يومًا');
    evidence.push('google_ads:riyadh:7d,30d');
  }
  // Count Salla only if paid/fulfilled order verification source is complete.
  if (sources.salla_paid_complete && sources.salla30) {
    const sold30 = n(s30?.quantity), sold7 = n(s7?.quantity);
    scores.salla_paid = clamp((.65 * Math.min(1, sold30/6) + .35 * Math.min(1,sold7/3))*100);
    if (sold30 > 0) { reasons.push(`مبيعات مسجلة في سلة خلال 30 يومًا: ${sold30}`); evidence.push('salla:verified:30d'); }
  }
  if (sources.homepage_verified) {
    scores.underexposed = 100; reasons.push('غير ظاهر في أقسام الرئيسية المرصودة'); evidence.push('storefront:home:scan');
  }
  if (sources.margin_verified?.[p.id] != null) {
    scores.margin = clamp(sources.margin_verified[p.id]); reasons.push('ربحية صافية موثقة'); evidence.push('margin:verified');
  }
  if (a7 && a30 && n(a30.clicks) > 0) {
    scores.freshness = clamp((n(a7.clicks)/n(a30.clicks)) * (30/7) * 50);
    evidence.push('ads:recent:7d');
  } else if (g7 && g30 && n(g30.items_added_to_cart) > 0) {
    scores.freshness = clamp((n(g7.items_added_to_cart)/n(g30.items_added_to_cart)) * (30/7)*50);
    evidence.push('ga4:recent:7d');
  }
  // GA4 adds context but NEVER masquerades as verified Salla sales.
  if (n(g7?.items_added_to_cart) > 0) reasons.push(`أُضيف للسلة في GA4 خلال 7 أيام`);
  const present = Object.keys(scores);
  const denom = present.reduce((s,k)=>s+WEIGHTS[k],0);
  const score = denom ? Math.round(present.reduce((s,k)=>s+WEIGHTS[k]*scores[k],0)/denom) : null;
  const reliability = (sources.homepage_verified?1:0) + (sources.salla_paid_complete?1:0) + (sources.ads_available?1:0) + (sources.keyword_sa?.[p.id]?.verified?1:0);
  const confidence = reliability >= 3 && n(a30?.clicks)>=5 ? 'high' : reliability >= 2 && (n(a30?.clicks)>=2 || n(s30?.quantity)>0) ? 'medium':'low';
  return { ...p, score, reason: reasons.slice(0,3).join('؛ ') || 'منتج متاح معروض للمراجعة، دون إشارة اهتمام كافية', confidence, evidence,
    signal_window: { ads: a30 ? '30d' : null, paid: s30 ? '30d' : null },
    metrics: { ads7_clicks:n(a7?.clicks),ads30_clicks:n(a30?.clicks),salla7_units:n(s7?.quantity),salla30_units:n(s30?.quantity),ga7_adds:n(g7?.items_added_to_cart) } };
}
export function pickProducts(products,sources, exclusions=BASE_EXCLUSIONS, cap=16) {
  const seen = new Set(); const all = [];
  for(const raw of products) { const p=normalizeProduct(raw);if(seen.has(p.id)) continue;seen.add(p.id);
    if(!eligible(p,exclusions))continue;let s=scoreProduct(p,sources);
    // Do not claim interest from inventory alone: need at least one observed sale, ad or GA4 cart.
    if (!s.metrics.ads30_clicks && !s.metrics.salla30_units && !s.metrics.ga7_adds) continue;
    if(s.score !== null) all.push(s);
  }
  all.sort((a,b)=>(b.score - a.score) || (b.metrics.salla30_units - a.metrics.salla30_units) || a.id.localeCompare(b.id));
  const categoryCounts = new Map(), result=[];
  for(const p of all){if(result.length>=cap)break;const ct=categoryCounts.get(p.family)||0;if(ct>=2)continue;categoryCounts.set(p.family,ct+1);result.push(p)}
  return result;
}
export function publicProjection(batch){
  const { generated_at, valid_until, source_status, market, date_batch, products } = batch;
  return { schema_version:1, section_id:SECTION_ID, date_batch, generated_at, valid_until, source_status, market,
    products:products.map(({id,name,url,image,category,score,reason,confidence,evidence,signal_window})=>({id,name,url,image,category,score,reason,confidence,evidence,signal_window})) };
}
