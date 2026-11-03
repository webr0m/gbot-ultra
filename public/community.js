(() => {
 'use strict';const G=window.GBot;if(!G)return;G.SUPPORT_URL='https://t.me/webrom_bot';let links=null;
 const safe=value=>typeof value==='string'&&/^https:\/\/t\.me\/[A-Za-z0-9_+/-]+$/.test(value);
 function renderLinks(){const main=document.getElementById('main');if(!main||!links||!['home','settings'].includes(G.state.tab)||document.getElementById('official-community'))return;main.insertAdjacentHTML('beforeend',`<section class="section" id="official-community"><div class="card"><h3>Comunidad oficial</h3><p>Novedades, comunidad y contacto con el equipo de GBot.</p><div class="sheet-actions"><a class="btn btn-secondary" href="${G.esc(links.group)}" target="_blank" rel="noopener">👥 Grupo oficial</a><a class="btn btn-secondary" href="${G.esc(links.channel)}" target="_blank" rel="noopener">📣 Canal oficial</a><a class="btn btn-secondary" href="${G.esc(links.contact)}" target="_blank" rel="noopener">✉️ Contacto · @webrom_bot</a></div></div></section>`);}
 for(const name of ['renderHome','renderSettings']){const previous=G[name];G[name]=function(...args){previous.apply(this,args);renderLinks();};}
 fetch('/community.json',{credentials:'omit',cache:'no-cache'}).then(r=>r.ok?r.json():null).then(data=>{if(data&&safe(data.group)&&safe(data.channel)&&safe(data.contact)){links=data;renderLinks();}}).catch(()=>{});
})();
