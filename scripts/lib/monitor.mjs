export const TASK_INTERVALS = {
  'captcha-expiry':55,'advanced-schedules':55,publications:55,'visual-moderation':55,
  'pro-licenses':21600,'premium-reminders':21600,cleanup:43200,
};
export const CHECK_LABELS = {http:'Mini App',database:'Base de datos',webhook:'Conexión con Telegram',scheduler:'Tareas programadas',backup:'Respaldo automático'};

export function schedulerCheck(rows, now=Date.now()) {
  const due=Object.entries(TASK_INTERVALS).filter(([name,seconds])=>{
    const row=rows.find(r=>r.name===name);
    return !row || row.failed_at || now-Date.parse(row.completed_at)>seconds*1000+12*60_000;
  }).map(([name])=>name);
  return {status:due.length?'error':'ok',overdue:due};
}
export function webhookCheck(info, expected, now=Date.now()) {
  if(info.url!==expected)return {status:'error',reason:'destination'};
  if(info.pending_update_count>100)return {status:'error',reason:'queue'};
  if(info.pending_update_count>0 && info.last_error_date*1000>now-15*60_000)return {status:'error',reason:'delivery'};
  return {status:'ok'};
}

export function reusableWebhookObservation(observation, now=Date.now()) {
  const age=now-Date.parse(observation?.at);
  return observation?.check?.status==='ok' && age>=0 && age<600000;
}

/** Two consecutive observations confirm both an incident and its recovery. */
export function advanceMonitor(previous, checks, now=Date.now()) {
  const failing=Object.entries(checks).filter(([,c])=>c.status!=='ok').map(([name])=>name);
  const bad=failing.length>0;
  const state={...previous,checkedAt:new Date(now).toISOString(),checks,
    incidentStatus:previous?.incidentStatus||'healthy',notifiedStatus:previous?.notifiedStatus||'healthy',
    failures:bad?(previous?.failures||0)+1:0,successes:bad?0:(previous?.successes||0)+1,
    incidents:previous?.incidents||[],failing};
  if((bad && state.failures>=2 && state.incidentStatus!=='degraded') ||
    (!bad && state.successes>=2 && state.incidentStatus==='degraded')) {
    state.incidentStatus=bad?'degraded':'healthy';
    state.incidents=[{at:state.checkedAt,state:state.incidentStatus,checks:failing},...state.incidents].slice(0,30);
  }
  return state;
}
export function alertText(state) {
  return state.incidentStatus==='healthy'
    ? '✅ GBot se recuperó. Mini App, base de datos, Telegram, tareas y respaldos responden correctamente.'
    : '⚠️ GBot requiere revisión: '+state.failing.map(n=>CHECK_LABELS[n]||'Servicio').join(', ')+'. Se confirmó en dos revisiones consecutivas. Consulta Estado del servicio en el panel.';
}
