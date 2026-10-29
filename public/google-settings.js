import {escapeHtml as e} from './formats.js';

export async function renderGoogleSettings(container, request) {
  try {
    const settings = await request('google-settings');
    if (!container.isConnected) return;
    const callback = new URL('api.php?r=oauth-callback', location.href).href;
    container.innerHTML = `<h2>Google integration</h2>
      <p>Configure once for this Office installation. Then add each Gmail account using Connect with Google.</p>
      <details ${settings.configured ? '' : 'open'}><summary>One-time Google Cloud setup</summary>
        <ol><li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> and create or select your project.</li>
        <li>Enable Gmail API, and Calendar API if you want calendars.</li>
        <li>Configure Google Auth platform branding and audience. For personal Gmail choose External; while in Testing, add your Google accounts as test users.</li>
        <li>Add <code>https://www.googleapis.com/auth/gmail.modify</code> and, if needed, <code>https://www.googleapis.com/auth/calendar.readonly</code> under Data Access.</li>
        <li>Create a <strong>Web application</strong> OAuth client. Register the exact callback shown below. You can register both your hosted callback and your fixed local callback in the same client.</li></ol>
        <p>Testing grants normally expire after seven days. Personal-use exceptions and production requirements depend on Google’s policies. <a href="https://developers.google.com/identity/protocols/oauth2/web-server" target="_blank" rel="noopener noreferrer">Google authorization guide</a>.</p>
      </details>
      <p id="google-configuration-summary">${settings.configured ? 'Configured. A blank secret keeps the saved secret for the same client ID.' : 'Not configured yet.'} Existing accounts keep their own connection credentials when these settings change.</p>
      <form id="google-integration-form">
        <label>Google OAuth client ID<input name="client_id" required value="${e(settings.client_id)}" autocomplete="off"></label>
        <label>Google OAuth client secret<input name="client_secret" type="password" ${settings.configured ? '' : 'required'} autocomplete="new-password"></label>
        <label>Google callback URL<input name="redirect" type="url" required value="${e(settings.redirect || callback)}" spellcheck="false"></label>
        <p>This location’s callback: <code>${e(callback)}</code>. Use a fixed local hostname and port; localhost and 127.0.0.1 are different callbacks.</p>
        <button type="button" id="copy-google-callback">Copy this location’s callback</button>
        <button class="primary">Save Google integration</button>
        <p role="status" id="google-settings-status"></p>
      </form><p id="google-connection-result" role="${settings.notice?.error ? 'alert' : 'status'}" class="${settings.notice?.error ? 'error' : ''}">${e(settings.notice?.message || '')}</p>`;
    const form = container.querySelector('form');
    const status = container.querySelector('#google-settings-status');
    container.querySelector('#copy-google-callback').onclick = async () => {
      try { await navigator.clipboard.writeText(callback); status.textContent = 'Callback copied.'; }
      catch { const input = form.elements.redirect; input.value = callback; input.focus(); input.select(); status.textContent = 'Press Ctrl+C or Cmd+C to copy the selected callback.'; }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const submit = form.querySelector('button.primary'); submit.disabled = true;
      status.textContent = 'Saving…';
      try {
        await request('google-settings', Object.fromEntries(new FormData(form)));
        form.elements.client_secret.value = '';
        form.elements.client_secret.required = false;
        container.querySelector('details').open = false;
        container.querySelector('#google-configuration-summary').textContent = 'Configured. A blank secret keeps the saved secret for the same client ID. Existing accounts keep their own connection credentials when these settings change.';
        status.textContent = 'Google integration saved. You can now add a Gmail account.';
      } catch (error) { status.textContent = error.message; }
      finally { submit.disabled = false; }
    };
  } catch (error) { if (container.isConnected) container.textContent = error.message; }
}
