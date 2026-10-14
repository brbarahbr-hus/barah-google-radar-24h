import {BASE_EXCLUSIONS,idOf,mergeMetricRows} from './radar-core.mjs';
const num = x => Number.isFinite(Number(x)) ? Number(x) : 0;
export const safeMessage = e => String(e?.message || 'Request failed').replace(/(api_key|access_token|refresh_token|client_secret)=[^\s&]+/ig,'$1=[redacted]').slice(0,180);
const arr=x=>Array.isArray(x)?x:Array.isArray(x?.data)?x.data:Array.isArray(x?.result)?x.result:[];
export function dateDaysAgo(days, at=new Date()) {
 const d=new Date(at.getTime()+3*3600000-days*86400000);
 return d.toISOString().slice(0,10);
}
async function requestJSON(url,options={},label='remote') {
 const resp=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(18000)});
 if(!resp.ok)throw Error(`${label} HTTP ${resp.status}`);
 const v=await resp.json();if(v.error||v.success===false)throw Error(`${label} unsuccessful response`);return v;
}
export function getSallaReader(env) {
 if(!env.SALLA_ACCESS_TOKEN)throw Error('SALLA_ACCESS_TOKEN is not configured');
 return async path=>requestJSON('https://api.salla.dev/admin/v2/'+path.replace(/^\//,''),{headers:{Authorization:`Bearer ${env.SALLA_ACCESS_TOKEN}`}},'salla');
}
export async function sallaCatalog(read){
 const output=[];let total=null;
 for(let page=1;page<=25;page++){
   const r=await read(`products?status=sale&page=${page}&per_page=50`);
   const rows=arr(r); output.push(...rows);
   total=total??r.pagination?.total;
   if(rows.length===0||rows.length<50|| (total!=null && output.length>=total))break;
   if(page===25)throw Error('Catalog exceeded pagination safety cap');
 }
 if(output.length<6)throw Error('Salla catalog too small');return output;
}
export async function windsor(env,connector,fields,from,to,account){
 if(!env.WINDSOR_API_KEY) throw Error('WINDSOR_API_KEY missing');
 const u=new URL('https://connectors.windsor.ai/'+connector);
 u.searchParams.set('api_key',env.WINDSOR_API_KEY);
 u.searchParams.set('fields',fields.join(','));
 u.searchParams.set('date_from',from);u.searchParams.set('date_to',to);
 u.searchParams.set('select_accounts',account);
 const resp=await requestJSON(u.toString(),{headers:{'Accept':'application/json'}},'windsor '+connector);
 return arr(resp);
}
const adFields=['impressions','clicks','cost','conversions','conversion_value'];
const itemFields=['items_viewed','items_added_to_cart','items_purchased','item_revenue'];
export async function sourceAds(env,sources,errors){
 try {
  const [r7,r30]=await Promise.all([
    windsor(env,'google_ads',['campaign_id','campaign_name','product_item_id','product_title',...adFields],dateDaysAgo(7),dateDaysAgo(1),env.ADS_ACCOUNT_ID),
    windsor(env,'google_ads',['campaign_id','campaign_name','product_item_id','product_title',...adFields],dateDaysAgo(30),dateDaysAgo(1),env.ADS_ACCOUNT_ID)
  ]);
  const onlyRiyadh=rows=>rows.filter(x=>env.ADS_CAMPAIGN_ID ? String(x.campaign_id)===String(env.ADS_CAMPAIGN_ID) : /الرياض|riyadh/i.test(String(x.campaign_name||'')) && /pmax|performance max/i.test(String(x.campaign_name||'')));
  const a7=onlyRiyadh(r7),a30=onlyRiyadh(r30);
  if(!a30.length)throw Error('No Riyadh PMAX product-level data');
  sources.ads7=mergeMetricRows(a7,'product_item_id',adFields);
  sources.ads30=mergeMetricRows(a30,'product_item_id',adFields);
  sources.ads_available=true;
 }catch(e){errors.ads=safeMessage(e);sources.ads_available=false;}
}
export async function sourceGA4(env,sources,errors){
 try{
  const get=async(days,metric)=>mergeMetricRows(await windsor(env,'googleanalytics4',['item_id',metric],dateDaysAgo(days),dateDaysAgo(1),env.GA4_ACCOUNT_ID),'item_id',[metric]);
  const m=await Promise.all([get(7,'items_viewed'),get(7,'items_added_to_cart'),get(7,'items_purchased'),get(30,'items_viewed'),get(30,'items_added_to_cart'),get(30,'items_purchased')]);
  function combine(parts){const out={};for(const p of parts)for(const [id,v] of Object.entries(p))Object.assign(out[id]??={},v);return out;}
  sources.ga7=combine(m.slice(0,3));sources.ga30=combine(m.slice(3));sources.ga_available=true;
 }catch(e){errors.ga4=safeMessage(e);sources.ga_available=false;}
}
function isPaid(order){
 const o=order?.payment||{};
 const state=String(o.status||order?.payment_status||'').toLowerCase();
 return ['paid','captured','completed','success'].includes(state) || o.is_paid===true || order?.is_paid===true;
}
function orderDate(order){return String(order?.date?.date||order?.created_at||'').slice(0,10)}
export async function sourceSallaPaid(read,sources,errors){
 try{
  const statuses=arr(await read('orders/statuses'));
  const good = statuses.filter(x=>['in_progress','completed','delivered','delivering','shipped'].includes(x.slug)).map(x=>x.customized_id||x.id);
  if(!good.length)throw Error('No approved order statuses');
  const eligibleOrders=[];let totalRows=0,pages=0,complete=false;const from=dateDaysAgo(30),to=dateDaysAgo(1);
  for(let page=1;page<=8;page++){
   pages=page;
   const params=new URLSearchParams({from_date:from,to_date:to,page:String(page)});
   for(const s of good)params.append('status[]',String(s));
   const rr=await read('orders?'+params.toString()); const rows=arr(rr);
   totalRows+=rows.length;eligibleOrders.push(...rows.filter(isPaid));
   if(rows.length===0||!rr.pagination?.links?.next&&!rr.pagination?.links?.next_page&&(!rr.pagination?.totalPages||page>=rr.pagination.totalPages)){complete=true;break;}
  }
  if(!complete)throw Error('Paid-order pagination incomplete');
  if(totalRows>0 && eligibleOrders.length===0)throw Error('Paid state absent: cannot verify sales from orders');
  const s7={},s30={};let included=0,matchedItems=0;
  for(const o of eligibleOrders){
   if(included++>=100)throw Error('Too many paid orders for bounded read');
   const items=arr(await read('orders/items?order_id='+encodeURIComponent(o.id)));
   for(const it of items){const id=idOf(it.product_id||it.product?.id||it.product?.product_id);if(!/^\d+$/.test(id))continue;matchedItems++;
    (s30[id]??={quantity:0}).quantity+=num(it.quantity);
    if(orderDate(o)>=dateDaysAgo(7))(s7[id]??={quantity:0}).quantity+=num(it.quantity);
   }
  }
  if(eligibleOrders.length>0 && matchedItems===0)throw Error('Paid orders returned no verifiable product items');
  sources.salla7=s7;sources.salla30=s30;sources.salla_paid_complete=true;
 }catch(e){sources.salla_paid_complete=false;errors.salla_paid=safeMessage(e);}
}
// HTML server-rendered bestsellers plus explicit exclusions from existing V67.27.2 UI.
export async function getHomepageExclusions(env,errors){
 const s=new Set(BASE_EXCLUSIONS);
 for(const id of String(env.EXCLUDED_PRODUCT_IDS||'').split(',')){if(id.trim())s.add(idOf(id));}
 let verified=false;
 try {
  const resp=await fetch('https://barahstore.com/ar',{signal:AbortSignal.timeout(12000)});
  if(!resp.ok)throw Error('Homepage HTTP '+resp.status);
  const html=await resp.text();
  const matches=[...html.matchAll(/href=["'][^"']*\/p(\d+)(?:[?&#"'/]|$)/g)].map(x=>x[1]);
  if(matches.length<4)throw Error('Homepage product IDs not found in server HTML');
  matches.forEach(id=>s.add(id));verified=true;
 }catch(e){errors.homepage=safeMessage(e);}
 return {exclusions:s,verified};
}
export async function validateResource(url,kind){
 // Follow only approved HTTPS destinations. A same-host redirect by itself is
 // not proof of a reachable product/image: demand a final successful response.
 const hosts=kind==='image' ? ['cdn.salla.sa','cdn.files.salla.network','cdn.salla.network'] : ['barahstore.com','www.barahstore.com'];
 function approved(value){try{const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && hosts.includes(u.hostname)?u:null;}catch{return null;}}
 if(!approved(url))return false;
 for(const method of ['HEAD','GET']) {
  let current=url;
  for(let hop=0;hop<4;hop++){
   try {const r=await fetch(current,{method,redirect:'manual',headers:method==='GET'?{'Range':'bytes=0-0'}:{},signal:AbortSignal.timeout(9000)});
    if(r.status>=200&&r.status<300){if(method==='GET'&&r.body)await r.body.cancel();return true;}
    if(r.status>=300&&r.status<400&&r.headers.get('location')){
      const next=new URL(r.headers.get('location'),current);if(!approved(next.href))break;
      current=next.href;continue;
    }
    break;
   }catch{break;}
  }
 }
 return false;
}
export async function validateCandidates(candidates){
 const out=[];
 for(const p of candidates){
  const ok=await Promise.all([validateResource(p.url,'url'),validateResource(p.image,'image')]);
  if(ok.every(Boolean))out.push(p);
 }
 return out;
}
