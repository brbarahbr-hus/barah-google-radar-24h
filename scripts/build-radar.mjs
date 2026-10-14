/**
 * BARAH GOOGLE RADAR 24H — GitHub Actions no-paid-hosting edition.
 * Safety: read-only Salla and Windsor, no credentials in output,
 * no fabricated Saudi search demand or Salla paid-order assertions.
 * Requires two independently authorized secrets in Actions.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SECTION='barah-google-radar-24h', NOW=new Date();
const SALLA=process.env.SALLA_ACCESS_TOKEN, WINDSOR=process.env.WINDSOR_API_KEY;
const ADS=process.env.ADS_ACCOUNT_ID||'263-442-1631';
const GA4=process.env.GA4_ACCOUNT_ID||'499573462';
const PUBLISH=process.env.RADAR_LIVE_PUBLISH==='true';
const exclude=new Set(
 ('122136640,1349833566,1601578360,81233259,134301521,544932232,1435457964,'+
 '1508084346,1609572776,1153827766,1600022680,1389291778,1810209528,'+
 '2109998159,2146218363,314048946,1737673536,1923506631,898468432,'+
 '1747191075,1839284002,'+(process.env.RADAR_EXCLUDED_IDS||''))
 .split(',').map(x=>x.trim()).filter(Boolean)
);
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const cap=v=>Math.min(100,Math.max(0,v));
const id=v=>String(v??'').replace(/^p/i,'').trim();
const dateDaysAgo=offset=>new Date(NOW.getTime()-offset*86400000).toISOString().slice(0,10);
const jsonRows=data=>Array.isArray(data)?data:Array.isArray(data?.data)?data.data:Array.isArray(data?.result)?data.result:[];
function safeURL(v,kind){
 try{
  const u=new URL(String(v));if(u.protocol!=='https:'||u.username||u.password)return false;
  const h=u.hostname.toLowerCase();
  return kind==='product'?(h==='barahstore.com'||h==='www.barahstore.com'):(h==='cdn.salla.sa'||h.endsWith('.salla.network'));
 }catch{return false;}
}
async function readJSON(url,headers={},source='source'){
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(17000),redirect:'follow'});
 if(!r.ok)throw Error(source+' HTTP '+r.status);
 const data=await r.json();
 if(data?.error||data?.success===false)throw Error(source+' API error');
 return data;
}
async function loadCatalog(){
 if(!SALLA)throw Error('missing SALLA_ACCESS_TOKEN');
 const all=[];
 for(let page=1;page<=25;page++){
  const url='https://api.salla.dev/admin/v2/products?status=sale&per_page=50&page='+page;
  const resp=await readJSON(url,{Authorization:'Bearer '+SALLA,Accept:'application/json'},'salla');
  const rows=jsonRows(resp);all.push(...rows);
  if(rows.length<50||(n(resp.pagination?.total)>0&&all.length>=n(resp.pagination.total)))return all;
 }
 throw Error('salla catalog exceeded pagination cap');
}
async function windsor(connector,fields,days,account){
 if(!WINDSOR)throw Error('missing WINDSOR_API_KEY');
 const url=new URL('https://connectors.windsor.ai/'+connector);
 url.searchParams.set('api_key',WINDSOR);
 url.searchParams.set('fields',fields.join(','));
 url.searchParams.set('date_from',dateDaysAgo(days));
 url.searchParams.set('date_to',dateDaysAgo(1));
 url.searchParams.set('select_accounts',account);
 // URL includes secret; NEVER log it, its response, or exception request URLs.
 return jsonRows(await readJSON(url.toString(),{},'windsor_'+connector));
}
function merge(rows,idKey,fields){
 const out=new Map();
 for(const row of rows){
  const key=id(row[idKey]);if(!/^\d{3,}$/.test(key))continue;
  const a=out.get(key)||{};
  for(const f of fields)a[f]=(a[f]||0)+n(row[f]);
  out.set(key,a);
 }
 return out;
}
function productOf(row){
 const cat=row.categories?.at(-1)||row.categories?.[0]||{};
 return{
  id:id(row.id),name:String(row.name||'').trim(),
  url:row.urls?.customer||row.url||'',
  image:row.main_image||row.thumbnail||row.images?.[0]?.image||row.images?.[0]?.original||'',
  category:String(cat.name||'متنوع').slice(0,72),
  family:String(cat.id||cat.name||'general'),
  price:n(row.price?.amount??row.price),
  quantity:Number(row.quantity),
  status:row.status,
  available:row.is_available!==false,
  description:String(row.description||'')
 };
}
function eligible(p){
 return /^\d{3,}$/.test(p.id)&&!exclude.has(p.id)&&p.status==='sale'&&p.available&&
  Number.isFinite(p.quantity)&&p.quantity>=3&&p.price>0&&p.description.length>20&&
  p.name.length>=8&&safeURL(p.url,'product')&&safeURL(p.image,'image')&&
  new RegExp('/p'+p.id+'(?:[/?#]|$)','i').test(p.url);
}
function score(p,a7,a30,g7){
 const clicks=n(a30?.clicks),imp=n(a30?.impressions);
 const recent=n(a7?.clicks),carts=n(g7?.items_added_to_cart);
 if(clicks<1&&carts<1)return null;
 const scores={};
 if(clicks){
  const ctr=(clicks+2)/(imp+200);
  scores.ads=cap(100*(.36*Math.min(1,Math.log1p(clicks)/Math.log1p(30))+
   .28*Math.min(1,ctr/.035)+.24*Math.min(1,n(a30.conversions)/Math.max(3,clicks)*8)+
   .12*Math.min(1,recent/Math.max(3,clicks)*30/7)));
 }
 if(clicks||carts){
  scores.freshness=cap(50*(clicks?recent/Math.max(3,clicks)*30/7:Math.min(1,carts/5)));
 }
 const totalWeight=(scores.ads!==undefined?25:0)+(scores.freshness!==undefined?5:0);
 return {
  score:Math.round(((scores.ads||0)*25+scores.freshness*5)/totalWeight),
  reason:recent?'إشارات اهتمام إعلاني في الرياض خلال 7 أيام':clicks?'نقرات إعلانية في الرياض خلال 30 يومًا':'إضافات سلة في GA4 خلال 7 أيام',
  confidence:'low',
  signal_window:{ads:clicks?'30d':null,ga4:carts?'7d':null}
 };
}
async function urlOK(value,kind){
 if(!safeURL(value,kind))return false;
 for(const method of ['HEAD','GET']){
  try{
   const r=await fetch(value,{method,signal:AbortSignal.timeout(9000),redirect:'follow',
    headers:method==='GET'?{Range:'bytes=0-0'}:{}});
   if(r.body)await r.body.cancel();
   if(r.ok&&safeURL(r.url,kind))return true;
  }catch{}
 }
 return false;
}
async function run(){
 if(!SALLA||!WINDSOR){console.log('RADAR SKIPPED: required secrets not configured.');return;}
 const results=await Promise.allSettled([
  loadCatalog(),
  windsor('google_ads',['campaign_name','product_item_id','impressions','clicks','conversions'],7,ADS),
  windsor('google_ads',['campaign_name','product_item_id','impressions','clicks','conversions'],30,ADS),
  windsor('googleanalytics4',['item_id','items_added_to_cart'],7,GA4)
 ]);
 const [cat,ad7,ad30,cart7]=results;
 if(cat.status!=='fulfilled')throw Error('Salla read failed; no update');
 const adsReady=ad7.status==='fulfilled'&&ad30.status==='fulfilled';
 const filterRiyadh=rows=>rows.filter(r=>/الرياض|riyadh/i.test(String(r.campaign_name||''))&&/pmax|performance\s*max/i.test(String(r.campaign_name||'')));
 const ads7=adsReady?merge(filterRiyadh(ad7.value),'product_item_id',['impressions','clicks','conversions']):new Map();
 const ads30=adsReady?merge(filterRiyadh(ad30.value),'product_item_id',['impressions','clicks','conversions']):new Map();
 const carts=cart7.status==='fulfilled'?merge(cart7.value,'item_id',['items_added_to_cart']):new Map();
 if(!ads30.size&&!carts.size)throw Error('No verifiable product-level signals; no update');
 const candidates=[],seen=new Set();
 for(const raw of cat.value){
  const p=productOf(raw);
  if(seen.has(p.id)||!eligible(p))continue;seen.add(p.id);
  const s=score(p,ads7.get(p.id),ads30.get(p.id),carts.get(p.id));
  if(s)candidates.push({...p,...s});
 }
 candidates.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const products=[],families=new Map();
 for(const p of candidates.slice(0,60)){
  if(products.length>=16)break;
  if((families.get(p.family)||0)>=2)continue;
  const [page,image]=await Promise.all([urlOK(p.url,'product'),urlOK(p.image,'image')]);
  if(!page||!image)continue;
  families.set(p.family,(families.get(p.family)||0)+1);
  products.push({id:p.id,name:p.name,url:p.url,image:p.image,category:p.category,
   score:p.score,reason:p.reason,confidence:p.confidence,signal_window:p.signal_window});
 }
 if(products.length<6)throw Error('Only '+products.length+' verified products; refused update');
 const dateBatch=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(NOW).replace(/-/g,'');
 const payload={
  schema_version:1,section_id:SECTION,date_batch:dateBatch,
  generated_at:NOW.toISOString(),
  valid_until:new Date(NOW.getTime()+86400000).toISOString(),
  source_status:{
   google_ads:adsReady?'available':'unavailable',ga4:cart7.status==='fulfilled'?'available':'unavailable',
   salla_catalog:'available',salla_paid:'not_verified',homepage_exposure:'curated_exclusions_only',
   keyword_planner:'unavailable',search_console:'unavailable',trends:'unavailable',profitability:'unavailable'
  },
  market:{location:'SA',ads_scope:'Riyadh PMAX only',keyword_market_available:false},
  products
 };
 await fs.mkdir('out',{recursive:true});
 await fs.writeFile('out/radar-preview.json',JSON.stringify(payload,null,2)+'\n');
 console.log('RADAR PREVIEW READY',JSON.stringify({batch:dateBatch,products:products.length,ads:ads30.size,ga4:carts.size,publish:PUBLISH}));
 if(!PUBLISH)return;
 const dir='docs';await fs.mkdir(dir,{recursive:true});
 try{
  const old=JSON.parse(await fs.readFile(path.join(dir,'radar.json'),'utf8'));
  if(old?.section_id===SECTION)await fs.writeFile(path.join(dir,'radar.previous.json'),JSON.stringify(old,null,2)+'\n');
 }catch{}
 await fs.writeFile(path.join(dir,'radar.json'),JSON.stringify(payload,null,2)+'\n');
 console.log('RADAR OUTPUT STAGED; GitHub Pages still requires explicit setup');
}
run().catch(e=>{console.error('RADAR FAILURE: '+String(e?.message||e).slice(0,180));process.exitCode=1});
