/* BARAH GOOGLE RADAR 24H — standalone, read-only storefront UI.
 * Paste ONCE only AFTER server endpoint is live and verified.
 * Set window.BARAH_RADAR_24H_FEED_URL before this script.
 * No Google/Salla credentials. No native cart or checkout changes.
 */
(function(){
  'use strict';
  const ID='barah-google-radar-24h', URL_CONF=window.BARAH_RADAR_24H_FEED_URL;
  const loc=window.location;
  if(!/^(?:www\.)?barahstore\.com$/i.test(loc.hostname)||!/^\/(?:ar|en)?\/?$/.test(loc.pathname))return;
  if(window.__BARAH_GOOGLE_RADAR_24H_V1__)return;
  window.__BARAH_GOOGLE_RADAR_24H_V1__=true;
  if(typeof URL_CONF!=='string'||!URL_CONF.startsWith('https://'))return;
  let feedUrl;
  try { feedUrl=new URL(URL_CONF); if(!['https:'].includes(feedUrl.protocol)||feedUrl.username||feedUrl.password)throw Error(); }
  catch{return;}
  const AB_ENABLED=window.BARAH_RADAR_24H_AB_ENABLED===true;
  const getBucket=()=>{
    if(!AB_ENABLED)return 'treatment';
    try{
      const key='barah_radar_24h_ab_v1';let b=localStorage.getItem(key);
      if(b==='control'||b==='treatment')return b;
      b=(crypto.getRandomValues(new Uint32Array(1))[0]%2===0)?'control':'treatment';
      localStorage.setItem(key,b);return b;
    }catch{return 'control';}
  };
  const bucket=getBucket();
  function track(name,params){
    const payload={section_id:ID,experiment_group:bucket,...params};
    // gtag pushes to GTM dataLayer internally: DO NOT push via both paths.
    if(typeof window.gtag==='function')window.gtag('event',name,payload);
    else if(Array.isArray(window.dataLayer))window.dataLayer.push({event:name,...payload});
  }
  track('barah_radar_assignment',{date_batch:'assignment'});
  if(bucket==='control')return;
  let section=null,done=false,batch=null,impressed=false;
  const cards=()=>section?section.querySelectorAll('.bgr-card'):[];
  const allowURL=(value,image)=>{
    try {const u=new URL(value);
      if(u.protocol!=='https:'||u.username||u.password)return null;
      const host=u.hostname.toLowerCase();
      if(image)return (host==='cdn.salla.sa'||host.endsWith('.salla.network'))?u.href:null;
      return (host==='barahstore.com'||host==='www.barahstore.com')?u.href:null;
    }catch{return null;}
  };
  function itemIdFromLink(link){const m=String(link||'').match(/\/p(\d+)(?:[/?#]|$)/i);return m?m[1]:null;}
  function onPageIds(){const s=new Set();document.querySelectorAll('a[href*="/p"]').forEach(a=>{
    if(a.closest('#'+ID))return; const id=itemIdFromLink(a.getAttribute('href'));if(id)s.add(id);
  });return s;}
  const el=(t,cls,text)=>{const n=document.createElement(t);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  function headingAnchor(){
    const best=document.querySelector('section.home-block--products-slider,section.s-block-products-slider');
    if(best)return {node:best,where:'afterend'};
    for(const h of document.querySelectorAll('h2,h3')){
      const text=(h.textContent||'').replace(/\s+/g,' ');
      if(/الأكثر\s*مبيع|الأكثر\s*طلب/.test(text)){
        const s=h.closest('section');if(s&&s!==document.body)return {node:s,where:'afterend'};
      }
    }
    for(const h of document.querySelectorAll('h2,h3')){
      if(/وصل\s*حديث|أحدث\s*المنتجات/.test(h.textContent||'')){
        const s=h.closest('section');if(s)return {node:s,where:'beforebegin'};
      }
    }
    const hero=document.getElementById('barah-step-hero-v12');
    if(hero)return {node:hero,where:'afterend'};
    const foot=document.querySelector('footer');if(foot)return {node:foot,where:'beforebegin'};
    return null;
  }
  function stamp(s){try{return new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));}catch{return '';}}
  const safeText=(value,max)=>String(value??'').slice(0,max);
  function render(data){
    if(done)return; const target=headingAnchor();if(!target)return;
    if(!Array.isArray(data.products))return;
    const now=Date.now(),created=Date.parse(data.generated_at),until=Date.parse(data.valid_until);
    if(!Number.isFinite(created)||now-created>72*3600000||created>now+300000||!Number.isFinite(until))return;
    const stale=!!data.stale||now>until;
    const existing=onPageIds(), seen=new Set();
    const products=data.products.filter(p=>{
      const id=String(p.id),u=allowURL(p.url,false),img=allowURL(p.image,true);
      if(!/^\d+$/.test(id)||!u||!img||!p.name||seen.has(id)||existing.has(id))return false;
      seen.add(id);return true;
    }).slice(0,16);
    if(products.length<6)return;
    const root=el('section','bgr-root');root.id=ID;root.dir='rtl';
    root.setAttribute('aria-labelledby',ID+'-title');
    root.dataset.batch=safeText(data.date_batch,16);
    const heading=el('div','bgr-heading');
    const textWrap=el('div','bgr-intro');
    textWrap.appendChild(el('p','bgr-kicker','مختارات بارعة السعودية'));
    const title=el('h2','bgr-title',stale?'🇸🇦 رادار بارعة | اختيارات تستحق الاكتشاف':'🇸🇦 رادار بارعة | اكتشف ما يناسبك اليوم');title.id=ID+'-title';
    textWrap.appendChild(title);
    textWrap.appendChild(el('p','bgr-description',stale?'آخر اختيارات موثقة متاحة، قد لا تكون بيانات اليوم مكتملة.':'اختيارات عملية من بارعة تتجدد كل يوم بناءً على إشارات الاهتمام والشراء'));
    heading.appendChild(textWrap);heading.appendChild(el('span','bgr-updated',(stale?'آخر مزامنة متاحة: ':'آخر تحديث: ')+stamp(data.generated_at)));
    root.appendChild(heading);
    const grid=el('div','bgr-grid');root.appendChild(grid);
    const more=el('button','bgr-more','عرض المزيد');more.type='button';
    more.setAttribute('aria-expanded','false');root.appendChild(more);
    let expanded=false;
    const reveal=()=>{
      const initial=window.matchMedia('(max-width:767px)').matches?6:8;
      [...grid.children].forEach((card,i)=>{card.hidden=!expanded&&i>=initial;});
      more.hidden=products.length<=initial||expanded;more.setAttribute('aria-expanded',String(expanded));
    };
    more.addEventListener('click',()=>{expanded=true;reveal();});
    for(const p of products){
      const a=el('a','bgr-card');a.href=allowURL(p.url,false);a.dataset.productId=String(p.id);
      a.setAttribute('aria-label',safeText(p.name,140)+'، عرض المنتج');
      const cover=el('div','bgr-media');const img=el('img','bgr-image');
      img.src=allowURL(p.image,true);img.alt=safeText(p.name,140);img.loading='lazy';img.decoding='async';img.width=320;img.height=320;
      img.addEventListener('error',()=>{a.remove();if(cards().length<6){root.remove();done=false;}},{once:true});
      cover.appendChild(img);a.appendChild(cover);
      const body=el('div','bgr-body');
      body.appendChild(el('span','bgr-category',safeText(p.category,40)));
      body.appendChild(el('strong','bgr-name',safeText(p.name,130)));
      if(p.reason)body.appendChild(el('small','bgr-reason',safeText(p.reason,155)));
      body.appendChild(el('span','bgr-cta','عرض وشراء ←'));a.appendChild(body);
      a.addEventListener('click',()=>{
        try {sessionStorage.setItem('barah_radar_24h_touch',JSON.stringify({product_id:String(p.id),date_batch:data.date_batch,ts:Date.now()}));}catch{}
        track('barah_radar_product_click',{product_id:String(p.id),date_batch:data.date_batch,confidence:p.confidence||'unknown'});
      });
      grid.appendChild(a);
    }
    target.node.insertAdjacentElement(target.where,root);section=root;batch=data;done=true;
    reveal();
    if('IntersectionObserver' in window){
      const observer=new IntersectionObserver(entries=>{
        if(!impressed&&entries.some(e=>e.isIntersecting&&e.intersectionRatio>=.5)){
          impressed=true;track('barah_radar_impression',{date_batch:data.date_batch,visible_product_count:cards().length});observer.disconnect();
        }
      },{threshold:.5});observer.observe(root);
    }
  }
  // Add-to-cart only when real Salla success is confirmed in an existing trusted integration.
  // Never automatically emit a fake cart event from a card/link click.
  window.BarahGoogleRadar24H={trackConfirmedAddToCart:function({productId,dateBatch}={}){
    if(!batch||!/^\d+$/.test(String(productId)))return;
    if(!batch.products.some(p=>String(p.id)===String(productId)))return;
    track('barah_radar_add_to_cart',{product_id:String(productId),date_batch:dateBatch||batch.date_batch});
  }};
  async function load(){
    try{
      const response=await fetch(feedUrl.href,{mode:'cors',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(9500)});
      if(!response.ok)return;
      const data=await response.json();
      if(data.section_id!==ID||!Array.isArray(data.products))return;
      let tries=0;
      function attempt(){if(done||tries++>=20)return;render(data);if(!done)setTimeout(attempt,250);}
      attempt();
      // Only detect removal of our own section; never rewrite other blocks.
      if(window.MutationObserver){let pending=false;
        const obs=new MutationObserver(()=>{if(pending||!done||document.getElementById(ID))return;
          pending=true;setTimeout(()=>{pending=false;if(!document.getElementById(ID)){done=false;render(data);}},150);
        });
        obs.observe(document.body,{childList:true,subtree:true});
        setTimeout(()=>obs.disconnect(),20000);
      }
    }catch{/* No feed => no unverified section. */}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();

/* Independent read-only attribution listener: works on the PRODUCT page,
 * only after Salla's own successful add-to-cart callback.
 * Never invokes cart.addItem, never sends purchase, never modifies the cart.
 */
(function(){
 'use strict';
 if(window.__BARAH_RADAR_NATIVE_CART_V1__)return;
 window.__BARAH_RADAR_NATIVE_CART_V1__=true;
 const key='barah_radar_24h_touch',section_id='barah-google-radar-24h';
 const current=(location.pathname.match(/\/p(\d+)(?:[/?#]|$)/i)||[])[1];
 if(!current)return;
 function onSuccess(response,productId){
   try {
     const touch=JSON.parse(sessionStorage.getItem(key)||'null');
     if(!touch||touch.product_id!==String(productId)||touch.product_id!==current||Date.now()-touch.ts>24*3600000)return;
     sessionStorage.removeItem(key);
     const p={section_id,product_id:current,date_batch:touch.date_batch};
     if(typeof window.gtag==='function')window.gtag('event','barah_radar_add_to_cart',p);
     else if(Array.isArray(window.dataLayer))window.dataLayer.push({event:'barah_radar_add_to_cart',...p});
   }catch{}
 }
 function attach(){
   const sdk=window.salla||window.Salla;
   if(!sdk?.cart?.event?.onItemAdded)return false;
   sdk.cart.event.onItemAdded(onSuccess);
   return true;
 }
 if(attach())return;
 let tries=0;const timer=setInterval(()=>{if(attach()||++tries>=30)clearInterval(timer);},300);
})();
