import {asError} from './utils.js';
import type {AccountEditDetails, CheckResult, RequestApi} from './types.js';
type Provider = 'imap' | 'gmail' | 'google' | 'caldav';
type AccountDraft = {label: string; email?: string; host?: string; smtp?: string; username?: string; password?: string; archiveFolder?: string; trashFolder?: string; url?: string; calendar?: boolean; calendarUrl?: string};
import {escapeHtml as escape} from './formats.js';

const providers = {
  imap: 'IMAP + SMTP',
  gmail: 'Gmail — app password',
  google: 'Gmail (optional Google Calendar)',
  caldav: 'CalDAV calendar',
};

/** The entire draft lives in this dialog closure, never browser storage. */
export function openAccountSetup({dialog, request, onSaved, existing, onCalendarUpdate}: {dialog: HTMLDialogElement; request: RequestApi; onSaved: (provider: Provider) => Promise<void>; existing?: AccountEditDetails; onCalendarUpdate?: () => Promise<void>}) {
  const drafts: Record<Provider, AccountDraft> = {
    imap: {label:'', email:'', host:'', smtp:'', username:'', password:'', archiveFolder:'Archive', trashFolder:'Trash'},
    gmail: {label:'', email:'', password:''},
    google: {label:'', email:'', calendar:false},
    caldav: {label:'', url:'', username:'', password:''},
  };
  let mode: string | null = existing ? 'manual' : null;
  let provider: Provider = existing?.gmailImap ? 'gmail' : existing?.type || 'imap';
  let calendarStatus = existing?.calendarStatus;
  if (existing) {
    const {label,email,host,smtp,username,archiveFolder,trashFolder,url,calendarUrl}=existing;
    drafts[provider]={...drafts[provider],label,email,host,smtp,username,archiveFolder:archiveFolder??'Archive',trashFolder:trashFolder??'Trash',url,calendarUrl};
  }
  let step = 0;
  let busy = false;
  let result: CheckResult | null = null;
  let savedId: string | null = null;
  let closed = false;
  let previouslyFocused: HTMLElement | null = (document.activeElement as HTMLElement);
  const draft = () => drafts[provider];
  const steps = () => ['Account', 'Connection', 'Review'];
  const payload = () => ({type:provider, ...draft(), ...(existing && {id:existing.id,version:existing.version})});
  const passwordHelp = existing ? 'Leave blank to keep the saved password.' : 'Use an app password if your provider requires one.';

  function capture() {
    const form = dialog.querySelector<HTMLFormElement>('#account-form')!;
    if (form) {
      for (const [key, value] of new FormData(form)) if (key !== 'provider' && key !== 'calendar') (draft() as Record<string, string | boolean>)[key] = value as string;
      if (provider === 'google') draft().calendar = !!form.querySelector<HTMLElement>('[name=calendar]:checked')!;
    }
  }

  function input(label: string, name: keyof AccountDraft, {type='text', help='', required=true, readonly=false, placeholder=''} = {}) {
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
    if (existing) return input('Account label','label')
      + (provider==='caldav' ? '' : input(provider==='google'?'Gmail address':'Sender email','email',{type:'email',readonly:provider!=='imap'}));
    if (provider === 'google') return providerSelect() + input('Gmail address', 'email', {type:'email'})
      + '<label class="setup-checkbox"><input type="checkbox" name="calendar" '+(draft().calendar ? 'checked' : '')+'> Include Google Calendar (read-only)</label><p>Sign in on Google’s page and approve access. Google integration must be configured once in Settings.</p>';
    return providerSelect() + input('Account label', 'label', {help:'A name to recognize this account, such as Personal Gmail.'})
      + (provider !== 'caldav' ? input('Sender email', 'email', {type:'email'}) : '');
  }

  function credentials() {
    if (provider === 'gmail') return `<p>Office fills in Gmail’s mail servers and detects All Mail and Trash automatically. This connects email only; Google Calendar uses the separate Google sign-in option.</p>
      <p>Turn on 2-Step Verification in your Google Account, then <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">create an app password</a> for Office. Paste that password below. Your normal Google password will not work. App passwords may be unavailable for work or school accounts, security-key-only verification, or Advanced Protection.</p>`
      + input('Google app password', 'password', {type:'password', required:!existing, help:existing?passwordHelp:'Enter the 16-letter app password. Spaces between groups are removed automatically. No Google integration setup is needed.'});
    if (provider === 'imap') {
      return `<p>Find these settings in your email provider’s mail-client instructions. Office currently supports implicit TLS on ports 993 and 465.</p>`
        + input('IMAP server (TLS 993)', 'host', {placeholder:'imap.example.com', help:'Enter the hostname only, without a protocol or port.'})
        + input('SMTP server (TLS 465)', 'smtp', {placeholder:'smtp.example.com', help:'Sending currently uses the same username and password as IMAP.'})
        + input('Username', 'username', {help:'Usually your full email address. Confirm with your provider.'})
        + input('Password / app password', 'password', {type:'password', required:!existing, help:passwordHelp})
        + input('Existing IMAP archive folder', 'archiveFolder', {help:'Use the exact server path, such as INBOX.Archive. The default Archive can detect a unique server archive folder. Test connection checks the folder and MOVE support without moving mail.'})
        + input('Existing IMAP trash folder', 'trashFolder', {help:'Default Trash detects a unique server-designated trash folder. Custom paths must match an existing folder; Office never creates one.'})
        + (calendarStatus ? calendarSettings() : '');
    }
    return `<p>Your provider supplies the full URL for an individual calendar collection. Its home page or account-discovery URL is not sufficient.</p>`
      + input('Calendar collection URL', 'url', {type:'url', placeholder:'https://calendar.example.com/calendars/user/personal/', help:'Use the final HTTPS collection URL on port 443, 8443, or 2080.'})
      + input('Username', 'username')
      + input('Password / app password', 'password', {type:'password', required:!existing, help:passwordHelp});
  }

  function calendarSettings() {
    const status=calendarStatus!;
    const summary=status.calendars.length ? status.calendars.map(calendar=>calendar.label).join(', ')
      : status.checked ? 'No calendars found yet.' : 'Office will look for calendars on the next sync.';
    return '<h4>Calendars</h4>'
      + input('CalDAV server or collection URL','calendarUrl',{type:'url',required:false,help:'Leave blank for automatic discovery. Saving a URL allows Office to use the mailbox login on that calendar server.'})
      + `<p role="status">${escape(summary)}</p>`
      + (status.approval ? `<p>Allow Office to use the mailbox login at ${escape(new URL(status.approval).host)} by using this URL and saving.</p><button type="button" data-setup="calendar-url">Use discovered URL</button>` : '')
      + (status.error ? `<p class="error">${escape(status.error)}</p>` : '')
      + '<button type="button" data-setup="find-calendars">Find calendars</button><small>Searches using the saved account settings.</small>';
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
    const fields: [string, string | undefined][] = [['Connection',providers[provider]],['Account label',data.label]];
    if (provider !== 'caldav') fields.push(['Sender email',data.email]);
    if (provider === 'imap') fields.push(['IMAP',data.host+' · TLS 993'],['SMTP',data.smtp+' · TLS 465'],['Username',data.username],['Password','Entered · hidden'],['Archive folder',data.archiveFolder],['Trash folder',data.trashFolder]);
    if (provider === 'gmail') fields.push(['IMAP','imap.gmail.com · TLS 993'],['SMTP','smtp.gmail.com · TLS 465'],['Username',data.email],['App password','Entered · hidden'],['Archive folder','Automatic · Gmail All Mail'],['Trash folder','Automatic']);
    if (provider === 'caldav') fields.push(['Calendar collection',data.url],['Username',data.username],['Password','Entered · hidden']);
    return `<p>Review these settings before saving. Secrets are hidden and will be encrypted on disk.</p>
      <dl class="setup-review">${fields.map(([name,value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      ${checks()}<button type="button" data-setup="test">Test connection</button>
      <p class="setup-note">Connection checks sign in and inspect access without saving the account, downloading items, or sending mail. They do not verify archive-folder or delivery behavior.</p>`;
  }

  function setError(message: string) {
    const error = dialog.querySelector<HTMLElement>('#account-error')!;
    if (error) { error.textContent = message; error.focus(); }
  }

  function validateVisible() {
    const form = dialog.querySelector<HTMLFormElement>('#account-form')!;
    return !form || form.reportValidity();
  }

  function changeMode(nextMode: string) {
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
    catch(cause) { const error=asError(cause);
      result = {status:'failed', checks:[{label:'Settings check',status:'error',message:error.message}]};
    } finally {
      busy = false;
      if (!closed) { render(false); dialog.querySelector<HTMLElement>('.setup-checks')!?.focus(); }
    }
  }

  async function save() {
    if (busy || !validateVisible()) return;
    capture();
    busy = true;
    render(false);
    try {
      let response = await request('account-save', payload());
      if (response.confirmation) {
        if (!window.confirm(response.confirmation)) { busy=false; render(false); return; }
        response=await request('account-save',{...payload(),confirmChange:true});
      }
      savedId = response.id;
      for (const data of Object.values(drafts)) if ('password' in data) data.password = '';
      // Settings can refresh behind the modal. Saving never initiates sync or sends mail.
      try { await onSaved(provider); }
      catch { /* The account was saved even if the background account-list refresh failed. */ }
      busy = false;
      if (!closed) render();
    } catch(cause) { const error=asError(cause);
      busy = false;
      if (!closed) { render(false); setError(error.message); }
    }
  }

  async function findCalendars() {
    capture();
    busy=true;
    render(false);
    try {
      calendarStatus=await request('account-find-calendars',{id:existing!.id});
      await onCalendarUpdate?.();
      busy=false;
      if (!closed) { render(false); dialog.querySelector<HTMLButtonElement>('[data-setup="find-calendars"]')?.focus(); }
    } catch(cause) {
      busy=false;
      if (!closed) { render(false); setError(asError(cause).message); }
    }
  }

  async function connectGoogle() {
    busy = true; render(false);
    try {
      const response = await request('google-connect', {email:draft().email, calendar:draft().calendar});
      const destination = new URL(response.url);
      if (destination.origin !== 'https://accounts.google.com') throw Error('Unexpected Google authorization destination.');
      location.assign(destination.href);
    } catch(cause) { const error=asError(cause); busy = false; if (!closed) { render(false); setError(error.message); } }
  }

  function render(focus=true) {
    const complete = !!savedId;
    const title = complete ? 'Account saved' : existing ? 'Edit account' : 'Add an account';
    const method = mode && !complete && !existing ? `<div class="setup-method" role="group" aria-label="Setup method">
      <button type="button" data-mode="guided" aria-pressed="${mode === 'guided'}">Guided setup</button>
      <button type="button" data-mode="manual" aria-pressed="${mode === 'manual'}">Manual setup</button></div>` : '';
    let body;
    if (complete) {
      body = `<h3 id="setup-step-title" tabindex="-1">${escape(draft().label)} is ready for the next step.</h3>
        <p>The account is saved. Use Sync now in Office to download your recent mail or calendar entries.</p>
        <p id="account-error" class="error" role="alert" tabindex="-1"></p>
        <div class="dialog-actions"><button type="button" data-setup="done">Done</button></div>`;
    } else if (!mode) {
      body = `<h3 id="setup-step-title" tabindex="-1">How would you like to set up your account?</h3>
        <div class="setup-options"><button type="button" data-mode="guided" aria-label="Guided setup" aria-describedby="setup-guided-description"><strong>Guided setup</strong><span id="setup-guided-description">Follow provider-specific steps, check your settings, and review before saving.</span><small>Recommended</small></button>
        <button type="button" data-mode="manual" aria-label="Manual setup" aria-describedby="setup-manual-description"><strong>Manual setup</strong><span id="setup-manual-description">Enter all connection settings directly.</span></button></div>`;
    } else if (provider === 'google' && !existing) {
      body = `<h3 id="setup-step-title" tabindex="-1">Connect your Google account</h3><form id="account-form" class="setup-form">${identity()}<p id="account-error" class="error" role="alert" tabindex="-1"></p><div class="dialog-actions"><button type="submit" class="primary">Connect with Google</button></div></form>`;
    } else {
      const names = steps();
      const isReview = mode === 'guided' && step === names.length - 1;
      const content = mode === 'manual' ? identity()+(provider==='google' ? '<p>Use Authorize in Accounts to manage access to Gmail and Google Calendar.</p>' : credentials())
        : step === 0 ? identity()
        : isReview ? review() : credentials();
      body = `${mode === 'guided' ? `<ol class="setup-progress" aria-label="Setup progress">${names.map((name,index) => `<li ${index === step ? 'aria-current="step"' : ''}>${index+1}. ${name}</li>`).join('')}</ol>` : ''}
        <h3 id="setup-step-title" tabindex="-1">${mode === 'manual' ? 'Connection settings' : names[step]}</h3>
        <form id="account-form" class="setup-form">
          ${content}
          ${mode === 'manual' && provider!=='google' ? `${checks()}<button type="button" data-setup="test">Test connection</button>` : ''}
          ${mode === 'guided' && !isReview && step > 0 ? `${checks()}<button type="button" data-setup="test">Test connection</button>` : ''}
          <p id="account-error" class="error" role="alert" tabindex="-1"></p>
          <div class="dialog-actions">
            ${mode === 'guided' && step > 0 ? '<button type="button" data-setup="back">Back</button>' : ''}
            <button type="submit" class="primary">${existing ? 'Save changes' : mode === 'manual' || isReview ? 'Save account' : 'Next'}</button>
          </div>
          <span id="setup-live" class="setup-feedback" role="status" aria-live="polite">${busy ? 'Checking or saving…' : ''}</span>
        </form>`;
    }
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="quiet" data-setup="close" aria-label="Close dialog">✕</button></div>${method}${body}`;
    dialog.classList.add('account-setup');
    dialog.setAttribute('aria-busy', String(busy));
    dialog.querySelectorAll<HTMLSelectElement>('button,input,select').forEach(control => control.disabled = busy);
    dialog.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.onclick = () => changeMode(button.dataset.mode!));
    dialog.querySelectorAll<HTMLButtonElement>('[data-setup="close"],[data-setup="done"]').forEach(button => button.onclick = () => dialog.close());
    const select = dialog.querySelector<HTMLSelectElement>('#setup-provider')!;
    if (select) select.onchange = () => {
      capture();
      provider = select.value as Provider;
      step = 0;
      result = null;
      render();
    };
    const form = dialog.querySelector<HTMLFormElement>('#account-form')!;
    if (form) {
      form.oninput = () => {
        capture();
        result = null;
        // Clear results immediately without rebuilding the focused input.
        dialog.querySelector<HTMLElement>('.setup-checks')!?.remove();
        const error = dialog.querySelector<HTMLElement>('#account-error')!; if (error) error.textContent = '';
      };
      form.onsubmit = event => {
        event.preventDefault();
        if (busy || !validateVisible()) return;
        capture();
        if (provider === 'google' && !existing) void connectGoogle();
        else if (mode === 'manual' || step === steps().length - 1) void save();
        else {
          if (step === 0 && provider === 'imap' && !draft().username) draft().username = draft().email;
          step++;
          render();
        }
      };
    }
    const back = dialog.querySelector<HTMLButtonElement>('[data-setup="back"]')!;
    if (back) back.onclick = () => { capture(); step--; render(); };
    const test = dialog.querySelector<HTMLButtonElement>('[data-setup="test"]')!;
    if (test) test.onclick = () => void runCheck();
    const find = dialog.querySelector<HTMLButtonElement>('[data-setup="find-calendars"]');
    if (find) find.onclick = () => void findCalendars();
    const useUrl = dialog.querySelector<HTMLButtonElement>('[data-setup="calendar-url"]');
    if (useUrl) useUrl.onclick = () => {
      const field=dialog.querySelector<HTMLInputElement>('#setup-calendarUrl')!;
      field.value=calendarStatus!.approval!;
      field.dispatchEvent(new Event('input',{bubbles:true}));
      field.focus();
    };
    if (focus) {
      dialog.scrollTop = 0;
      (dialog.querySelector<HTMLElement>('#setup-step-title')! || dialog.querySelector<HTMLButtonElement>('button')!)?.focus({preventScroll:true});
    }
  }

  const preventBusyClose = (event: Event) => { if (busy) event.preventDefault(); };
  dialog.addEventListener('cancel', preventBusyClose);
  dialog.addEventListener('close', () => {
    closed = true;
    for (const data of Object.values(drafts)) for (const key of Object.keys(data)) (data as Record<string, string | boolean>)[key] = '';
    result = null;
    dialog.removeEventListener('cancel', preventBusyClose);
    dialog.classList.remove('account-setup');
    dialog.removeAttribute('aria-busy');
    if (!dialog.open) dialog.replaceChildren();
    const target = document.contains(previouslyFocused) ? previouslyFocused
      : (existing && document.querySelector<HTMLButtonElement>(`[data-edit-account="${CSS.escape(existing.id)}"]`)) || document.querySelector<HTMLButtonElement>('#add-account');
    target?.focus();
    previouslyFocused = null;
  }, {once:true});
  render(false);
  dialog.showModal();
  dialog.querySelector<HTMLElement>(existing?'#setup-label':'[data-mode="guided"]')?.focus();
}
