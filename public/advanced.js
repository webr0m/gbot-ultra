/* GBot · Centro Premium. All access is also checked on the server. */
(() => {
  'use strict';
  const G=window.GBot;if(!G)return;
  let session=null, sequence=0, pendingTransfer=null;
  const esc=G.esc;
  const definitions={
    raid:{title:'Antirraids',description:'Protección temporal ante ingresos masivos.',fields:[['enabled','Activar detección','check'],['threshold','Ingresos para activar','number',3,500],['windowSeconds','Ventana en segundos','number',10,300],['durationSeconds','Duración de protección (segundos)','number',60,86400],['action','Acción','select',['captcha','mute','ban']],['sanctionSeconds','Duración de sanción (segundos)','number',60,86400]]},
    locks:{title:'Contenido permitido',description:'Una sola acción por mensaje. Los administradores y usuarios exceptuados conservan sus excepciones.',fields:[['enabled','Activar bloqueos','check'],['types','Tipos bloqueados','types'],['action','Acción','select',['delete','warn','mute','ban']],['durationSeconds','Duración de sanción (segundos)','number',60,2592000]]},
    probation:{title:'Periodo inicial',description:'Solo en supergrupos. Limita el envío de multimedia, stickers y encuestas después del ingreso o la verificación. Conserva las restricciones individuales existentes.',fields:[['enabled','Activar periodo inicial','check'],['minutes','Duración desde el ingreso (minutos)','number',1,10080]]},
    forwarding:{title:'Reenvíos por origen',description:'Elige una acción por origen. Telegram identifica por separado a los autores con identidad oculta.',fields:[['actions','Acción por origen','origins'],['durationSeconds','Duración de la sanción (segundos)','number',60,2592000]]},
    textLimits:{title:'Patrones y longitud',description:'Una regla por línea. Usa * entre fragmentos y && para exigir varios términos en cualquier orden.',fields:[['patterns','Patrones','textarea',2000],['maxLength','Máximo de caracteres visibles (0 = sin límite)','number',0,100000],['action','Acción','select',['delete','warn','mute','ban']],['durationSeconds','Duración de la sanción (segundos)','number',60,2592000]]},
    discussion:{title:'Comentario del canal vinculado',description:'Publica una respuesta automática por cada nueva entrada del canal vinculado que Telegram reenvíe al grupo de discusión.',fields:[['enabled','Activar comentarios automáticos','check'],['text','Texto del comentario','textarea',1000]]},
    warningExpiry:{title:'Caducidad de advertencias',description:'El vencimiento se fija al crear nuevas advertencias. El historial se conserva.',fields:[['days','Días de vigencia (0 = sin vencimiento)','number',0,365]]},
    night:{title:'Modo nocturno',description:'Guarda y restaura permisos anteriores. El respaldo del hosting puede tardar hasta el siguiente cron de cinco minutos.',fields:[['enabled','Activar horario','check'],['timezone','Zona horaria IANA','text'],['start','Hora de cierre','time'],['end','Hora de apertura','time'],['days','Días de inicio del horario','days']]},
    filters:{title:'Respuestas por frases',description:'Activa las respuestas creadas en Contenido avanzado. Cada una tiene un intervalo mínimo.',fields:[['enabled','Activar respuestas','check']]},
    topics:{title:'Temas y destinos',description:'Usa 0 para el destino general. Para obtener un ID, ejecuta /id dentro del tema.',fields:[['welcomeThreadId','Tema de bienvenida','number',0,2147483647],['logThreadId','Tema en el canal o grupo de registros','number',0,2147483647]]},
    silent:{title:'Moderación silenciosa',description:'Suprime avisos automáticos públicos y conserva registros. Requiere un destino de registros configurado y accesible.',fields:[['enabled','Activar avisos silenciosos','check']]},
    joinGate:{title:'Verificación antes de ingresar',description:'Telegram abre el portal si GBot está asignado como bot guardián. En solicitudes normales, GBot envía el desafío por privado.',fields:[['enabled','Activar captcha previo','check'],['mode','Modo','select',['button','math']]]},
    richNotes:{title:'Notas enriquecidas',description:'Permite texto, multimedia, botones y entrega privada. Guarda un medio respondiendo con /saverich nombre en Telegram.',fields:[['enabled','Activar notas enriquecidas','check']]},
    observation:{title:'Modo de observación',description:'Registra lo que harían las reglas automáticas sin ejecutar sus sanciones. Los baneos globales existentes mantienen su política.',fields:[['enabled','Observar sin sancionar','check']]},
  };
  const origins={person:'Personas',bot:'Bots',hidden_user:'Autor con identidad oculta',chat:'Grupos',channel:'Canales'};
  const types={sticker:'Stickers',gif:'GIF',voice:'Notas de voz',audio:'Audios',video:'Vídeos',photo:'Fotos',document:'Archivos',forward:'Reenvíos',invite:'Enlaces de Telegram',anonymous:'Publicaciones como canal',poll:'Encuestas',rich_message:'Mensajes enriquecidos',guest_bot:'Bots invitados',live_photo:'Live Photos',story:'Historias',spoiler:'Spoilers',custom_emoji:'Emojis personalizados',giveaway:'Sorteos',external_reply:'Citas de otros chats'};
  const labels={allow:'Permitir',delete:'Borrar',warn:'Advertir',mute:'Silenciar',ban:'Banear',unban:'Retirar baneo global','cas-allow':'Exceptuar de CAS','cas-remove':'Quitar excepción de CAS',create:'Crear',rename:'Renombrar',close:'Cerrar',reopen:'Reabrir',captcha:'Captcha',button:'Botón',math:'Matemático',word:'Palabra',exact:'Frase exacta',prefix:'Inicio de frase',apply:'Aplicar en este grupo',skip:'No aplicar',undo:'Revertir en este grupo',...origins};
  const button=(text,action,attrs='')=>`<button type="button" class="btn btn-secondary" data-action="${action}" ${attrs}>${esc(text)}</button>`;
  const field=(label,input)=>`<label class="field"><span class="field-label">${esc(label)}</span>${input}</label>`;
  const input=(name,type='text',value='',extra='')=>`<input class="input" name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}>`;
  const select=(name,options,value)=>`<select class="input" name="${name}">${options.map(o=>`<option value="${esc(o)}" ${o===value?'selected':''}>${esc(labels[o]||o)}</option>`).join('')}</select>`;
  const check=(name,label,on,value='on')=>`<label class="adv-check"><input type="checkbox" name="${name}" value="${esc(value)}" ${on?'checked':''}><span>${esc(label)}</span></label>`;
  const form=(kind,body)=>`<form data-form="advanced-${kind}">${body}<div class="sheet-actions"><button class="btn btn-primary" type="submit">Guardar</button></div></form>`;
  const current=()=>session&&G.state.chat?.id===session.chatId&&G.state.sheetOpen;
  const allowed=key=>session.data.features.find(f=>f.key===key)?.allowed;
  const actionPost=async(route,body)=>{
    if(!current())throw new Error('Vuelve a abrir el Centro Premium de este grupo.');
    const original=session,version=G.state.sheetVersion;
    const result=await G.api.post('/api/advanced/'+route,{chatId:original.chatId,...body});
    if(session!==original||G.state.chat?.id!==original.chatId||G.state.sheetVersion!==version)throw new Error('Cambiaste de vista. Revisa el resultado en el grupo original.');
    return result;
  };
  const sheet=(title,body)=>{G.openSheet({title,body:`<div class="adv-center">${body}</div>`});session.sheetVersion=G.state.sheetVersion;};
  async function refresh(){
    const chatId=session.chatId,version=G.state.sheetVersion;
    const data=await G.api.get('/api/advanced?chat_id='+chatId);
    if(!current()||G.state.sheetVersion!==version)return false;
    session.data=data;return true;
  }
  async function finish(message='Guardado correctamente.'){
    const chatId=session.chatId;if(await refresh()&&G.state.chat?.id===chatId){G.toast(message,'success');withGlobalInfo();}
  }
  function overview(){
    if(!current())return;
    const d=session.data;
    const cards=d.features.filter(f=>definitions[f.key]).map(f=>{
      const def=definitions[f.key],s=d.settings[f.key],active=s.enabled??(s.days>0||s.welcomeThreadId>0||s.logThreadId>0||(s.actions&&Object.keys(s.actions).length)||s.patterns||s.maxLength);
      return `<button class="adv-feature" type="button" data-action="advanced-section" data-key="${f.key}"><span><strong>${esc(def.title)}</strong><small>${esc(def.description)}</small></span><span class="adv-status">${esc(f.allowed?(active?'Activo':'Configurar'):f.tier.toUpperCase())}</span></button>`;
    }).join('');
    sheet('Centro Premium',`<div class="adv-intro"><span class="badge">${esc(d.tier.toUpperCase())}</span><h3>Protección que puedes ajustar.</h3><p>Activa solo las reglas que necesite este grupo. Cada cambio conserva su versión.</p></div><div class="adv-grid">${cards}</div><div class="adv-tools">${button('Usuarios de confianza','advanced-trust')}${button('Contenido avanzado','advanced-content')}${button('Importar e historial','advanced-transfer')}${button('Gestionar temas','advanced-topics')}${button('Alianzas GBot','advanced-alliance')}${button('Simular reglas','advanced-simulate')}${button('Publicaciones y filtro visual','automation-open')}${button('Asistente y marca propia','ultra-open')}</div><div class="card"><h4>Planes disponibles</h4>${d.tiers.map(t=>`<p><strong>${esc(t.label)}</strong> · ${esc(t.description)}${t.available?'':' · Venta aún no disponible.'}</p>`).join('')}</div>${d.operations.length?`<div class="card"><h4>Operaciones por revisar</h4><p>Una respuesta de Telegram pudo perderse. Revisa el registro antes de repetir.</p>${d.operations.map(o=>`<p class="mono">${esc(o.key)} · ${esc(o.state)}</p>`).join('')}</div>`:''}`);
  }
  const gate=key=>{if(allowed(key))return true;G.toast('Requiere '+session.data.features.find(f=>f.key===key)?.tier+'. Consulta los planes en Premium.','error');return false;};
  const originalOverview=overview;
  function withGlobalInfo(){
    originalOverview();if(!current())return;const d=session.data;
    document.querySelector('.adv-center')?.insertAdjacentHTML('afterbegin',`<div class="card"><h4>Protección global · Gratis</h4><p>Baneo global propio y CAS en todos los planes. CAS: ${d.cas?.enabled?'activo':'sin configurar'}.</p><a href="https://cas.chat" target="_blank" rel="noopener">Powered by CAS ↗</a><div class="adv-tools">${button('Consultar usuario','advanced-cas-check')}${d.developer?button('Gestionar baneos globales','advanced-global'):''}</div></div>`);
    document.querySelector('.adv-tools [data-action="advanced-content"]')?.insertAdjacentHTML('afterend',
      button('Reacciones · Pro','advanced-reactions')+button('Artículos · Pro','advanced-articles')+
      button('Invitaciones · Pro','advanced-invites')+button('Moderación por lotes · Pro','advanced-bulk')+
      button('Roles temporales · Ultra','advanced-delegates'));
  }
  G.registerAction('advanced-open',async()=>{
    const chatId=G.state.chat?.id;if(!chatId)return;const req=++sequence;
    G.openSheet({title:'Centro Premium',body:'<p>Cargando las funciones de este grupo…</p>'});const version=G.state.sheetVersion;
    const data=await G.api.get('/api/advanced?chat_id='+chatId);
    if(req!==sequence||G.state.chat?.id!==chatId||!G.state.sheetOpen||G.state.sheetVersion!==version)return;
    session={chatId,data,sheetVersion:version};withGlobalInfo();
  });
  G.registerAction('advanced-home',withGlobalInfo);
  G.registerAction('advanced-cas-check',()=>{
    if(!current())return;sheet('Consultar protección global',form('cas-check',field('ID de Telegram',input('userId','number','','min="1" required')))+'<div id="cas-result" aria-live="polite"></div>');
  });
  G.registerForm('advanced-cas-check',async f=>{
    const chatId=session.chatId,version=G.state.sheetVersion,userId=Number(new FormData(f).get('userId'));
    const r=await G.api.get('/api/globalban/check?chat_id='+chatId+'&user_id='+userId);if(!current()||G.state.sheetVersion!==version||session.chatId!==chatId)return;
    document.getElementById('cas-result').textContent=r.verdict.banned?'Registro activo · '+(r.verdict.source==='cas'?'CAS': 'Lista propia de GBot')+' · '+r.verdict.reason:r.cas.status==='unavailable'?'CAS no disponible; no se encontraron registros locales.':'Sin baneo global confirmado.';
  });
  G.registerAction('advanced-global',async()=>{
    if(!current()||!session.data.developer)return;const version=G.state.sheetVersion;const r=await G.api.get('/api/globalban');if(!current()||G.state.sheetVersion!==version)return;
    sheet('Baneos globales',`<p>CAS se consulta por separado y no se copia a la lista propia.</p>${form('global',field('ID de Telegram',input('userId','number','','min="1" required'))+field('Acción',select('action',['ban','unban','cas-allow','cas-remove'],'ban'))+field('Motivo',input('reason','text','','minlength="3" maxlength="500" required')))}<h4>Lista global propia</h4>${r.bans.map(b=>`<p>${esc(b.user_id)} · ${esc(b.reason||'Sin motivo')}</p>`).join('')||'<p>Sin registros.</p>'}<h4>Excepciones de CAS</h4>${r.exceptions.map(b=>`<p>${esc(b.user_id)} · ${esc(b.reason)}</p>`).join('')||'<p>Sin excepciones.</p>'}`);
  });
  G.registerForm('advanced-global',async f=>{const data=Object.fromEntries(new FormData(f)),version=G.state.sheetVersion;data.userId=Number(data.userId);await G.api.post('/api/globalban',data);if(!current()||G.state.sheetVersion!==version)return;await finish();});
  G.registerAction('advanced-section',target=>{
    const key=target.dataset.key;if(!current()||!definitions[key]||!gate(key))return;
    const def=definitions[key],s=session.data.settings[key];
    const fields=def.fields.map(([name,label,type,min,max])=>{
      if(type==='check')return check(name,label,s[name]);
      if(type==='types')return `<fieldset><legend>${label}</legend>${Object.entries(types).map(([value,title])=>check(name,title,s[name].includes(value),value)).join('')}</fieldset>`;
      if(type==='origins')return `<fieldset><legend>${label}</legend>${Object.entries(origins).map(([value,title])=>field(title,select('origin_'+value,['allow','delete','warn','mute','ban'],s[name][value]||'allow'))).join('')}</fieldset>`;
      if(type==='textarea')return field(label,`<textarea class="input" name="${name}" maxlength="${min}" rows="5">${esc(s[name])}</textarea>`);
      if(type==='days')return `<fieldset><legend>${label}</legend>${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'].map((title,n)=>check(name,title,s[name].includes(n),n)).join('')}</fieldset>`;
      return field(label,type==='select'?select(name,min,s[name]):input(name,type,s[name],type==='number'?`min="${min}" max="${max}" required`: 'required'));
    }).join('');
    sheet(def.title,`<p>${esc(def.description)}</p><form data-form="advanced-settings" data-section="${key}">${fields}<div class="sheet-actions"><button class="btn btn-primary" type="submit">Guardar configuración</button>${button('Volver','advanced-home')}</div></form>${key==='raid'?`<div class="card"><p>Estado temporal: ${session.data.raid?'activo hasta '+esc(G.fmtDateTime(session.data.raid.until_at)):'inactivo'}</p>${button('Activar ahora','advanced-raid','data-seconds="900"')}${button('Desactivar temporal','advanced-raid','data-seconds="0"')}</div>`:''}${key==='joinGate'?'<div class="card"><p>Habilita las solicitudes de ingreso y asigna GBot como bot guardián desde los ajustes del grupo en Telegram.</p>'+button('Comprobar portal','advanced-join-guard')+'<p id="adv-guard-status" aria-live="polite"></p></div>':''}`);
  });
  G.registerAction('advanced-join-guard',async()=>{
    if(!current()||!gate('joinGate'))return;
    const output=document.getElementById('adv-guard-status');
    if(!output)return;
    output.textContent='Comprobando en Telegram…';
    try{
      const result=await G.api.get('/api/advanced/join-guard?chat_id='+session.chatId);
      if(!output.isConnected)return;
      output.textContent=[
        result.supported?'Bot habilitado para el portal.':'Falta habilitar las consultas de ingreso del bot en BotFather.',
        result.assigned?'GBot es el bot guardián de este grupo.':'Falta asignar GBot como bot guardián del grupo.',
        result.canInvite?'Permiso para gestionar ingresos confirmado.':'Falta el permiso de administrador para invitar usuarios.',
      ].join(' ');
    }catch{if(output.isConnected)output.textContent='No se pudo comprobar en Telegram. Inténtalo de nuevo.';}
  });
  G.registerForm('advanced-settings',async f=>{
    if(!current())return;const key=f.dataset.section,d=new FormData(f),settings=structuredClone(session.data.settings);
    for(const [name,,type]of definitions[key].fields){
      if(type==='origins'){
        settings[key][name]=Object.fromEntries(Object.keys(origins).map(origin=>[origin,d.get('origin_'+origin)]).filter(([,action])=>action!=='allow'));
        continue;
      }
      settings[key][name]=type==='check'?d.has(name):type==='types'?d.getAll(name):type==='days'?d.getAll(name).map(Number):type==='number'?Number(d.get(name)):String(d.get(name));
    }
    const original=session,version=G.state.sheetVersion;
    await G.api.patch('/api/advanced',{chatId:original.chatId,settings,version:original.data.version});
    if(session!==original||G.state.chat?.id!==original.chatId||G.state.sheetVersion!==version)return;await finish();
  });
  G.registerAction('advanced-reactions',()=>{
    if(!current()||!gate('reactions'))return;
    sheet('Moderación de reacciones',`<p>Silencia solo las reacciones de un miembro o retira las que ya agregó.</p><div class="adv-tools">${button('Silenciar','advanced-reaction-edit','data-kind="mute"')}${button('Retirar de un mensaje','advanced-reaction-edit','data-kind="remove"')}${button('Retirar recientes','advanced-reaction-edit','data-kind="clear"')}${button('Volver','advanced-home')}</div>`);
  });
  const reactionTitles={mute:'Silenciar reacciones',remove:'Retirar reacciones de un mensaje',clear:'Retirar reacciones recientes'};
  G.registerAction('advanced-reaction-edit',t=>{
    const kind=t.dataset.kind;if(!current()||!gate('reactions')||!reactionTitles[kind])return;
    const help=kind==='clear'?'<p>Telegram permite retirar hasta 10.000 reacciones recientes de esta persona en el grupo.</p>':'';
    const detail=kind==='mute'?field('Duración en minutos',input('minutes','number',60,'min="1" max="43200" required')):kind==='remove'?field('ID del mensaje en este grupo',input('messageId','number','','min="1" required')):'';
    sheet(reactionTitles[kind],`${help}<form data-form="advanced-reaction" data-kind="${kind}">${field('ID de la persona',input('userId','number','','min="1" required'))}${detail}<div class="sheet-actions"><button class="btn btn-primary" type="submit">Revisar acción</button>${button('Volver','advanced-reactions')}</div></form>`);
  });
  G.registerForm('advanced-reaction',f=>{
    if(!current())return;
    const action=f.dataset.kind,d=new FormData(f),userId=Number(d.get('userId')),chatId=session.chatId;
    const body={action,userId};
    if(action==='mute')body.minutes=Number(d.get('minutes'));
    if(action==='remove')body.messageId=Number(d.get('messageId'));
    G.openConfirm({title:reactionTitles[action],text:`Usuario ${userId} · ${action==='mute'?body.minutes+' minutos':action==='remove'?'Mensaje '+body.messageId:'Hasta 10.000 reacciones en este grupo'}.`,confirmText:'Aplicar',onConfirm:async()=>{
      if(!current()||session.chatId!==chatId)return;
      await actionPost('reactions',body);await finish('Moderación de reacciones aplicada.');
    }});
  });
  const articleNames={welcome:'Bienvenida',rules:'Reglas del grupo'};
  G.registerAction('advanced-articles',()=>{
    if(!current()||!gate('richArticles'))return;
    const articles=session.data.settings.richArticles;
    sheet('Artículos enriquecidos',`<p>Prepara una bienvenida o unas reglas con encabezado, tabla y galería. El texto clásico se conserva para cuando desactives el artículo.</p>${Object.entries(articleNames).map(([key,name])=>`<div class="card"><strong>${esc(name)}</strong><p>${articles[key]?'Artículo activo':'Texto clásico'}</p>${button('Editar artículo','advanced-article-edit',`data-kind="${key}"`)}</div>`).join('')}${button('Volver','advanced-home')}`);
  });
  G.registerAction('advanced-article-edit',t=>{
    const kind=t.dataset.kind;if(!current()||!gate('richArticles')||!articleNames[kind])return;
    const article=session.data.settings.richArticles[kind];
    sheet(articleNames[kind],`<form data-form="advanced-article-preview" data-kind="${kind}">${field('Texto del artículo',`<textarea class="input" name="content" rows="6" maxlength="4000" required>${esc(article?.content||'')}</textarea>`)}${G.articleEditor.fields(article?.extras)}<div class="sheet-actions"><button class="btn btn-primary" type="submit">Ver vista previa</button>${button('Volver','advanced-articles')}</div></form>${article?button('Volver al texto clásico','advanced-article-disable',`data-kind="${kind}"`):''}`);
  });
  G.registerForm('advanced-article-preview',f=>{
    if(!current())return;
    const d=new FormData(f),kind=f.dataset.kind,article={content:String(d.get('content')),extras:G.articleEditor.read(d)};
    session.pendingArticle={kind,article};
    sheet('Vista previa · '+articleNames[kind],G.articleEditor.preview(article.content,article.extras)+
      `<form data-form="advanced-article-save"><div class="sheet-actions"><button class="btn btn-primary" type="submit">Activar artículo</button>${button('Cancelar','advanced-articles')}</div></form>`);
  });
  async function saveArticle(kind,article){
    if(!current())return;
    const original=session,version=G.state.sheetVersion,settings=structuredClone(original.data.settings);
    settings.richArticles[kind]=article;
    await G.api.patch('/api/advanced',{chatId:original.chatId,settings,version:original.data.version});
    if(session===original&&G.state.sheetVersion===version)await finish();
  }
  G.registerForm('advanced-article-save',async()=>{
    const pending=session?.pendingArticle;if(pending)await saveArticle(pending.kind,pending.article);
  });
  G.registerAction('advanced-article-disable',t=>{
    const kind=t.dataset.kind,chatId=session?.chatId;
    if(!current()||!articleNames[kind])return;
    G.openConfirm({title:'Volver al texto clásico',text:'Se quitará el artículo de esta sección.',confirmText:'Desactivar artículo',onConfirm:async()=>{
      if(session?.chatId===chatId)await saveArticle(kind,null);
    }});
  });
  function inviteList(invites){
    sheet('Invitaciones temporales',`<p>Enlaces privados creados para este grupo. El cupo limita cuántos miembros que ingresaron por un mismo enlace pueden permanecer a la vez.</p>${allowed('temporaryInvites')?button('Crear enlace','advanced-invite-new'):''}${invites.map(invite=>`<div class="card"><strong>${esc(invite.name)}</strong><p>${esc(G.fmtDateTime(invite.expires_at))} · Cupo ${esc(invite.member_limit)}</p><div class="adv-tools">${button('Copiar enlace','advanced-invite-copy',`data-link="${esc(invite.invite_link)}"`)}${button('Revocar','advanced-invite-revoke',`data-id="${esc(invite.id)}"`)}</div></div>`).join('')||'<p>No hay enlaces activos.</p>'}${button('Volver','advanced-home')}`);
  }
  G.registerAction('advanced-invites',async()=>{
    if(!current())return;
    inviteList((await actionPost('invites',{action:'list'})).invites);
  });
  G.registerAction('advanced-invite-new',()=>{
    if(!current()||!gate('temporaryInvites'))return;
    sheet('Crear invitación',form('invite-new',
      field('Nombre',input('name','text','','required maxlength="32"'))+
      field('Duración en horas',input('hours','number',24,'min="1" max="168" required'))+
      field('Cupo',input('memberLimit','number',10,'min="1" max="99999" required')))+button('Volver','advanced-invites'));
  });
  G.registerForm('advanced-invite-new',async f=>{
    const d=new FormData(f),operationId=f.dataset.operationId||(f.dataset.operationId=crypto.randomUUID());
    const result=await actionPost('invites',{action:'create',name:d.get('name'),hours:Number(d.get('hours')),memberLimit:Number(d.get('memberLimit')),operationId});
    inviteList(result.invites);
  });
  G.registerAction('advanced-invite-copy',async t=>{
    await navigator.clipboard.writeText(t.dataset.link);G.toast('Enlace copiado.','success');
  });
  G.registerAction('advanced-invite-revoke',t=>{
    const inviteId=t.dataset.id,chatId=session?.chatId;if(!current())return;
    G.openConfirm({title:'Revocar invitación',text:'Telegram desactivará el enlace.',confirmText:'Revocar',onConfirm:async()=>{
      if(!current()||session.chatId!==chatId)return;
      inviteList((await actionPost('invites',{action:'revoke',inviteId})).invites);
    }});
  });
  G.registerAction('advanced-bulk',()=>{
    if(!current()||!gate('bulkModeration'))return;
    sheet('Moderación por lotes',`<p>Silencia o banea temporalmente entre 2 y 10 miembros. El panel revisa cada cuenta antes de aplicar la acción.</p><form data-form="advanced-bulk-preview">${field('Acción',select('action',['mute','ban'],'mute'))}${field('IDs separados por espacios o saltos de línea','<textarea class="input" name="ids" rows="4" maxlength="190" required></textarea>')}${field('Duración en minutos',input('minutes','number',60,'min="1" max="43200" required'))}${field('Motivo',input('reason','text','','minlength="3" maxlength="300" required'))}<div class="sheet-actions"><button class="btn btn-primary" type="submit">Revisar miembros</button>${button('Volver','advanced-home')}</div></form>`);
  });
  const bulkItems=items=>items.map(item=>`<div class="card"><strong>${esc(item.name)} · ${esc(item.userId)}</strong><p>${esc(item.state==='applied'?'Aplicado':item.detail||(item.allowed?'Elegible':'Omitido'))}</p></div>`).join('');
  G.registerForm('advanced-bulk-preview',async f=>{
    const d=new FormData(f),input={action:d.get('action'),userIds:String(d.get('ids')).trim().split(/[\s,]+/).map(Number),minutes:Number(d.get('minutes')),reason:d.get('reason')};
    const {items,token}=await actionPost('bulk',{action:'preview',input});
    session.bulkToken=token;
    sheet('Revisar lote',`<p>${esc(labels[input.action])} · ${input.minutes} minutos · ${esc(input.reason)}</p>${bulkItems(items)}${token?`<form data-form="advanced-bulk-apply"><button class="btn btn-primary" type="submit">Aplicar a ${items.filter(i=>i.allowed).length} elegibles</button></form>`:''}${button('Volver','advanced-bulk')}`);
  });
  G.registerForm('advanced-bulk-apply',async()=>{
    const token=session?.bulkToken;if(!token||!current())return;
    const {items}=await actionPost('bulk',{action:'apply',token});
    session.bulkToken=null;
    sheet('Resultado del lote',bulkItems(items)+button('Volver','advanced-home'));
  });
  function delegateList(roles){
    const actions={delete:'Eliminar mensajes',pin:'Fijar mensajes'};
    sheet('Roles temporales',`<p>El propietario puede delegar el uso de /teamdelete y /teampin al responder a mensajes de miembros. Cada rol tiene vencimiento y queda registrado.</p>${allowed('delegatedRoles')?button('Asignar rol','advanced-delegate-new'):''}${roles.map(role=>`<div class="card"><strong>Usuario ${esc(role.user_id)}</strong><p>${esc(role.scopes.map(scope=>actions[scope]).join(' · '))} · vence ${esc(G.fmtDateTime(role.expires_at))}</p>${button('Revocar','advanced-delegate-revoke',`data-id="${esc(role.user_id)}"`)}</div>`).join('')||'<p>No hay roles temporales activos.</p>'}${button('Volver','advanced-home')}`);
  }
  G.registerAction('advanced-delegates',async()=>{
    if(!current())return;
    const original=session,version=G.state.sheetVersion;
    const {roles}=await G.api.get('/api/advanced/delegates?chat_id='+session.chatId);
    if(current()&&session===original&&G.state.sheetVersion===version)delegateList(roles);
  });
  G.registerAction('advanced-delegate-new',()=>{
    if(!current()||!gate('delegatedRoles'))return;
    sheet('Asignar rol temporal',form('delegate-new',field('ID del miembro',input('userId','number','','min="1" required'))+
      field('Duración en horas',input('hours','number',24,'min="1" max="168" required'))+
      '<fieldset><legend>Funciones</legend>'+check('scopes','Eliminar mensajes',false,'delete')+
      check('scopes','Fijar mensajes',false,'pin')+'</fieldset>')+button('Volver','advanced-delegates'));
  });
  G.registerForm('advanced-delegate-new',async f=>{
    const d=new FormData(f),scopes=d.getAll('scopes');
    if(!scopes.length)throw new Error('Selecciona al menos una función.');
    delegateList((await actionPost('delegates',{action:'grant',userId:Number(d.get('userId')),hours:Number(d.get('hours')),scopes})).roles);
  });
  G.registerAction('advanced-delegate-revoke',t=>{
    if(!current())return;const chatId=session.chatId,userId=Number(t.dataset.id);
    G.openConfirm({title:'Revocar rol temporal',text:`La cuenta ${userId} perderá sus funciones delegadas.`,confirmText:'Revocar',onConfirm:async()=>{
      if(!current()||session.chatId!==chatId)return;
      delegateList((await actionPost('delegates',{action:'revoke',userId})).roles);
    }});
  });
  G.registerAction('advanced-raid',async t=>{if(!current()||!gate('raid'))return;await actionPost('raid',{seconds:Number(t.dataset.seconds)});await finish();});
  G.registerAction('advanced-trust',()=>{
    if(!current()||!gate('trust'))return;
    sheet('Usuarios de confianza',`<p>Las excepciones son por regla y por grupo. No conceden permisos de administrador.</p>${form('trust',field('ID de Telegram',input('userId','number','','min="1" required'))+field('Motivo',input('reason','text','','maxlength="300" required'))+field('Días (0 = sin vencimiento)',input('days','number',30,'min="0" max="365" required'))+`<fieldset><legend>Reglas exceptuadas</legend>${['locks','raid','captcha','blacklist','antilink','antiflood'].map(k=>check('scopes',({locks:'Contenido',raid:'Antirraids',captcha:'Captcha',blacklist:'Lista negra',antilink:'Enlaces',antiflood:'Antiflood'})[k],false,k)).join('')}</fieldset>`)}<h4>Excepciones guardadas</h4>${session.data.trust.map(t=>`<div class="card"><strong>${esc(t.user_id)}</strong><p>${esc(t.reason)} · ${esc(t.scopes.join(', '))}</p><small>${t.expires_at?'Vence '+esc(G.fmtDateTime(t.expires_at)):'Sin vencimiento'}</small>${button('Quitar','advanced-remove',`data-kind="trust" data-key="${t.user_id}"`)}</div>`).join('')||'<p>No hay excepciones.</p>'}`);
  });
  G.registerForm('advanced-trust',async f=>{const d=new FormData(f);await actionPost('trust',{userId:Number(d.get('userId')),reason:String(d.get('reason')),days:Number(d.get('days')),scopes:d.getAll('scopes')});await finish();});
  G.registerAction('advanced-content',()=>{
    if(!current())return;
    sheet('Contenido avanzado',`<h3>Respuestas por frases · Pro</h3><p>Para responder automáticamente, activa también Respuestas por frases en el Centro Premium.</p>${allowed('filters')?form('response',field('Disparador',input('trigger','text','','maxlength="100" required'))+field('Coincidencia',select('mode',['word','exact','prefix'],'exact'))+field('Respuesta','<textarea class="input" name="content" maxlength="2000" required></textarea>')+field('Texto del botón (opcional)',input('buttonLabel'))+field('Enlace del botón',input('buttonUrl','url'))+field('Intervalo mínimo (segundos)',input('cooldownSeconds','number',60,'min="10" max="86400" required'))):'<p>Requiere Pro.</p>'}${session.data.responses.map(r=>`<div class="card"><strong>${esc(r.trigger)}</strong><p>${esc(r.content)}</p>${button('Eliminar','advanced-remove',`data-kind="response" data-key="${r.id}"`)}</div>`).join('')}<h3>Notas enriquecidas · Pro</h3><p>Multimedia: responde al medio en Telegram con /saverich nombre. Aquí puedes editar el texto y la entrega.</p>${allowed('richNotes')?form('note',field('Nombre',input('name','text','','pattern="[a-z0-9_]{1,32}" required'))+field('Texto','<textarea class="input" name="content" maxlength="1024"></textarea>')+check('privateDelivery','Entregar por enlace privado',false)+field('Texto del botón',input('buttonLabel'))+field('Enlace del botón',input('buttonUrl','url'))):'<p>Requiere Pro.</p>'}${session.data.notes.map(n=>`<div class="card"><strong>#${esc(n.name)}</strong><p>${esc(n.content)}</p><small>${esc(n.media_type||'Texto')} · ${n.private_delivery?'Privada':'En el grupo'}</small>${button('Editar','advanced-note-edit',`data-name="${esc(n.name)}"`)}${button('Eliminar','advanced-remove',`data-kind="note" data-key="${esc(n.name)}"`)}</div>`).join('')}`);
  });
  G.registerForm('advanced-response',async f=>{const d=Object.fromEntries(new FormData(f));d.cooldownSeconds=Number(d.cooldownSeconds);await actionPost('response',d);await finish();});
  G.registerForm('advanced-note',async f=>{const d=Object.fromEntries(new FormData(f));d.privateDelivery=new FormData(f).has('privateDelivery');await actionPost('note',d);await finish();});
  G.registerAction('advanced-note-edit',t=>{
    const n=session.data.notes.find(n=>n.name===t.dataset.name);if(!n)return;
    sheet('Editar #'+n.name,form('note',field('Nombre',input('name','text',n.name,'readonly'))+field('Texto',`<textarea class="input" name="content" maxlength="1024">${esc(n.content)}</textarea>`)+check('privateDelivery','Entrega privada',n.private_delivery)+field('Texto del botón',input('buttonLabel','text',n.buttons[0]?.label||''))+field('Enlace del botón',input('buttonUrl','url',n.buttons[0]?.url||''))));
  });
  G.registerAction('advanced-remove',t=>{
    const {kind,key}=t.dataset;if(!current())return;const chatId=session.chatId;
    G.openConfirm({title:'Quitar configuración',text:'Se quitará esta entrada de este grupo.',confirmText:'Quitar',onConfirm:async()=>{if(G.state.chat?.id!==chatId)return;await actionPost('remove',{kind,key});await finish();}});
  });
  G.registerAction('advanced-topics',()=>{
    if(!current()||!gate('topics'))return;
    sheet('Gestionar temas',form('topic',field('Acción',select('action',['create','rename','close','reopen'],'create'))+field('ID del tema (para modificar)',input('threadId','number','','min="1"'))+field('Nombre (para crear o renombrar)',input('name','text','','maxlength="128"')))+'<p>Solo para supergrupos con temas. Requiere permiso para gestionar temas.</p>');
  });
  G.registerForm('advanced-topic',async f=>{const d=Object.fromEntries(new FormData(f));if(d.threadId)d.threadId=Number(d.threadId);else delete d.threadId;if(!d.name)delete d.name;d.operationId=f.dataset.operationId||(f.dataset.operationId=crypto.randomUUID());const result=await actionPost('topic',d);await finish(result.topic?'Tema creado. ID: '+result.topic.message_thread_id:'Tema actualizado.');});
  G.registerAction('advanced-simulate',()=>{
    if(!current()||!gate('observation'))return;
    sheet('Simular reglas',form('simulate',field('Mensaje de ejemplo','<textarea class="input" name="text" maxlength="4000"></textarea>')+field('Tipo de contenido',select('type',['text',...Object.keys(types)],'text'))+field('Origen (para reenvíos)',select('origin',Object.keys(origins),'person'))+field('Mensajes dentro de la ventana de antiflood',input('messageCount','number',1,'min="1" max="100" required')))+'<div id="advanced-simulation" aria-live="polite"></div>');
  });
  G.registerForm('advanced-simulate',async f=>{const version=G.state.sheetVersion,d=Object.fromEntries(new FormData(f));d.messageCount=Number(d.messageCount);const result=await actionPost('simulate',d);if(!current()||G.state.sheetVersion!==version)return;document.getElementById('advanced-simulation').innerHTML=`<div class="card"><strong>${result.selected?'Se aplicaría: '+esc(result.selected.rule)+' → '+esc(result.selected.action):'Sin coincidencias'}</strong><p>${esc(result.notice)}</p></div>`;});
  function differences(diff){return diff.length?diff.map(d=>`<div class="card"><strong>${esc(definitions[d.key]?.title||d.key)}</strong><div class="adv-diff"><div><small>Antes</small><pre>${esc(JSON.stringify(d.before,null,2))}</pre></div><div><small>Después</small><pre>${esc(JSON.stringify(d.after,null,2))}</pre></div></div></div>`).join(''):'<p>No hay cambios.</p>';}
  G.registerAction('advanced-transfer',()=>{
    if(!current()||!gate('transfer'))return;
    sheet('Importar e historial',`<p>El paquete incluye las reglas avanzadas. No copia pagos, miembros ni destinos privados. Conserva la exportación completa de datos en Premium.</p>${button('Descargar ajustes reutilizables','advanced-export')}<form data-form="advanced-import">${field('Archivo de ajustes',input('file','file','','accept="application/json,.json" required'))}<fieldset><legend>Secciones que quieres importar</legend>${Object.entries(definitions).filter(([k])=>!['topics','silent','observation'].includes(k)).map(([k,d])=>check('sections',d.title,true,k)).join('')}</fieldset><button type="submit" class="btn btn-primary">Revisar cambios</button></form><h4>Historial de reglas avanzadas</h4>${session.data.history.map(h=>`<p>Versión ${h.version} · ${esc(G.fmtDateTime(h.created_at))} ${button('Revisar','advanced-restore',`data-version="${h.version}"`)}</p>`).join('')||'<p>Sin cambios anteriores.</p>'}`);
  });
  G.registerAction('advanced-export',async()=>{const file=await G.api.get('/api/advanced/export?chat_id='+session.chatId);const url=URL.createObjectURL(new Blob([JSON.stringify(file,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='gbot-ajustes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  G.registerForm('advanced-import',async f=>{
    const chatId=session.chatId,version=G.state.sheetVersion,d=new FormData(f),file=d.get('file');if(!(file instanceof File)||file.size>500000)throw new Error('Usa un archivo JSON de hasta 500 KB.');
    const parsed=JSON.parse(await file.text());if(!current()||G.state.sheetVersion!==version||session.chatId!==chatId)return;
    pendingTransfer={mode:'apply',file:parsed,sections:d.getAll('sections')};const result=await actionPost('transfer',{...pendingTransfer,mode:'preview'});if(!current()||G.state.sheetVersion!==version)return;pendingTransfer.version=result.version;
    sheet('Revisar importación',differences(result.diff)+button('Aplicar cambios revisados','advanced-transfer-apply'));
  });
  G.registerAction('advanced-restore',async t=>{const version=G.state.sheetVersion;pendingTransfer={mode:'restore',targetVersion:Number(t.dataset.version)};const result=await actionPost('transfer',{...pendingTransfer,mode:'restore-preview'});if(!current()||G.state.sheetVersion!==version)return;pendingTransfer.version=result.version;sheet('Revisar restauración',differences(result.diff)+button('Restaurar esta versión','advanced-transfer-apply'));});
  G.registerAction('advanced-transfer-apply',async()=>{if(!current()||!pendingTransfer)return;await actionPost('transfer',pendingTransfer);pendingTransfer=null;await finish();});
  G.registerAction('advanced-alliance',()=>{
    if(!current())return;const a=session.data.alliance;
    if(a?.inactive){sheet(a.name,`<p>Este grupo mantiene un vínculo con la Alianza. Sus funciones requieren Ultra. Puedes salir del vínculo en cualquier momento.</p>${button('Salir de la Alianza','advanced-alliance-action','data-kind="leave"')}`);return;}
    if(!gate('alliances'))return;
    if(!a){sheet('Alianzas GBot',`<div class="adv-intro"><h3>Tu comunidad, conectada.</h3><p>Comparte casos y perfiles. Cada grupo decide qué adopta.</p></div>${form('alliance-create',field('Nombre de la Alianza',input('name','text','','minlength="3" maxlength="80" required')))}<h4>Unirse con invitación</h4>${form('alliance-join',field('Código de invitación',input('code','text','','pattern="[a-f0-9]{36}" required')))}<p>La vinculación debe autorizarla el creador del grupo.</p>`);return;}
    sheet(a.name,`<p>${a.groups.length} grupos vinculados. Las sanciones compartidas requieren revisión local.</p>${a.inviteCode?`<div class="card"><strong>Invitación privada</strong><p class="mono">${esc(a.inviteCode)}</p>${button('Renovar invitación','advanced-alliance-action','data-kind="rotate"')}${button('Publicar perfil de este grupo','advanced-alliance-action','data-kind="publish"')}</div>`:''}${button('Comparar perfil compartido','advanced-alliance-action','data-kind="preview"')}<h4>Proponer un caso</h4>${form('alliance-case',field('ID del usuario',input('userId','number','','min="1" required'))+field('Motivo',input('reason','text','','minlength="5" maxlength="500" required'))+field('Duración propuesta (segundos)',input('seconds','number',86400,'min="60" max="2592000" required')))}<h4>Casos compartidos</h4>${a.cases.map(c=>`<div class="card"><strong>Usuario ${esc(c.user_id)}</strong><p>${esc(c.reason)}</p><small>${esc(c.decision||'Por revisar')} · ${esc(G.fmtDateTime(c.created_at))}</small><div class="adv-tools">${['apply','skip','undo'].map(k=>button(labels[k],'advanced-alliance-review',`data-case="${c.id}" data-decision="${k}"`)).join('')}</div></div>`).join('')||'<p>No hay casos.</p>'}<h4>Grupos vinculados</h4>${a.groups.map(g=>`<p>${esc(g.title)} · Perfil ${g.profile_version}</p>`).join('')}${button('Salir de la Alianza','advanced-alliance-action','data-kind="leave"')}`);
  });
  for(const [kind,action]of [['create','create'],['join','join'],['case','propose']])G.registerForm('advanced-alliance-'+kind,async f=>{const d=Object.fromEntries(new FormData(f));if(d.userId)d.userId=Number(d.userId);if(d.seconds)d.seconds=Number(d.seconds);await actionPost('alliance',{action,...d});await finish();});
  G.registerAction('advanced-alliance-action',async t=>{
    const action=t.dataset.kind;if(!current())return;
    if(action==='preview'){const version=G.state.sheetVersion;const result=await actionPost('alliance',{action});if(!current()||G.state.sheetVersion!==version)return;pendingTransfer={alliance:true,version:result.version,profileVersion:result.profileVersion};sheet('Comparar perfil de Alianza',differences(result.diff)+button('Adoptar perfil revisado','advanced-alliance-adopt'));return;}
    G.openConfirm({title:'Confirmar cambio en la Alianza',text:action==='leave'?'Salir no revierte las sanciones ya adoptadas.':'Se actualizará la invitación o el perfil compartido.',confirmText:'Continuar',onConfirm:async()=>{await actionPost('alliance',{action});await finish();}});
  });
  G.registerAction('advanced-alliance-adopt',async()=>{if(!current()||!pendingTransfer?.alliance)return;await actionPost('alliance',{action:'adopt',version:pendingTransfer.version,profileVersion:pendingTransfer.profileVersion});pendingTransfer=null;await finish();});
  G.registerAction('advanced-alliance-review',t=>{
    const caseId=Number(t.dataset.case),decision=t.dataset.decision;if(!current())return;
    G.openConfirm({title:labels[decision],text:'La decisión afecta únicamente a este grupo. El registro conservará el caso y su autor.',confirmText:'Confirmar',onConfirm:async()=>{await actionPost('alliance',{action:'review',caseId,decision});await finish();}});
  });
  const render=G.renderSettings;
  const renderPremium=G.renderPremium;
  G.renderPremium=function(){
    renderPremium();const main=document.getElementById('main'),b=G.state.bootstrap,p=G.state.premium;
    if(!main||!b)return;
    if(b.access?.owner){main.querySelector('.plan-grid')?.closest('section')?.remove();main.querySelector('form[data-form="redeem"]')?.closest('.card')?.remove();return;}
    const catalog=p?.tiers||[];
    main.insertAdjacentHTML('afterbegin',`<section class="section"><div class="card"><h3>Tres niveles, dos modalidades</h3><p><strong>Premium:</strong> 50 ⭐ / 30 días por grupo (también 90 o 365 días).<br><strong>Pro:</strong> 135 ⭐, pago único para diez grupos.<br><strong>Ultra:</strong> 135 ⭐ / 30 días por grupo.</p>${catalog.map(t=>`<p><strong>${esc(t.label)}</strong>: ${esc(t.description)}</p>`).join('')}</div></section>`);
    const licenses=p?.licenses;if(!licenses)return;
    main.insertAdjacentHTML('afterbegin',`<section class="section"><div class="card"><h3>Mis cupos Pro</h3><p>${licenses.used} de ${licenses.slots} cupos ocupados. La licencia es permanente; cada grupo debe seguir siendo administrado por su propietario.</p>${licenses.slots?`<form data-form="advanced-license"><label class="field"><span class="field-label">Grupo de destino</span><select name="chatId" class="input">${G.state.chats.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><button class="btn btn-primary" type="submit">Asignar cupo Pro</button></form>`:''}${licenses.groups.map(c=>`<p>${esc(c.title)} ${button('Liberar cupo','advanced-license-release',`data-chat-id="${c.chat_id}"`)}</p>`).join('')}</div></section>`);
  };
  G.registerForm('advanced-license',async f=>{const id=Number(new FormData(f).get('chatId'));await G.api.post('/api/premium/license',{chatId:id,action:'assign'});G.toast('Cupo Pro asignado.','success');await G.loadPremium();});
  G.registerAction('advanced-license-release',t=>{const id=Number(t.dataset.chatId);G.openConfirm({title:'Liberar cupo Pro',text:'El grupo deja de usar esta licencia. Sus ajustes se conservan y sus funciones se adaptan a su nivel disponible.',confirmText:'Liberar',onConfirm:async()=>{await G.api.post('/api/premium/license',{chatId:id,action:'release'});G.closeSheet();await G.loadPremium();}});});
  G.renderSettings=function(){render();const main=document.getElementById('main');if(!main||!G.state.bootstrap)return;main.insertAdjacentHTML('afterbegin',`<section class="section"><div class="card adv-promo"><span class="badge">NUEVO · PREMIUM</span><h3>Un centro para toda tu protección.</h3><p>Antirraids, contenido, horarios y Alianzas GBot, con controles por nivel.</p>${button('Abrir Centro Premium','advanced-open')}</div></section>`);};
  function demoData(){
    const settings={raid:{enabled:false,threshold:15,windowSeconds:60,durationSeconds:900,action:'captcha',sanctionSeconds:600},locks:{enabled:false,types:[],action:'delete',durationSeconds:600},warningExpiry:{days:30},night:{enabled:false,timezone:'America/Santiago',start:'23:00',end:'07:00',days:[0,1,2,3,4,5,6]},filters:{enabled:false},topics:{welcomeThreadId:0,logThreadId:0},silent:{enabled:false},joinGate:{enabled:false,mode:'math'},richNotes:{enabled:false},observation:{enabled:false}};
    Object.assign(settings,{probation:{enabled:false,minutes:120},forwarding:{actions:{},durationSeconds:600},textLimits:{patterns:'',maxLength:0,action:'delete',durationSeconds:600},richArticles:{welcome:null,rules:null},discussion:{enabled:false,text:''}});
    const tiers={raid:'premium',locks:'premium',trust:'premium',warningExpiry:'premium',night:'pro',filters:'pro',topics:'pro',silent:'pro',joinGate:'pro',richNotes:'pro',transfer:'pro',alliances:'ultra',observation:'ultra',probation:'premium',forwarding:'premium',textLimits:'premium',richArticles:'pro',discussion:'pro',reactions:'pro',temporaryInvites:'pro',bulkModeration:'pro',delegatedRoles:'ultra'};
    return {tier:'ultra',version:0,settings,features:Object.entries(tiers).map(([key,tier])=>({key,tier,allowed:true})),tiers:[{label:'Premium',description:'Protección avanzada · 50 ⭐ / 30 días',available:true},{label:'Pro',description:'135 ⭐ una vez · 10 grupos',available:true},{label:'Ultra',description:'135 ⭐ / 30 días por grupo',available:true}],cas:{enabled:true,status:'ok'},developer:false,trust:[],responses:[],notes:[],history:[],operations:[],raid:null,alliance:null};
  }
  if(G.DEMO){
    const records=new Map(),globalRecords={bans:[],exceptions:[]},originalDemo=G.demoRequest;
    G.demoRequest=async(path,options={})=>{
      const url=new URL(path,location.origin),body=options.body?JSON.parse(options.body):{},chatId=Number(url.searchParams.get('chat_id')||body.chatId||G.state.chat?.id),method=options.method||'GET';
      if(!url.pathname.startsWith('/api/advanced')&&!['/api/globalban','/api/globalban/check','/api/premium/license'].includes(url.pathname))return originalDemo(path,options);
      await G.delay(100);
      if(url.pathname==='/api/globalban/check')return {ok:true,verdict:{banned:false},cas:{enabled:true,status:'ok'},demo:true};
      if(url.pathname==='/api/globalban'){
        if(method==='GET')return structuredClone({ok:true,bans:globalRecords.bans,exceptions:globalRecords.exceptions,cas:{enabled:true,status:'ok'},demo:true});
        const userId=Number(body.userId),reason=body.reason||'';
        if(body.action==='ban')globalRecords.bans=[...globalRecords.bans.filter(b=>b.user_id!==userId),{user_id:userId,reason}];
        if(body.action==='unban')globalRecords.bans=globalRecords.bans.filter(b=>b.user_id!==userId);
        if(body.action==='cas-allow')globalRecords.exceptions=[...globalRecords.exceptions.filter(b=>b.user_id!==userId),{user_id:userId,reason}];
        if(body.action==='cas-remove')globalRecords.exceptions=globalRecords.exceptions.filter(b=>b.user_id!==userId);
        return {ok:true,demo:true};
      }
      if(url.pathname==='/api/premium/license')return originalDemo(path,options);
      if(!records.has(chatId))records.set(chatId,demoData());const d=records.get(chatId),route=url.pathname.replace('/api/advanced','');
      if(route===''&&method==='GET')return structuredClone({ok:true,...d});
      if(route===''&&method==='PATCH'){if(body.version!==d.version)throw new Error('Recarga la configuración de ejemplo.');d.settings=structuredClone(body.settings);d.version++;d.history.unshift({version:d.version,actor_id:123,created_at:new Date().toISOString(),settings:structuredClone(d.settings)});return {ok:true,...structuredClone(d)};}
      if(route==='/reactions')return {ok:true,demo:true};
      if(route==='/join-guard')return {ok:true,supported:true,assigned:false,canInvite:true,demo:true};
      if(route==='/invites')return {ok:true,invites:[],demo:true};
      if(route==='/delegates')return {ok:true,roles:[],demo:true};
      if(route==='/bulk')return body.action==='preview'?{ok:true,items:body.input.userIds.map(userId=>({userId,name:'Ejemplo',allowed:true})),token:'demo'}:{ok:true,items:[],demo:true};
      if(route==='/trust'){d.trust=d.trust.filter(t=>t.user_id!==body.userId);d.trust.push({user_id:body.userId,scopes:body.scopes,reason:body.reason,expires_at:body.days?new Date(Date.now()+body.days*86400000).toISOString():null});}
      else if(route==='/response'){const existing=d.responses.find(r=>r.trigger===body.trigger),r={id:existing?.id||Date.now(),...body,button_label:body.buttonLabel,button_url:body.buttonUrl,cooldown_seconds:body.cooldownSeconds};d.responses=d.responses.filter(r=>r.trigger!==body.trigger);d.responses.push(r);}
      else if(route==='/note'){d.notes=d.notes.filter(n=>n.name!==body.name);d.notes.push({name:body.name,content:body.content,private_delivery:body.privateDelivery,media_type:null,buttons:body.buttonUrl?[{label:body.buttonLabel,url:body.buttonUrl}]:[]});}
      else if(route==='/remove'){if(body.kind==='trust')d.trust=d.trust.filter(t=>String(t.user_id)!==String(body.key));if(body.kind==='response')d.responses=d.responses.filter(r=>String(r.id)!==String(body.key));if(body.kind==='note')d.notes=d.notes.filter(n=>n.name!==body.key);}
      else if(route==='/raid')d.raid=body.seconds?{until_at:new Date(Date.now()+body.seconds*1000).toISOString()}:null;
      else if(route==='/export')return {format:'gbot-settings',version:1,advanced:structuredClone(d.settings)};
      else if(route==='/topic')return {ok:true,topic:body.action==='create'?{message_thread_id:7}:undefined,demo:true};
      else if(route==='/simulate'){
        const base=G.state.settings,matches=[];
        if(d.settings.locks.enabled&&d.settings.locks.types.includes(body.type))matches.push({rule:'Contenido: '+body.type,action:d.settings.locks.action});
        if(base.antilink.enabled&&/(?:https?:\/\/|t\.me\/)/i.test(body.text))matches.push({rule:'Antienlaces',action:base.antilink.action});
        if(base.antiflood.enabled&&body.messageCount>=base.antiflood.limit)matches.push({rule:'Antiflood',action:'mute'});
        return {ok:true,matches,selected:matches[0]||null,notice:'Demostración con datos de ejemplo. No ejecuta acciones reales.'};
      }else if(route==='/transfer'){
        const restore=body.mode.startsWith('restore'),source=restore?d.history.find(h=>h.version===body.targetVersion)?.settings:body.file?.advanced;
        if(!source)throw new Error('No es un paquete de reglas de GBot válido.');const target=structuredClone(d.settings);
        for(const key of restore?Object.keys(definitions):body.sections||[])if(definitions[key]&&source[key])target[key]=structuredClone(source[key]);
        const diff=Object.keys(definitions).filter(k=>JSON.stringify(d.settings[k])!==JSON.stringify(target[k])).map(key=>({key,before:d.settings[key],after:target[key]}));
        if(body.mode==='preview'||body.mode==='restore-preview')return {ok:true,diff,version:d.version,target};
        if(body.version!==d.version)throw new Error('La configuración de ejemplo cambió.');d.settings=target;d.version++;
      }else if(route==='/alliance'){
        if(['create','join'].includes(body.action))d.alliance={id:1,name:body.name||'Alianza de ejemplo',inviteCode:'demo-invitacion',groups:[{chat_id:chatId,title:G.state.chat.title,profile_version:0}],cases:[],profile:null,profileVersion:0};
        if(!d.alliance&&body.action!=='leave')throw new Error('Crea primero una Alianza de ejemplo.');const a=d.alliance;
        if(body.action==='leave')d.alliance=null;
        if(body.action==='propose')a.cases.unshift({id:Date.now(),user_id:body.userId,reason:body.reason,created_at:new Date().toISOString(),decision:null});
        if(body.action==='review'){const c=a.cases.find(c=>c.id===body.caseId);if(c)c.decision=body.decision;}
        if(body.action==='publish'){a.profile=structuredClone(d.settings);a.profileVersion++;}
        if(body.action==='preview'){if(!a.profile)throw new Error('Publica un perfil de ejemplo.');return {ok:true,diff:[],version:d.version,profileVersion:a.profileVersion};}
        if(body.action==='rotate')a.inviteCode='demo-invitacion-renovada';
      }
      return {ok:true,demo:true};
    };
  }
})();
