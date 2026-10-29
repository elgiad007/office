import {escapeHtml as escape} from './formats.js';

const providers = {
  imap: 'IMAP + SMTP',
  google: 'Gmail + Google Calendar',
  caldav: 'CalDAV calendar',
};

/** The entire draft lives in this dialog closure, never browser storage. */
export function openAccountSetup({dialog, request, onSaved}) {
  const callback = new URL('api.php?r=oauth-callback', location.href).href;
  const drafts = {
    imap: {label:'', email:'', host:'', smtp:'', username:'', password:'', archiveFolder:'Archive'},
    google: {label:'', email:'', client_id:'', client_secret:'', redirect:callback},
    caldav: {label:'', url:'', username:'', password:''},
  };
  let mode = null;
  let provider = 'imap';
  let step = 0;
  let busy = false;
  let result = null;
  let savedId = null;
  let closed = false;
  let previouslyFocused = document.activeElement;
  const draft = () => drafts[provider];
  const steps = () => provider === 'google'
    ? ['Account', 'Google project', 'Credentials', 'Review']
    : ['Account', 'Connection', 'Review'];
  const payload = () => ({type:provider, ...draft()});

  function capture() {
    const form = dialog.querySelector('#account-form');
    if (form) {
      for (const [key, value] of new FormData(form)) if (key !== 'provider') draft()[key] = value;
    }
  }

  function input(label, name, {type='text', help='', required=true, readonly=false, placeholder=''} = {}) {
    return `<label for="setup-${name}">${escape(label)}</label>
      <input id="setup-${name}" name="${name}" type="${type}" value="${escape(draft()[name])}"
        ${required ? 'required' : ''} ${readonly ? 'readonly' : ''} placeholder="${escape(placeholder)}"
        ${help ? `aria-describedby="setup-${name}-help"` : ''}
        autocomplete="${type === 'password' ? 'new-password' : 'off'}" spellcheck="false">
      ${help ? `<small id="setup-${name}-help">${help}</small>` : ''}`;
  }

  function providerSelect() {
    return `<label for="setup-provider">Connection type</label><select id="setup-provider" name="provider">
      ${Object.entries(providers).map(([id, name]) => `<option value="${id}" ${provider === id ? 'selected' : ''}>${name}</option>`).join('')}
    </select>`;
  }

  function identity() {
    return providerSelect() + input('Account label', 'label', {help:'A name to recognize this account, such as Personal Gmail.'})
      + (provider !== 'caldav' ? input('Sender email', 'email', {type:'email'}) : '');
  }

  function credentials() {
    if (provider === 'google') {
      return `<p>Choose a <strong>Web application</strong> OAuth client in your Google project. Copy its values below.</p>`
        + input('OAuth client ID', 'client_id', {placeholder:'…apps.googleusercontent.com'})
        + input('OAuth client secret', 'client_secret', {type:'password', help:'This identifies your OAuth application. It is separate from your Google password.'})
        + input('Authorized redirect URI', 'redirect', {type:'url', help:'Register this exact URL in Google Auth platform → Clients → Authorized redirect URIs.'})
        + '<button type="button" data-setup="copy">Copy redirect URI</button>';
    }
    if (provider === 'imap') {
      return `<p>Find these settings in your email provider’s mail-client instructions. Office currently supports implicit TLS on ports 993 and 465.</p>`
        + input('IMAP server (TLS 993)', 'host', {placeholder:'imap.example.com', help:'Enter the hostname only, without a protocol or port.'})
        + input('SMTP server (TLS 465)', 'smtp', {placeholder:'smtp.example.com', help:'Sending currently uses the same username and password as IMAP.'})
        + input('Username', 'username', {help:'Usually your full email address. Confirm with your provider.'})
        + input('Password / app password', 'password', {type:'password', help:'Use an app password if your provider requires one.'})
        + input('Existing IMAP archive folder', 'archiveFolder', {help:'Defaults to Archive. Match the existing folder name on your server; archive requires IMAP MOVE support.'});
    }
    return `<p>Your provider supplies the full URL for an individual calendar collection. Its home page or account-discovery URL is not sufficient.</p>`
      + input('Calendar collection URL', 'url', {type:'url', placeholder:'https://calendar.example.com/calendars/user/personal/', help:'Use the final HTTPS collection URL on port 443 or 8443; redirects are not followed.'})
      + input('Username', 'username')
      + input('Password / app password', 'password', {type:'password', help:'Use an app password if your provider requires one.'});
  }

  function googleInstructions() {
    return `<p>Create credentials in a Google Cloud project that you control. Keep this wizard open while working in the console.</p>
      <ol class="setup-instructions">
        <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> and create or select a project, such as Personal Office.</li>
        <li>In <strong>APIs &amp; Services → Library</strong>, enable both
          <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer">Gmail API</a> and
          <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer">Google Calendar API</a> in that same project.</li>
        <li>In <strong>Google Auth platform</strong>, configure the app name and contact email. For personal Gmail, choose <strong>External</strong> and add your Gmail address under <strong>Audience → Test users</strong>.</li>
        <li>Under <strong>Data Access</strong>, add the two permissions below. Gmail access includes reading, sending and organizing messages; Calendar access is read-only.</li>
        <li>Under <strong>Clients → Create client</strong>, choose <strong>Web application</strong>. Register the exact redirect URI below, then create the client and copy its client ID and secret for the next step. JavaScript origins are not required for this flow.</li>
      </ol>
      <pre class="setup-code">https://www.googleapis.com/auth/gmail.modify\nhttps://www.googleapis.com/auth/calendar.readonly</pre>
      ${input('Authorized redirect URI', 'redirect', {type:'url', readonly:true})}
      <button type="button" data-setup="copy">Copy redirect URI</button>
      <p class="setup-note">While your Google app is in Testing, authorization for these permissions normally expires after seven days. Reconnect when needed. Changing the Office domain or port requires updating the registered callback.</p>
      <p><a href="https://developers.google.com/workspace/guides/configure-oauth-consent" target="_blank" rel="noopener noreferrer">Google’s consent setup guide</a> · <a href="https://developers.google.com/identity/protocols/oauth2/web-server" target="_blank" rel="noopener noreferrer">Google’s web-server authorization guide</a></p>`;
  }

  function checks() {
    if (!result) return '<p class="muted">Not checked yet. You can check now or save the account to connect later.</p>';
    const heading = result.status === 'ok' ? 'Connection checks passed'
      : result.status === 'authorization_required' ? 'Configuration checked · Google authorization still required'
      : 'Connection checks need attention';
    return `<div class="setup-checks" role="status" tabindex="-1"><strong>${heading}</strong>
      ${result.checks.map(check => `<p class="${check.status === 'error' ? 'error' : ''}"><span aria-hidden="true">${check.status === 'ok' ? '✓' : check.status === 'pending' ? '○' : '!'}</span> <strong>${escape(check.label)}</strong><br>${escape(check.message)}</p>`).join('')}
    </div>`;
  }

  function review() {
    const data = draft();
    const fields = [['Connection',providers[provider]],['Account label',data.label]];
    if (provider !== 'caldav') fields.push(['Sender email',data.email]);
    if (provider === 'google') fields.push(['OAuth client ID',data.client_id],['OAuth client secret','Entered · hidden'],['Redirect URI',data.redirect]);
    if (provider === 'imap') fields.push(['IMAP',data.host+' · TLS 993'],['SMTP',data.smtp+' · TLS 465'],['Username',data.username],['Password','Entered · hidden'],['Archive folder',data.archiveFolder]);
    if (provider === 'caldav') fields.push(['Calendar collection',data.url],['Username',data.username],['Password','Entered · hidden']);
    return `<p>Review these settings before saving. Secrets are hidden and will be encrypted on disk.</p>
      <dl class="setup-review">${fields.map(([name,value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      ${checks()}<button type="button" data-setup="test">${provider === 'google' ? 'Check settings' : 'Test connection'}</button>
      <p class="setup-note">${provider === 'google' ? 'Checking settings validates the required fields and callback format. Only Google’s authorization flow can verify your client ID, secret and permissions.' : 'Connection checks sign in and inspect access without saving the account, downloading items, or sending mail. They do not verify archive-folder or delivery behavior.'}</p>`;
  }

  function setError(message) {
    const error = dialog.querySelector('#account-error');
    if (error) { error.textContent = message; error.focus(); }
  }

  function validateVisible() {
    const form = dialog.querySelector('#account-form');
    return !form || form.reportValidity();
  }

  function changeMode(nextMode) {
    if (busy) return;
    capture();
    mode = nextMode;
    render();
  }

  async function runCheck() {
    if (busy || !validateVisible()) return;
    capture();
    busy = true;
    render(false);
    try { result = await request('account-test', payload()); }
    catch (error) {
      result = {status:'failed', checks:[{label:'Settings check',status:'error',message:error.message}]};
    } finally {
      busy = false;
      if (!closed) { render(false); dialog.querySelector('.setup-checks')?.focus(); }
    }
  }

  async function save() {
    if (busy || !validateVisible()) return;
    capture();
    busy = true;
    render(false);
    try {
      const response = await request('account-save', payload());
      savedId = response.id;
      for (const data of Object.values(drafts)) { if ('password' in data) data.password = ''; if ('client_secret' in data) data.client_secret = ''; }
      // Settings can refresh behind the modal. Saving never initiates sync or sends mail.
      try { await onSaved(provider); }
      catch { /* The account was saved even if the background account-list refresh failed. */ }
      busy = false;
      if (!closed) render();
    } catch (error) {
      busy = false;
      if (!closed) { render(false); setError(error.message); }
    }
  }

  function render(focus=true) {
    const complete = !!savedId;
    const title = complete ? 'Account saved' : 'Add an account';
    const method = mode && !complete ? `<div class="setup-method" role="group" aria-label="Setup method">
      <button type="button" data-mode="guided" aria-pressed="${mode === 'guided'}">Guided setup</button>
      <button type="button" data-mode="manual" aria-pressed="${mode === 'manual'}">Manual setup</button></div>` : '';
    let body;
    if (complete) {
      body = `<h3 id="setup-step-title" tabindex="-1">${escape(draft().label)} is ready for the next step.</h3>
        <p>${provider === 'google' ? 'Authorize with Google to connect Gmail and Calendar. You can also authorize later from Settings.' : 'The account is saved. Use Sync now in Office to download your recent mail or calendar entries.'}</p>
        <p id="account-error" class="error" role="alert" tabindex="-1"></p>
        <div class="dialog-actions">${provider === 'google' ? '<button type="button" class="primary" data-setup="authorize">Authorize with Google</button>' : ''}<button type="button" data-setup="done">Done</button></div>`;
    } else if (!mode) {
      body = `<h3 id="setup-step-title" tabindex="-1">How would you like to set up your account?</h3>
        <div class="setup-options"><button type="button" data-mode="guided" aria-label="Guided setup" aria-describedby="setup-guided-description"><strong>Guided setup</strong><span id="setup-guided-description">Follow provider-specific steps, check your settings, and review before saving.</span><small>Recommended</small></button>
        <button type="button" data-mode="manual" aria-label="Manual setup" aria-describedby="setup-manual-description"><strong>Manual setup</strong><span id="setup-manual-description">Enter all connection settings directly.</span></button></div>`;
    } else {
      const names = steps();
      const isReview = mode === 'guided' && step === names.length - 1;
      const content = mode === 'manual' ? identity()+credentials()
        : step === 0 ? identity()
        : provider === 'google' && step === 1 ? googleInstructions()
        : isReview ? review() : credentials();
      body = `${mode === 'guided' ? `<ol class="setup-progress" aria-label="Setup progress">${names.map((name,index) => `<li ${index === step ? 'aria-current="step"' : ''}>${index+1}. ${name}</li>`).join('')}</ol>` : ''}
        <h3 id="setup-step-title" tabindex="-1">${mode === 'manual' ? 'Connection settings' : names[step]}</h3>
        <form id="account-form" class="setup-form">
          ${content}
          ${mode === 'manual' ? `${checks()}<button type="button" data-setup="test">${provider === 'google' ? 'Check settings' : 'Test connection'}</button>` : ''}
          ${mode === 'guided' && !isReview && !(provider === 'google' && step === 1) && step > 0 ? `${checks()}<button type="button" data-setup="test">${provider === 'google' ? 'Check settings' : 'Test connection'}</button>` : ''}
          <p id="account-error" class="error" role="alert" tabindex="-1"></p>
          <div class="dialog-actions">
            ${mode === 'guided' && step > 0 ? '<button type="button" data-setup="back">Back</button>' : ''}
            <button type="submit" class="primary">${mode === 'manual' || isReview ? 'Save account' : 'Next'}</button>
          </div>
          <span id="setup-live" class="setup-feedback" role="status" aria-live="polite">${busy ? 'Checking or saving…' : ''}</span>
        </form>`;
    }
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="quiet" data-setup="close" aria-label="Close dialog">✕</button></div>${method}${body}`;
    dialog.classList.add('account-setup');
    dialog.setAttribute('aria-busy', String(busy));
    dialog.querySelectorAll('button,input,select').forEach(control => control.disabled = busy);
    dialog.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => changeMode(button.dataset.mode));
    dialog.querySelectorAll('[data-setup="close"],[data-setup="done"]').forEach(button => button.onclick = () => dialog.close());
    const select = dialog.querySelector('#setup-provider');
    if (select) select.onchange = () => {
      capture();
      provider = select.value;
      step = 0;
      result = null;
      render();
    };
    const form = dialog.querySelector('#account-form');
    if (form) {
      form.oninput = () => {
        capture();
        result = null;
        // Clear results immediately without rebuilding the focused input.
        dialog.querySelector('.setup-checks')?.remove();
        const error = dialog.querySelector('#account-error'); if (error) error.textContent = '';
      };
      form.onsubmit = event => {
        event.preventDefault();
        if (busy || !validateVisible()) return;
        capture();
        if (mode === 'manual' || step === steps().length - 1) void save();
        else {
          if (step === 0 && provider === 'imap' && !draft().username) draft().username = draft().email;
          step++;
          render();
        }
      };
    }
    const back = dialog.querySelector('[data-setup="back"]');
    if (back) back.onclick = () => { capture(); step--; render(); };
    const test = dialog.querySelector('[data-setup="test"]');
    if (test) test.onclick = () => void runCheck();
    const copy = dialog.querySelector('[data-setup="copy"]');
    if (copy) copy.onclick = async () => {
      capture();
      try {
        await navigator.clipboard.writeText(draft().redirect);
        if (!closed) { copy.textContent = 'Copied'; const live=dialog.querySelector('#setup-live'); if (live) live.textContent='Redirect URI copied.'; }
      } catch {
        const input = dialog.querySelector('[name="redirect"]'); input?.focus(); input?.select();
        const live=dialog.querySelector('#setup-live'); if (live) live.textContent='Press Ctrl+C or Cmd+C to copy the selected redirect URI.';
      }
    };
    const authorize = dialog.querySelector('[data-setup="authorize"]');
    if (authorize) authorize.onclick = async () => {
      authorize.disabled = true;
      try {
        const response = await request('google-connect', {id:savedId});
        const destination = new URL(response.url);
        if (destination.origin !== 'https://accounts.google.com') throw Error('Unexpected Google authorization destination.');
        location.assign(destination.href);
      } catch (error) { setError(error.message); authorize.disabled = false; }
    };
    if (focus) {
      dialog.scrollTop = 0;
      (dialog.querySelector('#setup-step-title') || dialog.querySelector('button'))?.focus({preventScroll:true});
    }
  }

  const preventBusyClose = event => { if (busy) event.preventDefault(); };
  dialog.addEventListener('cancel', preventBusyClose);
  dialog.addEventListener('close', () => {
    closed = true;
    for (const data of Object.values(drafts)) for (const key of Object.keys(data)) data[key] = '';
    result = null;
    dialog.removeEventListener('cancel', preventBusyClose);
    dialog.classList.remove('account-setup');
    dialog.removeAttribute('aria-busy');
    if (!dialog.open) dialog.replaceChildren();
    const target = document.contains(previouslyFocused) ? previouslyFocused : document.querySelector('#add-account');
    target?.focus();
    previouslyFocused = null;
  }, {once:true});
  render(false);
  dialog.showModal();
  dialog.querySelector('[data-mode="guided"]')?.focus();
}
