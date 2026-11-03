/* Read-only infrastructure status, available to administrators on every plan. */
(() => {
  'use strict';
  const G=window.GBot;if(!G)return;
  let sequence=0;
  const date=value=>value?new Date(value).toLocaleString(): 'Aún no disponible';
  const names={ok:'Operativo',error:'Requiere revisión',unknown:'Sin confirmar'};
  const render=G.renderSettings;
  G.renderSettings=function(){
    render();
    const main=document.getElementById('main');if(!main||!G.state.bootstrap)return;
    main.insertAdjacentHTML('beforeend',`<section class="section"><div class="section-header"><div><div class="section-title">${G.icon('i-check-circle')} Estado del servicio</div><div class="section-subtitle">Conexión, tareas y copias de seguridad</div></div></div><div class="card"><div class="row-between wrap"><div><div class="settings-card-title">Supervisión automática</div><div class="settings-card-desc" style="margin:0">Consulta la última revisión y el respaldo de la plataforma.</div></div><button type="button" class="btn btn-secondary btn-sm" data-action="operations-open">Ver estado</button></div></div></section>`);
  };
  G.registerAction('operations-open',async()=>{
    const id=G.state.chat?.id,request=++sequence;if(!id)return;
    G.openSheet({title:'Estado del servicio',body:'<div class="empty-state" role="status">Consultando la última revisión…</div>'});
    const version=G.state.sheetVersion;
    try{
      const d=G.DEMO?{checkedAt:new Date().toISOString(),stale:false,status:'ok',checks:['Mini App','Base de datos','Conexión con Telegram','Tareas programadas','Respaldo automático'].map(label=>({label,status:'ok'})),backup:{createdAt:new Date().toISOString(),verifiedAt:new Date().toISOString(),retained:14},incidents:[],notificationsEnabled:true}:await G.api.get('/api/operations?chat_id='+id);
      if(request!==sequence||id!==G.state.chat?.id||!G.state.sheetOpen||version!==G.state.sheetVersion)return;
      G.openSheet({title:'Estado del servicio',body:`<div class="adv-center"><div class="adv-intro"><span class="badge">${G.DEMO?'DEMOSTRACIÓN':G.esc(names[d.status]||names.unknown)}</span><h3>${d.stale?'La revisión necesita actualizarse':'Tu comunidad, bajo supervisión'}</h3><p>Última revisión: ${G.esc(date(d.checkedAt))}. El hosting comprueba el servicio cada cinco minutos.</p></div><div class="card"><div class="list">${d.checks.map(c=>`<div class="list-item"><span class="toggle-icon" style="color:var(--${c.status==='ok'?'success':'warning'})">${G.icon(c.status==='ok'?'i-check-circle':'i-alert-triangle')}</span><div class="list-item-main"><div class="list-item-title">${G.esc(c.label)}</div><div class="list-item-sub">${G.esc(names[c.status]||names.unknown)}</div></div></div>`).join('')}</div></div><div class="card"><h3>Respaldo protegido</h3><p>Última copia: ${G.esc(date(d.backup.createdAt))}</p><p>Integridad verificada: ${G.esc(date(d.backup.verifiedAt))}</p><p>Se conserva una copia diaria, hasta catorce. Las copias están cifradas y fuera de la web pública.</p></div>${d.incidents.length?`<div class="card"><h3>Incidencias recientes</h3>${d.incidents.map(i=>`<p>${G.esc(date(i.at))} · ${i.recovered?'Servicio recuperado':'Incidencia confirmada'}</p>`).join('')}</div>`:''}<p class="hint">${d.notificationsEnabled?'La administración recibe avisos de incidencias confirmadas y recuperación.':'Las incidencias se registran en este panel.'}${d.notificationFailed?' El último aviso no pudo entregarse.':''} Si el hosting completo deja de responder, esta revisión también se detiene.</p><div class="sheet-actions"><button type="button" class="btn btn-secondary" data-action="operations-open">Actualizar</button><button type="button" class="btn btn-primary" data-action="close-sheet">Cerrar</button></div></div>`});
    }catch(error){if(request===sequence&&id===G.state.chat?.id&&version===G.state.sheetVersion)G.openSheet({title:'Estado del servicio',body:`<div class="empty-state"><p>${G.esc(error.message||'No fue posible consultar el estado.')}</p><button type="button" class="btn btn-secondary" data-action="operations-open">Reintentar</button></div>`});}
  });
})();
