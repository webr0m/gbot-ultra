(() => {
 'use strict';
 const root=document.documentElement,themeButton=document.getElementById('site-theme'),themeLabel=document.getElementById('site-theme-label');
 const systemTheme=matchMedia('(prefers-color-scheme: light)');
 let themePreference=null;
 try{themePreference=localStorage.getItem('gbot-theme');}catch{}
 function applyTheme(theme){
  root.dataset.theme=theme;document.querySelector('meta[name="theme-color"]').content=theme==='light'?'#f5f7fb':'#050505';
  const lang=document.getElementById('site-language').value||'es',label=window.GBot?.t(theme==='dark'?'dayMode':'nightMode',lang)||(theme==='dark'?'Modo día':'Modo noche');themeLabel.textContent=label;themeButton.setAttribute('aria-label',(window.GBot?.t('changeTheme',lang)||'Cambiar tema')+' · '+label);themeButton.title=label;
 }
 applyTheme(themePreference==='light'||themePreference==='dark'?themePreference:systemTheme.matches?'light':'dark');
 themeButton.addEventListener('click',()=>{themePreference=root.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('gbot-theme',themePreference);}catch{}applyTheme(themePreference);});
 systemTheme.addEventListener('change',()=>{if(themePreference!=='light'&&themePreference!=='dark')applyTheme(systemTheme.matches?'light':'dark');});
 addEventListener('storage',event=>{if(event.key==='gbot-theme'){themePreference=event.newValue;applyTheme(themePreference==='light'||themePreference==='dark'?themePreference:systemTheme.matches?'light':'dark');}});
 // Reuse the Mini App's exact language list and GTranslate engine. No second widget.
 const G=window.GBot,language=document.getElementById('site-language'),feedback=document.getElementById('site-feedback');
 let languageRequest=0;
 if(G){
 G.toast=message=>{document.getElementById('language-status').textContent=message.replace(/panel/g,'página');feedback.hidden=false;};
 for(const item of G.LANGUAGES){const option=document.createElement('option');option.value=item.code;option.textContent=item.flag+' '+item.name;if(item.code==='es')language.replaceChildren(option);else language.appendChild(option);}
 async function translate(code){
  const lang=G.LANGUAGES.some(item=>item.code===code)?code:'es',request=++languageRequest;
  language.value=lang;applyTheme(root.dataset.theme);feedback.hidden=true;language.setAttribute('aria-busy','true');
  try{localStorage.setItem('gbot-site-language',lang);}catch{}
  await G.applyLanguage(lang);
  if(request!==languageRequest)return;
  language.removeAttribute('aria-busy');root.lang=lang==='zh'?'zh-CN':lang;root.dir=lang==='ar'?'rtl':'ltr';
 }
 language.addEventListener('change',()=>translate(language.value));
 document.getElementById('language-retry').addEventListener('click',()=>translate(language.value));
 let savedLanguage='es';try{savedLanguage=localStorage.getItem('gbot-site-language')||'es';}catch{}
 translate(savedLanguage);
 }else{language.disabled=true;document.getElementById('language-status').textContent='No se pudo cargar el selector de idiomas. Recarga la página para reintentar.';document.getElementById('language-retry').hidden=true;feedback.hidden=false;}
 const tabs=[...document.querySelectorAll('[data-page-tab]')];
 function select(id,focus=false){
  for(const tab of tabs){const active=tab.dataset.pageTab===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.getElementById(tab.dataset.pageTab).hidden=!active;if(active&&focus)tab.focus();}
 }
 function fromHash(){select(location.hash==='#comparativa'?'comparativa':'contenido');const target=document.getElementById(location.hash.slice(1));if(target&&!['contenido','comparativa'].includes(target.id))target.scrollIntoView();}
 for(const tab of tabs){tab.addEventListener('click',()=>{select(tab.dataset.pageTab);history.replaceState(null,'','#'+tab.dataset.pageTab);});tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});}
 addEventListener('hashchange',fromHash);fromHash();
})();
