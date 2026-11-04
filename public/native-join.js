(() => {
  'use strict';
  const webApp = window.Telegram?.WebApp;
  const language = webApp?.initDataUnsafe?.user?.language_code || navigator.language || 'en';
  const es = /^es(?:-|_|$)/i.test(language);
  const t = es ? {
    title: 'Verificación de ingreso',
    pending: 'Completa la verificación para continuar al grupo.',
    verify: 'Verificar', review: 'Pedir revisión manual', close: 'Cerrar', retry: 'Volver a comprobar',
    approved: 'Verificación completada. Ya puedes ingresar al grupo.',
    declined: 'Telegram rechazó la solicitud de ingreso.',
    expired: 'La verificación venció. Puedes dejar la solicitud para revisión.',
    failed: 'Se agotaron los intentos. Un administrador puede revisar tu solicitud.',
    manual_review: 'La solicitud necesita revisión de un administrador. Comprueba su estado en Telegram.',
    delivery_failed: 'Telegram no pudo abrir el portal. Comprueba tu solicitud en Telegram.',
    approving: 'Telegram está procesando la solicitud. Puedes volver a comprobar su estado.',
    native_uncertain: 'El resultado todavía no está confirmado. Comprueba el estado de tu solicitud en Telegram.',
    unauthorized: 'Abre esta página desde tu solicitud de ingreso en Telegram.',
    error: 'No pudimos comprobar el estado. Inténtalo de nuevo.',
    wrong: n => `Respuesta incorrecta. Intentos restantes: ${n}.`,
  } : {
    title: 'Join verification',
    pending: 'Complete verification to continue to the group.',
    verify: 'Verify', review: 'Ask for manual review', close: 'Close', retry: 'Check again',
    approved: 'Verification complete. You can now join the group.',
    declined: 'Telegram declined the join request.',
    expired: 'Verification expired. You can leave the request for review.',
    failed: 'No attempts left. An administrator can review your request.',
    manual_review: 'An administrator needs to review your request. Check its status in Telegram.',
    delivery_failed: 'Telegram could not open the portal. Check your request in Telegram.',
    approving: 'Telegram is processing your request. You can check its status again.',
    native_uncertain: 'The result is still unconfirmed. Check the status of your request in Telegram.',
    unauthorized: 'Open this page from your join request in Telegram.',
    error: 'We could not check the status. Try again.',
    wrong: n => `Incorrect answer. Attempts left: ${n}.`,
  };
  const byId = id => document.getElementById(id);
  const form = byId('challenge'), label = byId('prompt-label'), answer = byId('answer');
  const status = byId('status'), verify = byId('verify'), review = byId('review'), close = byId('close');
  document.documentElement.lang = es ? 'es' : 'en';
  document.title = 'GBot · ' + t.title;
  byId('title').textContent = t.title;
  verify.textContent = t.verify;
  review.textContent = t.review;
  let retry = false;
  webApp?.ready();

  function render(data) {
    const { state } = data;
    if (state === 'wrong') {
      status.textContent = t.wrong(data.attemptsLeft);
      answer.value = '';
      answer.focus();
      return;
    }
    retry = state === 'error' || state === 'approving';
    status.textContent = t[state] || t.manual_review;
    form.hidden = state !== 'pending' && state !== 'expired';
    verify.hidden = state === 'expired';
    close.hidden = state === 'pending' || (state === 'unauthorized' && !webApp?.initData);
    close.textContent = retry ? t.retry : t.close;
    if (state === 'pending') {
      label.hidden = !data.prompt;
      answer.required = Boolean(data.prompt);
      byId('prompt').textContent = data.prompt ? data.prompt + ' = ?' : '';
    } else label.hidden = true;
  }

  async function request(body) {
    if (!webApp?.initData) return render({ state: 'unauthorized' });
    for (const button of [verify, review, close]) button.disabled = true;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/native-join', {
        method: body ? 'POST' : 'GET',
        headers: { 'X-Telegram-Init-Data': webApp.initData, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
      render(response.ok ? await response.json() : { state: response.status === 401 ? 'unauthorized' : 'error' });
    } catch { render({ state: 'error' }); }
    finally {
      clearTimeout(deadline);
      for (const button of [verify, review, close]) button.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    void request({ action: 'verify', answer: label.hidden ? 'ok' : answer.value });
  });
  review.addEventListener('click', () => void request({ action: 'review' }));
  close.addEventListener('click', () => { if (retry) void request(); else webApp?.close(); });
  void request();
})();
