import test from 'node:test';import assert from 'node:assert/strict';
import {BASE_EXCLUSIONS,eligible,idOf,mergeMetricRows,normalizeProduct,scoreProduct,pickProducts,publicProjection} from '../src/radar-core.mjs';
const product=(id,cat='one',qty=10)=>({id,name:`أداة اختبار منتج رائع رقم ${id}`,quantity:qty,status:'sale',is_available:true,price:{amount:39},main_image:`https://cdn.salla.sa/test/${id}.png`,urls:{customer:`https://barahstore.com/ar/item/p${id}`},categories:[{id:cat,name:cat}],description:'وصف مكتمل'});
test('strict eligibility: price, stock, status, image, URL, duplicate exclusions',()=>{
 const p=normalizeProduct(product(5011111));assert.equal(eligible(p),true);
 assert.equal(eligible({...p,quantity:2}),false);
 assert.equal(eligible({...p,price:0}),false);
 assert.equal(eligible({...p,status:'hidden'}),false);
 assert.equal(eligible({...p,image:'https://example.com/unsafe.png'}),false);
 assert.equal(eligible({...p,url:'http://barahstore.com/p5011111'}),false);
 assert.equal(eligible({...p,id:'122136640'}),false);
});
test('Windsor variant IDs unify without duplication',()=>{
 const out=mergeMetricRows([{product_item_id:'p5011111',clicks:3},{product_item_id:'5011111',clicks:4},{product_item_id:null,clicks:99}], 'product_item_id',['clicks']);assert.equal(out['5011111'].clicks,7);assert.equal(Object.keys(out).length,1);
});
test('weights renormalize without inventing Saudi keyword volume or Salla orders',()=>{
 const s=scoreProduct(normalizeProduct(product(5011111)),{ads_available:true,ads7:{'5011111':{impressions:100,clicks:5}},ads30:{'5011111':{impressions:500,clicks:20,conversions:1}},homepage_verified:true});
 assert.equal(Number.isFinite(s.score),true);assert.equal(s.evidence.includes('keyword_planner:sa'),false);assert.equal(s.evidence.includes('salla:verified:30d'),false);
 assert.equal(s.reason.includes('البحث في السعودية'),false);assert.ok(s.score>=0&&s.score<=100);
});
test('scoring uses verified Salla purchases only',()=>{
 const p=normalizeProduct(product(5011111));
 const no=scoreProduct(p,{ads_available:false,homepage_verified:true,ga7:{'5011111':{items_purchased:500,items_added_to_cart:3}},ga30:{'5011111':{items_purchased:800}}});
 assert.ok(!no.evidence.includes('salla:verified:30d'));
 const yes=scoreProduct(p,{ads_available:false,homepage_verified:true,salla_paid_complete:true,salla7:{'5011111':{quantity:2}},salla30:{'5011111':{quantity:5}}});
 assert.ok(yes.evidence.includes('salla:verified:30d'));
});
test('max two per category and no duplicate product ID',()=>{
 const ps=[...Array(9)].map((_,i)=>product(5011111+i,'family'+Math.floor(i/3)));
 ps.push(product(5011111,'family0'));
 const ads={};ps.forEach(p=>ads[p.id]={clicks:9,impressions:140,conversions:1});
 const ranked=pickProducts(ps,{ads_available:true,ads30:ads,ads7:ads,homepage_verified:true},new Set(),16);
 assert.equal(ranked.length,6);assert.equal(new Set(ranked.map(x=>x.id)).size,6);
 assert.ok([...new Set(ranked.map(x=>x.family))].every(cat=>ranked.filter(x=>x.family===cat).length<=2));
});
test('public projection never includes prices, stock or cost',()=>{
 const p=normalizeProduct(product(5011111));const proj=publicProjection({date_batch:'20261014',generated_at:'2026-10-14T02:00:00.000Z',valid_until:'2026-10-15T02:00:00.000Z',source_status:{},market:{location:'SA'},products:[{...p,score:55,reason:'مؤشر',confidence:'low',evidence:[]}]});
 assert.equal('price'in proj.products[0],false);assert.equal('quantity'in proj.products[0],false);assert.equal('cost_price'in proj.products[0],false);
});
