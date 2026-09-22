// Studio v2 small compatibility/polish layer. Loaded after studio-editor.js.
(() => {
  const q=(s,p=document)=>p.querySelector(s), qa=(s,p=document)=>[...p.querySelectorAll(s)];
  const setPair=(id,value)=>{const a=q('#'+id),b=q('#'+id+'Range');if(a)a.value=value;if(b)b.value=value};

  // Keep every Site tab control in sync with the live state.
  const baseGlobals=applyGlobals;
  applyGlobals=function(){
    baseGlobals();
    const vals={mode:G.mode,bg:G.bg,surface:G.surface,text:G.text,accent:G.accent,pageWidth:G.pageWidth,gap:G.gap,radius:G.radius,sectionSpace:G.sectionSpace,buttonRadius:G.buttonRadius,buttonBorder:G.buttonBorder,buttonBg:G.buttonBg,buttonText:G.buttonText,loaderStyle:G.loaderStyle,loaderSpeed:G.loaderSpeed,loaderSize:G.loaderSize,displayFont:G.display,bodyFont:G.body,customDisplay:G.customDisplay,customBody:G.customBody,fontCSS:G.fontCSS,fontFile:G.fontFile,fontFamily:G.fontFamily,groupMotion:G.groupMotion,groupDur:G.groupDur,groupStagger:G.groupStagger,groupDistance:G.groupDistance};
    Object.entries(vals).forEach(([id,val])=>setPair(id,val));
  };

  const baseBrand=applyBrand;
  applyBrand=function(){
    baseBrand();
    setPair('brandSizeSite',BRAND.size);
    qa('[data-brand-text]').forEach(e=>e.value=BRAND.text);
  };

  const baseHero=applyHero;
  applyHero=function(){
    baseHero();
    const site=q('#heroUrlSite');if(site)site.value=HERO.src;
  };

  const baseSync=syncSelection;
  syncSelection=function(){
    baseSync();
    if(selected?.dataset.type==='tile'){
      ['top','bottom','left','right'].forEach(k=>{const c=q('#e'+k);if(c)c.checked=!!selected.querySelector('.edge.'+k)?.classList.contains('on')});
    }
  };

  // Restore published images into placeholder tiles before the base state applier runs.
  const baseApplyState=applyState;
  applyState=function(s){
    Object.entries(s?.nodes||{}).forEach(([id,a])=>{
      if(!a?.img)return;
      const tile=q(`[data-id="${id}"]`);
      if(tile?.classList.contains('tile')&&!tile.querySelector('img')){
        const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt=a.title||'Portfolio artwork';tile.prepend(img);tile.classList.remove('placeholder');
      }
    });
    baseApplyState(s);
    applyGlobals();applyBrand();applyHero();applyLinks();
  };

  // Allow replacing the placeholder tiles that intentionally start without an <img> tag.
  q('#tileImage')?.addEventListener('change',async e=>{
    if(!selected?.classList.contains('tile')||selected.querySelector('img'))return;
    const file=e.target.files?.[0];if(!file)return;
    const data=await resizeImage(file,1600,.76,360000);
    if(!data){status('Image too large. Use an optimized WebP/JPEG or an image URL.');return}
    const img=document.createElement('img');img.src=data;img.alt='Portfolio artwork';img.loading='lazy';img.decoding='async';selected.prepend(img);selected.classList.remove('placeholder');watchImage(img,selected);push();
  });

  // Duplicate hero controls in the Site tab intentionally point to the same landing image state.
  q('#heroUrlSite')?.addEventListener('change',e=>{const value=e.target.value.trim();if(!value)return;HERO.src=value;applyHero();later()});

  // Brand controls are available both by selecting the logo and from Site > Brand + header.
  const bindBrandUpload=(el)=>el?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;let data=null;if(f.type==='image/svg+xml'&&f.size<90000){data=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f)})}else data=await resizeImage(f,256,.88,90000,true);if(!data){status('Logo is too large. Use a small SVG, PNG or WebP.');return}BRAND.logo=data;applyBrand();push()});
  bindBrandUpload(q('#brandLogoSite'));
  const bs=q('#brandSizeSite'),bsr=q('#brandSizeSiteRange');
  const brandSizeChange=e=>{BRAND.size=Math.max(8,Math.min(80,Number(e.target.value)||14));if(bs&&bs!==e.target)bs.value=BRAND.size;if(bsr&&bsr!==e.target)bsr.value=BRAND.size;applyBrand();later()};
  bs?.addEventListener('input',brandSizeChange);bsr?.addEventListener('input',brandSizeChange);

  // A pasted bare domain becomes https://domain rather than silently doing nothing.
  const baseOpenExternal=openExternal;
  openExternal=function(url,title){
    let safe=(url||'').trim();if(!safe)return;
    if(!/^(https?:|mailto:|tel:)/i.test(safe))safe='https://'+safe.replace(/^\/+/, '');
    if(!/^(https?:|mailto:|tel:)/i.test(safe))return;
    baseOpenExternal(safe,title);
  };

  // Initial sync after both scripts are ready.
  applyGlobals();applyBrand();applyHero();applyLinks();
})();