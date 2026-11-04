// Generated from frontend/app.ts by pnpm build. Do not edit.
import { openHelp } from './help.js';
import { createKeyboardScroller, vimScrollDirection } from './keyboard-scroll.js';
import { CommandError, resolveCommand } from './commands.js';
import { createConnections } from './connections.js';
import { asError } from './utils.js';
import { isPresent } from './utils.js';
import { escapeHtml as e, markdown, safeDocument, csvParse, csvWrite, colName, cellPosition, cellValue, icsExport, vcardExport, vcardParse } from './formats.js';
import { openAccountSetup } from './account-setup.js';
import { renderGoogleSettings } from './google-settings.js';
import { renderMailFolders, matchesMailScope, syncOpenFolder, fileMail, quickMoveMail } from './mail-folders.js';
import { mailBody, mailDisplayControls, bindMailReader } from './mail-reader.js';
import { messageHeaders, setupHeaderViewer } from './mail-headers.js';
import { attachmentSection, bindAttachments, waitForAttachments } from './mail-attachments.js';
import { installItemMenus } from './item-menus.js';
import { compareMail } from './mail-sort.js';
import { mailView, mailViewPreferences, revealMailGroup } from './mail-view.js';
import { taskView, taskViewPreferences, taskPriority, taskDue } from './task-view.js';
import { renderMailListCopy, renderMailListIcon, bindMailFavicons, bindMailListSettings } from './mail-list.js';
import { createActivity } from './activity.js';
import { createCalendar, dateOnly } from './calendar.js';
import { timestampLabel, configureTimeLabels, refreshTimeLabels } from './time-labels.js';
const apps = {
    mail: { name: 'Mail', singular: 'message', empty: 'No messages yet.', hint: 'Connect an account in Settings, import an EML file, or compose your first message.', icon: 'M3 5h18v14H3z M3 5l9 7 9-7' },
    calendar: { name: 'Calendar', singular: 'event', empty: 'No events yet.', hint: 'Add an event, import a calendar, or connect Google Calendar or CalDAV.', icon: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16' },
    tasks: { name: 'Tasks', singular: 'task', empty: 'No tasks yet.', hint: 'Add a task and an optional due date.', icon: 'M9 5h12 M9 12h12 M9 19h12 M2 5l2 2 3-4 M2 12l2 2 3-4 M2 19l2 2 3-4' },
    contacts: { name: 'Contacts', singular: 'contact', empty: 'No contacts yet.', hint: 'Add a contact or import a vCard address book.', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M20 8v6 M17 11h6' },
    documents: { name: 'Documents', singular: 'document', empty: 'No documents yet.', hint: 'Create a document or import an HTML or text file.', icon: 'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h8' },
    wiki: { name: 'Wiki', singular: 'page', empty: 'No pages yet.', hint: 'Write Markdown pages, organize namespaces, and link pages with [[wiki links]].', icon: 'M3 4h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-3H3z M13 7a3 3 0 0 1 3-3h6v15h-5a4 4 0 0 0-4 3' },
    sheets: { name: 'Sheets', singular: 'workbook', empty: 'No workbooks yet.', hint: 'Create a workbook or import a CSV file.', icon: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18' },
};
const defaultKeys = { down: 'j', up: 'k', left: 'h', right: 'l', pageDown: 'd', pageUp: 'u', edit: 'i', new: 'c', search: '/', help: '?', select: 'v', save: 's', archive: 'a', reply: 'r', move: 'm', delete: 'D', undoDelete: 'U', completeTask: 'x' };
const state = { app: 'mail', rows: [], current: null, csrf: '', accounts: [], prefs: {}, search: '', mode: 'normal', dirty: false, selected: new Set(), sheet: 0, cell: 'A1', wikiEditing: false, lastActivity: Date.now(), syncing: false, savePromise: null, mailFolder: 'Inbox', mailScope: null, folderOpen: new Set() };
const lastSelectedItems = new Map();
function rememberSelection() {
    if (state.current)
        lastSelectedItems.set(state.app, state.current.id);
}
const root = document.querySelector('#app'), dialog = document.querySelector('#dialog');
const activity = createActivity({ csrf: () => state.csrf, keys: () => keys() });
const calendar = createCalendar({ query: () => state.search, allRows: () => state.rows, rows: () => filteredRows(), accounts: () => state.accounts, current: () => state.current?.id, open: selectRecord, create: (start, end) => createRecord({ meta: { start, end } }), before: leaveEditor, error: action => { void attempt(action); } });
const connections = createConnections({ api, current: () => state.current?.id, open: openConnectedRecord, modal, dialog, notice, command: value => openCommand(value), confirmation, attempt });
let pendingLinkedSource;
let unsavedDraft = null;
class DraftCancelled extends Error {
}
const isUnsavedDraft = () => !!unsavedDraft && state.current === unsavedDraft;
const mailDraftOrigins = new Map();
let lastMailView = { folder: 'Inbox', scope: null, search: '' };
function mailDraftOrigin(inherit = true) {
    return structuredClone((inherit ? mailDraftOrigins.get(state.current?.id || '') : undefined) ||
        (!state.mailScope && state.mailFolder === 'Drafts' ? lastMailView : { folder: state.mailFolder, scope: state.mailScope, search: state.search, selectedId: state.current?.id }));
}
function returnFromMailDraft(id) {
    const origin = mailDraftOrigins.get(id) || lastMailView;
    mailDraftOrigins.delete(id);
    state.mailFolder = origin.folder;
    state.mailScope = structuredClone(origin.scope);
    state.search = origin.search;
    state.selected.clear();
    selectionAnchor = null;
    keyboardSelection = false;
    state.current = navigableRows().find(r => r.id === origin.selectedId) || navigableRows()[0] || null;
    renderWorkspace();
    setMode('normal');
    focusList();
}
let saveTimer, keySequence = '', sequenceTime = 0;
let selectionAnchor = null, keyboardSelection = false;
let sendingMail = false;
const pendingMailDeletes = new Set();
let lastMailDelete, undoingMailDelete = false;
const failedMailActions = new Map();
let mailDeleteVersion = 0;
const pendingMailReads = new Map();
const mailAccountQueue = new Map(), mailSnapshots = new Map(), mailLatest = new Map(), trashedMailCopies = new Map();
let mailReadVersion = 0, displayedMailId = null;
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${apps[name]?.icon || 'M12 3v18 M3 12h18'}"/></svg>`;
const keys = () => Object.fromEntries(Object.keys(defaultKeys).map(action => {
    const saved = state.prefs.keys?.[action];
    // Upgrade the former defaults when reading older saved bindings. Settings
    // displays these effective values and persists them on the next save.
    const legacy = action === 'delete' && saved === 'd' || action === 'undoDelete' && saved === 'u';
    return [action, legacy ? defaultKeys[action] : saved || defaultKeys[action]];
}));
const editable = (node) => node?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName);
const dateLabel = (value) => { const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00' : value); return timestampLabel(value, Number.isNaN(+date) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })); };
setInterval(() => { if (!document.hidden)
    refreshTimeLabels(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden)
    refreshTimeLabels(); });
const field = (label, name, value = '', type = 'text', extra = '') => `<label>${e(label)}<input type="${type}" name="${name}" value="${e(value)}" ${extra}></label>`;
const busyButton = (button, busy) => { if (button)
    button.disabled = busy; };
function notice(text, error = false) { activity.notice(text, error); }
let commandInput = null, commandFocus = null, commandBusy = false;
let commandSuggestions;
function closeCommand(restore = false) {
    commandSuggestions?.close();
    commandSuggestions = undefined;
    const input = commandInput;
    commandInput = null;
    input?.remove();
    document.querySelector('#notice').hidden = false;
    setMode('normal');
    if (restore)
        (commandFocus?.isConnected ? commandFocus : document.querySelector('#main'))?.focus({ preventScroll: true });
    commandFocus = null;
}
async function signOut() { await waitForAttachments(); await leaveEditor(); await api('logout', {}); await boot(); }
const commandHandlers = {
    mail: () => changeApp('mail'),
    calendar: () => changeApp('calendar'),
    tasks: () => changeApp('tasks'),
    contacts: () => changeApp('contacts'),
    docs: () => changeApp('documents'),
    sheets: () => changeApp('sheets'),
    wiki: () => changeApp('wiki'),
    settings: () => changeApp('settings'),
    head: async () => { if (state.app !== 'mail' || !state.current)
        throw new CommandError('Select a mail message before using :head.'); await viewMessageHeaders(); },
    q: signOut,
    log: () => activity.open(),
    errors: () => activity.open('error'),
    warnings: () => activity.open('warning'),
    new: async (type) => {
        const target = type;
        if (!target && !apps[state.app])
            throw new CommandError('Specify an item type for :new in Settings.');
        if (target && target !== state.app)
            await changeApp(target);
        await createRecord();
    },
};
function openCommand(value = ':') {
    if (commandBusy || commandInput)
        return;
    commandFocus = document.activeElement;
    keySequence = '';
    setMode('command');
    const input = document.createElement('input');
    commandInput = input;
    input.id = 'command-input';
    input.setAttribute('aria-label', 'Command');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = value;
    document.querySelector('#notice').hidden = true;
    document.querySelector('#activity-status').prepend(input);
    input.focus();
    commandSuggestions = connections.autocomplete(input);
    if (value !== ':')
        input.dispatchEvent(new Event('input'));
    input.addEventListener('blur', () => { if (commandInput === input) {
        closeCommand();
        if (editable(document.activeElement))
            setMode('insert');
    } });
    input.addEventListener('keydown', event => {
        state.lastActivity = Date.now();
        event.stopPropagation();
        if (commandSuggestions?.key(event))
            return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeCommand(true);
            return;
        }
        if (event.key !== 'Enter' || event.isComposing)
            return;
        event.preventDefault();
        if (event.repeat || commandBusy)
            return;
        let command;
        try {
            command = resolveCommand(input.value);
        }
        catch (cause) {
            activity.notice(asError(cause).message, true, { log: !(cause instanceof CommandError) });
            closeCommand(true);
            return;
        }
        activity.clearCommandError();
        commandBusy = true;
        closeCommand(true);
        void (async () => {
            try {
                if (command.name === 'link' || command.name === 'unlink')
                    await connections.mutate(command.name, command.argument, command.kind);
                else if (command.name === 'links')
                    await connections.view(command.argument === 'all');
                else if (command.name === 'new' && command.linked) {
                    if (!state.current)
                        throw new CommandError('Select an item before creating a linked item.');
                    const source = state.current;
                    await leaveEditor();
                    if (!state.rows.some(row => row.id === source.id))
                        throw new CommandError('Linked creation cancelled because the source draft was discarded.');
                    const sourceId = source.id;
                    await commandHandlers.new(command.argument);
                    if (isUnsavedDraft())
                        pendingLinkedSource = { draft: state.current.id, source: sourceId };
                }
                else
                    await commandHandlers[command.name](command.argument);
            }
            catch (cause) {
                if (!(cause instanceof DraftCancelled))
                    activity.notice(asError(cause).message, true, { log: !(cause instanceof CommandError) });
            }
            finally {
                commandBusy = false;
            }
        })();
    });
}
function rememberMail(record) {
    if (record?.kind !== 'mail')
        return;
    let revisions = mailSnapshots.get(record.id);
    if (!revisions) {
        revisions = new Map();
        mailSnapshots.set(record.id, revisions);
    }
    const fields = ['remote', 'account', 'source', 'serverFolder', 'uidValidity', 'providerId', 'folder', 'headerOnly'];
    revisions.set(record.revision, { id: record.id, kind: record.kind, contentHash: record.contentHash ?? record.meta.rawBase64, meta: Object.fromEntries(fields.map(key => [key, record.meta[key]])) });
    if (!mailLatest.has(record.id) || mailLatest.get(record.id).revision <= record.revision)
        mailLatest.set(record.id, structuredClone(record));
    if (revisions.size > 16)
        revisions.delete(revisions.keys().next().value);
}
function latestMail(id) {
    return id ? mailLatest.get(id) : undefined;
}
function sameMailIdentity(a, b) {
    if (!a || !b || a.id !== b.id || a.kind !== 'mail' || b.kind !== 'mail')
        return false;
    const x = a.meta, y = b.meta;
    return !!x.remote && !!y.remote && x.account === y.account && !!x.source && x.source === y.source
        && x.serverFolder === y.serverFolder && x.uidValidity === y.uidValidity && x.providerId === y.providerId
        && x.folder === y.folder;
}
function sameMailTarget(a, b) {
    return sameMailIdentity(a, b) && (a.contentHash ?? a.meta.rawBase64) === (b.contentHash ?? b.meta.rawBase64);
}
function sameMailActionTarget(a, b) {
    if (!sameMailIdentity(a, b))
        return false;
    const m = a.meta;
    // IMAP UIDs identify immutable messages within a mailbox/UIDVALIDITY.
    // Gmail message IDs are immutable across content downloads as well.
    const complete = !!m.account && !!m.folder && !!m.providerId && ((!!m.serverFolder && /^[1-9][0-9]*$/.test(m.uidValidity || '') && /^[1-9][0-9]*$/.test(m.providerId)
        && m.source === `imap-folder:${encodeURIComponent(m.serverFolder).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}:${m.uidValidity}:${m.providerId}`)
        || m.source === `gmail:${m.providerId}`);
    return complete;
}
function logMailConflict(expected, current, payload, retry) {
    const fields = ['account', 'source', 'serverFolder', 'uidValidity', 'providerId', 'folder', 'remote', 'headerOnly'];
    const changed = expected && current ? fields.filter(key => expected.meta[key] !== current.meta[key]) : ['snapshot unavailable'];
    if (expected && current && expected.contentHash !== current.contentHash)
        changed.push('contentHash');
    activity.diagnostic(`Mail conflict: action=${payload?.action}; record=${payload?.id}; requested revision=${payload?.revision}; current revision=${current?.revision}; changed fields=${changed.join(', ') || 'none'}; ${retry ? 'retrying once with verified server identity' : 'stopped; no automatic retry'}.`);
}
function refreshMailRecord(record) {
    rememberMail(record);
    if (state.app !== 'mail' || pendingMailDeletes.has(record.id))
        return;
    state.rows = state.rows.map(row => row.id === record.id ? structuredClone(record) : row);
    if (state.current?.id === record.id)
        state.current = state.rows.find(row => row.id === record.id) || null;
}
async function requestApi(route, data) {
    let payload = data;
    if (route === 'mail-action')
        payload = { ...payload, summary: true };
    const response = await fetch('api.php?r=' + route, { method: payload === undefined ? 'GET' : 'POST', headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf, 'X-Office-Progress': '1' }, body: payload === undefined ? undefined : JSON.stringify(payload), cache: 'no-store' });
    let result, status = response.status;
    let cacheRefresh;
    if (response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', finished = false;
        const consume = (line) => {
            if (!line.trim())
                return;
            const event = JSON.parse(line);
            if (event.type === 'activity') {
                activity.receive(event.entry);
                if (route === 'sync' && event.entry.phase === 'mail-cache-ready' && state.app === 'mail' && !state.dirty && !document.hidden) {
                    cacheRefresh ??= load(undefined, { preserveSelection: true, selectFirst: false }).catch(cause => notice(asError(cause).message, true));
                }
            }
            if (event.type === 'result') {
                result = event.body;
                status = event.status;
                finished = true;
            }
        };
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                consume(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
            }
            if (done) {
                if (buffer.trim())
                    consume(buffer);
                break;
            }
        }
        if (!finished)
            throw Error('The connection ended before the operation was confirmed. Check recent activity and sync before retrying.');
    }
    else
        try {
            result = await response.json();
        }
        catch {
            throw Error('The server did not return JSON. Check PHP configuration and upload limits.');
        }
    await cacheRefresh;
    if (status >= 400) {
        if (status === 409 && result.code === 'mail_revision_conflict' && result.record)
            refreshMailRecord(result.record);
        if (status === 401 && route !== 'login') {
            state.dirty = false;
            await boot();
        }
        throw Object.assign(Error(result.error || 'Request failed.'), { status, code: result.code, record: result.record });
    }
    for (const record of result.records || [])
        rememberMail(record);
    rememberMail(result.record);
    if (result.connectionCounts) {
        for (const row of [...state.rows, ...(state.current ? [state.current] : [])])
            if (row.id in result.connectionCounts)
                row.connectionCount = result.connectionCounts[row.id];
        document.querySelectorAll('#items .item[data-id]').forEach(item => {
            const count = result.connectionCounts[item.dataset.id], badge = item.querySelector('.mail-list-connections');
            if (count === undefined || !badge)
                return;
            badge.hidden = count === 0;
            badge.title = `${count} ${count === 1 ? 'connection' : 'connections'}`;
            badge.setAttribute('aria-label', badge.title);
            badge.querySelector('span').textContent = String(count);
        });
    }
    if (route === 'mail-action' && payload?.action === 'trash' && result.record?.meta?.folder === 'Trash') {
        for (const id of result.removedIds || [])
            trashedMailCopies.set(id, result.record);
    }
    return result;
}
async function api(route, data) {
    let payload = data;
    const expected = mailSnapshots.get(payload?.id)?.get(payload?.revision);
    // Let an in-flight read update finish before another mutation uses its revision.
    if (payload?.id && ['save', 'delete', 'mail-action', 'mail-files'].includes(route) && pendingMailReads.has(payload.id)) {
        const result = await pendingMailReads.get(payload.id);
        if (result && payload.revision === result.previousRevision)
            payload = { ...payload, revision: result.record.revision };
    }
    const account = route === 'mail-undo' ? payload?.account : ['mail-action', 'mail-files'].includes(route) ? expected?.meta.account || latestMail(payload?.id)?.meta.account
        : route === 'sync' ? payload?.id : ['mail-content', 'mail-folder-sync', 'mail-folders', 'mail-folder-manage'].includes(route) ? payload?.account : null;
    const names = { 'mail-undo': 'Undoing mail deletion', 'mail-action': ({ trash: 'Moving mail to Trash', archive: 'Archiving mail', restore: 'Restoring mail to Inbox', read: 'Marking mail read', unread: 'Marking mail unread', move: 'Moving mail', discard: 'Discarding cached copy', 'keep-local': 'Saving local copy' })[payload?.action || ''] || 'Updating mail', sync: 'Synchronizing mail', 'mail-folders': 'Discovering folders', 'mail-folder-sync': 'Refreshing folder', 'mail-folder-manage': 'Updating folders', 'account-test': 'Testing connection', save: 'Saving item', delete: 'Deleting item', send: 'Sending mail', backup: 'Preparing backup', restore: 'Restoring backup', import: 'Importing items', 'import-items': 'Importing items' };
    const label = state.accounts.find(row => row.id === account)?.label;
    const tracking = activity.queued(names[route] ? (label ? label + ': ' : '') + names[route] + '…' : null);
    const run = async () => {
        const moved = trashedMailCopies.get(payload?.id);
        if (route === 'mail-action' && payload?.action === 'trash' && moved && latestMail(moved.id)?.meta.folder === 'Trash')
            return { record: moved, removedIds: [payload.id] };
        const latest = latestMail(payload?.id);
        if (route === 'mail-action' && sameMailActionTarget(expected, latest))
            payload = { ...payload, revision: latest.revision };
        for (let attempt = 0;; attempt++) {
            try {
                return await requestApi(route, payload);
            }
            catch (cause) {
                const error = asError(cause);
                // Only explicit pre-write revision rejections can be retried. A network
                // failure or an unconfirmed provider write must never repeat a move.
                if (route !== 'mail-action' || error.status !== 409 || error.code !== 'mail_revision_conflict')
                    throw error;
                const retry = attempt === 0 && sameMailActionTarget(expected, error.record);
                logMailConflict(expected, error.record, payload, retry);
                if (!retry)
                    throw error;
                payload = { ...payload, revision: error.record.revision };
            }
        }
    };
    const trackedRun = async () => { activity.running(tracking); try {
        return await run();
    }
    finally {
        activity.done(tracking);
    } };
    if (!account)
        return await trackedRun();
    const queueAccount = ['sync', 'mail-folder-sync'].includes(route) ? 'sync:' + account : account;
    const previous = mailAccountQueue.get(queueAccount) || Promise.resolve();
    const pending = previous.catch(() => { }).then(trackedRun);
    mailAccountQueue.set(queueAccount, pending);
    try {
        return await pending;
    }
    finally {
        if (mailAccountQueue.get(queueAccount) === pending)
            mailAccountQueue.delete(queueAccount);
    }
}
function applyTheme() {
    configureTimeLabels(state.prefs.showElapsedTime !== false);
    let theme = state.prefs.theme || 'system';
    if (theme === 'system')
        theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('compact', state.prefs.density === 'compact');
    // Fixed palettes avoid injecting arbitrary CSS through imported preferences.
    document.documentElement.dataset.accent = ['green', 'blue', 'plum'].includes(state.prefs.accent || '') ? state.prefs.accent : 'green';
    document.querySelectorAll('iframe.mail-html').forEach(frame => {
        const url = new URL(frame.src);
        url.searchParams.set('theme', theme);
        url.searchParams.set('accent', document.documentElement.dataset.accent);
        if (url.href !== frame.src)
            frame.src = url.href;
    });
}
function authView(status) {
    mailSnapshots.clear();
    mailLatest.clear();
    trashedMailCopies.clear();
    failedMailActions.clear();
    const setup = status.setup;
    root.innerHTML = `<main class="auth"><div class="brand"><div class="brandmark">o.</div><div><strong>Office</strong></div></div><h1>${setup ? 'Set up Office' : 'Sign in'}</h1><p>${setup ? 'Create your owner password to get started. Retrieve the setup token from <code>data/setup-token.txt</code> using your local file manager or cPanel File Manager.' : 'Enter your password.'}</p><form id="auth-form">${setup ? field('Setup token', 'token', '', 'text', 'required autocomplete="off"') : ''}${field(setup ? 'Create password (at least 12 characters)' : 'Password', 'password', '', 'password', `required ${setup ? 'minlength="12" autocomplete="new-password"' : 'autocomplete="current-password"'}`)}<button class="primary">${setup ? 'Create workspace' : 'Open workspace'}</button><p id="auth-error" class="error" role="alert"></p></form><p class="foot">PHP / SQLite · no scheduled jobs required</p></main>`;
    document.querySelector('#auth-form').onsubmit = async (event) => { event.preventDefault(); const button = event.target.querySelector('button'); busyButton(button, true); try {
        const r = await api(setup ? 'setup' : 'login', Object.fromEntries(new FormData(event.target)));
        state.csrf = r.csrf;
        await boot();
    }
    catch (cause) {
        const error = asError(cause);
        document.querySelector('#auth-error').textContent = error.message;
    }
    finally {
        busyButton(button, false);
    } };
}
async function boot() {
    document.querySelector('#sync-status').hidden = true;
    lastMailDelete = undefined;
    try {
        const status = await api('status');
        state.csrf = status.csrf;
        activity.configure(!!status.authenticated && !!status.activity);
        if (!status.authenticated) {
            authView(status);
            return;
        }
        state.prefs = status.preferences || {};
        applyTheme();
        const hash = location.hash.slice(1);
        state.app = apps[hash] || hash === 'settings' ? hash : 'mail';
        const initial = state.app === 'settings' ? null : api(`records&kind=${state.app}${state.app === 'mail' ? '&summaries=1' : ''}`);
        const [accounts, records] = await Promise.all([api('accounts'), initial]);
        state.accounts = accounts.accounts;
        shell();
        await load(undefined, { enteringApp: true }, records?.records);
        if (state.accounts.length)
            void syncAccounts(false);
    }
    catch (cause) {
        const error = asError(cause);
        root.innerHTML = `<main class="auth"><h1>Workspace unavailable</h1><p class="error">${e(error.message)}</p><p>Requires PHP 8.2+, PDO SQLite and a writable private data directory. Point the domain at <code>public/</code>.</p><button id="retry">Try again</button></main>`;
        document.querySelector('#retry').onclick = boot;
    }
}
function shell() {
    const syncStatus = document.querySelector('#sync-status');
    syncStatus.textContent = 'Automatic sync';
    syncStatus.hidden = false;
    root.innerHTML = `<div class="shell"><aside class="sidebar" aria-label="Application navigation"><div class="brand"><div><strong>Office</strong></div></div><p class="eyebrow nav-label">Applications</p><nav class="nav application-nav">${Object.entries(apps).map(([id, a], i) => `<button data-app="${id}" title="${a.name} · g ${i + 1}" aria-label="${a.name}">${icon(id)}<span>${a.name}</span><kbd>${i + 1}</kbd></button>${id === 'mail' ? '<button id="mail-folders-toggle" class="mail-folders-toggle" data-action="toggle-mail-folders" aria-label="Show mail folders" aria-controls="mail-folder-navigation" aria-expanded="false">▤</button><section id="mail-folder-navigation" aria-label="Mail folders"></section>' : ''}`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><button data-action="connections" title="All connections" aria-label="All connections">${icon('wiki')}<span>Connections</span></button><button data-app="settings" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3 4v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/></svg><span>Settings</span></button><button data-action="help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${icon('wiki')}<span>Keyboard shortcuts</span><kbd>?</kbd></button></nav><div class="privacy-note"><span class="privacy-dot"></span> Stored in your application folder.</div></div></aside><div class="workspace"><header class="topbar"><div class="topbar-primary"><div class="breadcrumb"><h1 id="crumb"></h1></div><div class="mail-toolbar" id="mail-toolbar" hidden><button class="primary" data-action="new">+ Compose</button><details class="mail-actions-menu" id="mail-actions-menu"><summary aria-label="More mail actions" title="More mail actions">⋯</summary><div class="mail-actions-popover"><button data-action="import">↑ Import</button><button data-action="export-all">↓ Export</button></div></details></div><div class="app-toolbar" id="app-toolbar" hidden></div></div><div class="top-actions"><button class="quiet" data-action="sync" id="sync-button" title="Refresh connected accounts">↻ <span>Sync now</span></button><span class="mode" id="mode">NORMAL</span><button class="avatar" data-action="logout" title="Sign out" aria-label="Sign out">ME</button></div></header><main id="main" tabindex="-1"></main></div></div>`;
    root.onclick = handleClick;
}
function setMailFolderPanel(open) {
    document.querySelector('.shell')?.classList.toggle('folders-open', open);
    document.querySelector('#mail-folders-toggle')?.setAttribute('aria-expanded', String(open));
}
function mailFolderEnv() { return { state, api, commit: leaveEditor, load, notice, modal, dialog, e, field, confirmation, attempt, mailDeletionReload, closeFolderPanel: () => setMailFolderPanel(false) }; }
function mailLocation(record) {
    const m = record.meta, account = state.accounts.find(a => a.id === m.account);
    if (!m.remote || ['Recovery copies', 'Not in Inbox'].includes(m.folder || ''))
        return m.folder || '';
    if (account?.type === 'google')
        return [m.folder, ...(account.folders || []).filter(f => !f.protected && (m.labelIds || []).includes(f.id)).map(f => f.name)].filter(isPresent).join(' · ');
    return m.folder === 'Custom folder' ? (account?.folders?.find(f => f.id === m.serverFolder)?.name || m.serverFolder || m.folder) : m.folder;
}
function searchableText(record) {
    const { rawBase64, raw, headersBase64, ...meta } = record.meta;
    return (record.title + ' ' + record.body + ' ' + JSON.stringify(meta)).toLocaleLowerCase();
}
function matchingRows() { const q = state.search.toLocaleLowerCase(); return state.rows.filter(r => (state.app !== 'calendar' || calendar.isVisible(r)) && (state.app !== 'mail' || (state.mailScope ? matchesMailScope(r, state.mailScope, state.accounts) : state.mailFolder === 'all' ? !['Recovery copies', 'Not in Inbox', 'Trash'].includes(r.meta.folder || '') : state.mailFolder === 'Recovery copies' ? ['Recovery copies', 'Not in Inbox'].includes(r.meta.folder || '') : (r.meta.folder || 'Archive') === state.mailFolder)) && (!q || searchableText(r).includes(q))); }
function filteredRows() { const rows = matchingRows(); return state.app === 'mail' ? mailView(rows, state.prefs.mailView).rows : state.app === 'tasks' ? taskView(rows, state.prefs.taskView).rows : rows; }
function navigableRows() { return state.app === 'mail' ? mailView(matchingRows(), state.prefs.mailView).visible : state.app === 'tasks' ? taskView(matchingRows(), state.prefs.taskView).visible : filteredRows(); }
async function deleteMailImmediately(rows, operation, undoable = false) {
    const pane = activePane();
    const ids = new Set(rows.map(r => r.id)), visible = navigableRows().map(r => r.id), currentId = state.current?.id;
    const context = JSON.stringify([state.mailFolder, state.mailScope, state.search]);
    const completingDraft = rows.some(r => r.id === currentId && r.meta.folder === 'Drafts');
    let gesture;
    if (undoable) {
        if (undoingMailDelete)
            throw Error('Wait for deletion undo to finish.');
        let finish;
        const done = new Promise(resolve => { finish = resolve; });
        gesture = { receipts: [], done, finish, currentId, context };
        lastMailDelete = gesture;
    }
    for (const id of ids) {
        pendingMailDeletes.add(id);
        failedMailActions.delete(id);
    }
    mailDeleteVersion++;
    state.rows = state.rows.filter(r => !ids.has(r.id));
    state.selected.clear();
    itemMenus.close();
    const advance = ids.has(currentId), index = visible.indexOf(currentId);
    if (advance) {
        const next = [...visible.slice(index + 1), ...visible.slice(0, index).reverse()].find(id => !ids.has(id));
        state.current = state.rows.find(r => r.id === next) || null;
    }
    const nextId = state.current?.id;
    if (gesture)
        gesture.nextId = state.current?.id;
    renderList();
    if (advance)
        renderDetail();
    restorePane(pane);
    document.querySelector('#selected-item')?.scrollIntoView({ block: 'nearest' });
    let count = 0;
    const reconciled = new Set();
    const refresh = () => {
        if (state.app !== 'mail')
            return;
        const focused = document.activeElement?.closest('#items [data-id]')?.dataset.id;
        renderList();
        if (focused)
            document.querySelector(`#items [data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    };
    try {
        for (const row of rows) {
            if (reconciled.has(row.id)) {
                count++;
                pendingMailDeletes.delete(row.id);
                continue;
            }
            const result = await operation(row);
            count++;
            pendingMailDeletes.delete(row.id);
            mailDeleteVersion++;
            if (gesture && result.undoToken)
                gesture.receipts.push({ token: result.undoToken, account: row.meta.account, id: row.id, postId: result.record?.id });
            for (const id of result?.removedIds || [])
                reconciled.add(id);
            if (state.app === 'mail' && result?.removedIds?.length) {
                state.rows = state.rows.filter(r => !reconciled.has(r.id));
                for (const id of reconciled)
                    state.selected.delete(id);
                if (reconciled.has(state.current?.id)) {
                    const visibleIds = new Set(navigableRows().map(r => r.id));
                    const next = [...visible.slice(index + 1), ...visible.slice(0, index).reverse()].find(id => !ids.has(id) && !reconciled.has(id) && visibleIds.has(id));
                    state.current = state.rows.find(r => r.id === next) || null;
                    renderList();
                    renderDetail();
                    restorePane(pane);
                }
            }
            // Keep confirmed moves available when switching folders.
            if (state.app === 'mail' && row.meta.remote && result?.record) {
                state.rows = state.rows.filter(r => r.id !== row.id && r.id !== result.record.id);
                state.rows.push(result.record);
                state.rows.sort(compareMail);
            }
        }
        if (completingDraft && state.app === 'mail' && state.current?.id === nextId && context === JSON.stringify([state.mailFolder, state.mailScope, state.search]))
            returnFromMailDraft(currentId);
        for (const row of rows)
            mailDraftOrigins.delete(row.id);
    }
    catch (cause) {
        const error = asError(cause);
        const remaining = rows.slice(count);
        for (const row of remaining) {
            pendingMailDeletes.delete(row.id);
            failedMailActions.set(row.id, error.message);
        }
        mailDeleteVersion++;
        if (state.app === 'mail') {
            for (const row of remaining)
                if (!state.rows.some(r => r.id === row.id))
                    state.rows.push(structuredClone(latestMail(row.id) || row));
            state.rows.sort(compareMail);
            if (!state.current && context === JSON.stringify([state.mailFolder, state.mailScope, state.search])) {
                state.current = navigableRows()[0] || null;
                renderDetail();
            }
        }
        throw Error((rows.length > 1 ? `${count} of ${rows.length} items updated. ` : '') + `Mail action failed; ${remaining.length === 1 ? 'message restored' : 'remaining messages restored'}. ${error.message}`);
    }
    finally {
        gesture?.finish();
        refresh();
    }
}
async function undoMailDelete() {
    if (state.app !== 'mail' || undoingMailDelete)
        return;
    const pane = activePane();
    const gesture = lastMailDelete;
    if (!gesture) {
        notice('No mail deletion to undo.');
        return;
    }
    undoingMailDelete = true;
    const selectedAtUndo = state.current?.id;
    try {
        await gesture.done;
        const failures = [], restored = [];
        for (const receipt of [...gesture.receipts]) {
            try {
                const result = await api('mail-undo', { token: receipt.token, account: receipt.account });
                mailDeleteVersion++;
                gesture.receipts = gesture.receipts.filter(r => r !== receipt);
                restored.push(result.record.id);
                for (const [id, copy] of trashedMailCopies)
                    if (copy.id === receipt.id || copy.id === receipt.postId || id === receipt.id)
                        trashedMailCopies.delete(id);
            }
            catch (cause) {
                failures.push(asError(cause).message);
            }
        }
        if (state.app === 'mail' && restored.length) {
            const sameContext = gesture.context === JSON.stringify([state.mailFolder, state.mailScope, state.search]) && selectedAtUndo === gesture.nextId && state.current?.id === selectedAtUndo;
            await load(sameContext && restored.includes(gesture.currentId) ? gesture.currentId : undefined, { preserveSelection: true, selectFirst: false });
            if (sameContext)
                restorePane(pane);
        }
        if (!gesture.receipts.length && lastMailDelete === gesture)
            lastMailDelete = undefined;
        if (failures.length)
            throw Error(`${restored.length} messages restored. ${failures.join(' ')}`);
        notice(restored.length ? `${restored.length} ${restored.length === 1 ? 'message' : 'messages'} restored.` : 'No confirmed deletions to undo.');
    }
    finally {
        undoingMailDelete = false;
    }
}
function mailDeletionReload() {
    const currentId = state.current?.id, ids = navigableRows().map(r => r.id);
    const context = () => JSON.stringify([state.app, state.mailFolder, state.mailScope, state.search]);
    const originalContext = context(), pane = activePane();
    return async (removedIds) => {
        let advance = ids.includes(currentId) && removedIds.includes(currentId) && state.current?.id === currentId && context() === originalContext;
        if (state.current?.id !== currentId)
            return;
        await load(undefined, { selectFirst: false });
        if (context() !== originalContext || (state.current && state.current.id !== currentId))
            return;
        if (state.app === 'tasks' && ids.includes(currentId) && !filteredRows().some(r => r.id === currentId))
            advance = true;
        if (!advance) {
            restorePane(pane);
            return;
        }
        const visible = new Set(navigableRows().map(r => r.id)), removed = new Set(removedIds), index = ids.indexOf(currentId);
        const nextId = [...ids.slice(index + 1), ...ids.slice(0, index).reverse()].find(id => !removed.has(id) && visible.has(id));
        state.current = state.rows.find(r => r.id === nextId) || null;
        renderList();
        if (state.app === 'calendar' && nextId)
            calendar.ensureVisible(nextId);
        renderDetail();
        restorePane(pane);
        document.querySelector('#selected-item')?.scrollIntoView({ block: 'nearest' });
    };
}
function captureMailListViewport() {
    if (state.app !== 'mail')
        return;
    const list = document.querySelector('#items');
    if (!list)
        return;
    const bounds = list.getBoundingClientRect();
    return { scrollTop: list.scrollTop, visible: Array.from(list.querySelectorAll('[data-id]'))
            .filter(row => { const rect = row.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; })
            .map(row => ({ id: row.dataset.id, top: row.getBoundingClientRect().top - bounds.top })) };
}
function restoreMailListViewport(snapshot) {
    if (!snapshot)
        return;
    const list = document.querySelector('#items');
    if (!list)
        return;
    if (snapshot.scrollTop === 0) {
        list.scrollTop = 0;
        return;
    }
    const anchor = snapshot.visible.find(row => list.querySelector(`[data-id="${CSS.escape(row.id)}"]`));
    if (anchor) {
        const row = list.querySelector(`[data-id="${CSS.escape(anchor.id)}"]`);
        list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.top;
    }
    else
        list.scrollTop = snapshot.scrollTop;
}
function captureMailReader() {
    const panel = document.querySelector('#detail');
    if (state.app !== 'mail' || !displayedMailId || !panel?.classList.contains('mail-reader'))
        return;
    const snapshot = { id: displayedMailId, open: Array.from(panel.querySelectorAll('[data-mail-disclosure][open]'), d => d.dataset.mailDisclosure) };
    const focused = document.activeElement, disclosure = focused?.closest('[data-mail-disclosure]');
    if (disclosure && panel.contains(disclosure)) {
        const attribute = Array.from(focused.attributes).find(a => a.name.startsWith('data-'));
        const selector = focused.matches('summary') ? 'summary' : attribute ? `[${attribute.name}="${CSS.escape(attribute.value)}"]` : '';
        if (selector)
            snapshot.focus = { disclosure: disclosure.dataset.mailDisclosure, selector };
    }
    return snapshot;
}
async function load(preferId, { selectFirst = true, preserveSelection = false, enteringApp = false, revealMail = false } = {}, initialRecords) {
    await waitForAttachments();
    // A background refresh must never replace an in-memory draft.
    if (isUnsavedDraft() || (preserveSelection && state.dirty))
        return;
    if (state.app !== 'mail')
        displayedMailId = null;
    itemMenus.close();
    if (!preserveSelection) {
        selectionAnchor = null;
        keyboardSelection = false;
        state.selected.clear();
    }
    const selectionContext = JSON.stringify([state.app, state.mailFolder, state.mailScope, state.search]);
    document.querySelectorAll('[data-app]').forEach(b => { const active = b.dataset.app === state.app; b.classList.toggle('active', active); if (active)
        b.setAttribute('aria-current', 'page');
    else
        b.removeAttribute('aria-current'); });
    document.querySelector('#crumb').textContent = apps[state.app]?.name || 'Settings';
    document.querySelector('.shell').classList.toggle('mail-active', state.app === 'mail');
    document.querySelector('#mail-toolbar').hidden = state.app !== 'mail';
    if (state.app !== 'mail')
        document.querySelector('#mail-actions-menu').open = false;
    document.querySelector('#mail-folder-navigation').hidden = state.app !== 'mail';
    document.querySelector('#mail-folders-toggle').hidden = state.app !== 'mail';
    if (state.app !== 'mail')
        setMailFolderPanel(false);
    if (state.app === 'settings') {
        state.current = null;
        renderSettings();
        return;
    }
    // Retry snapshots taken across a deletion, rollback or read update.
    const app = state.app;
    let records, version;
    do {
        version = mailDeleteVersion + mailReadVersion;
        records = initialRecords ?? (await api(`records&kind=${app}${app === 'mail' ? '&summaries=1' : ''}`)).records;
        initialRecords = undefined;
        if (state.app !== app)
            return;
    } while (app === 'mail' && version !== mailDeleteVersion + mailReadVersion);
    if (isUnsavedDraft() || (preserveSelection && state.dirty))
        return;
    if (preserveSelection && selectionContext !== JSON.stringify([state.app, state.mailFolder, state.mailScope, state.search]))
        return;
    const contentFocused = preserveSelection && activePane() === 'content' && !editable(document.activeElement);
    const listViewport = preserveSelection ? captureMailListViewport() : undefined;
    const readerSnapshot = preserveSelection ? captureMailReader() : undefined;
    const focusedId = preserveSelection ? document.activeElement?.closest('#items [data-id]')?.dataset.id : undefined;
    state.rows = records.filter(r => !pendingMailDeletes.has(r.id));
    if (state.app === 'mail')
        state.rows.sort(compareMail);
    if (state.app === 'calendar')
        state.rows.sort((a, b) => (a.meta.start || '').localeCompare(b.meta.start || ''));
    const previousId = state.current?.id;
    state.current = state.rows.find(r => r.id === (preferId || previousId)) || null;
    if (state.app === 'wiki' && (enteringApp || state.current?.id !== previousId))
        state.wikiEditing = false;
    if (state.app === 'mail' && revealMail && state.current) {
        // Use the freshly loaded location: a connection's earlier record can move during navigation.
        const record = state.current;
        mailListLimit = 100;
        state.mailScope = null;
        state.mailFolder = record.meta.folder === 'Not in Inbox' ? 'Recovery copies' : record.meta.folder === 'Custom folder' ? 'all' : record.meta.folder || 'Archive';
        if (record.meta.folder === 'Custom folder' && record.meta.remote && record.meta.account) {
            const account = state.accounts.find(a => a.id === record.meta.account);
            const folder = account?.type === 'google' ? account.folders?.find(f => !f.protected && record.meta.labelIds?.includes(f.id))?.id : record.meta.serverFolder;
            const scope = { account: record.meta.account, folder: folder || '', limit: 100 };
            if (folder && matchesMailScope(record, scope, state.accounts))
                state.mailScope = scope;
        }
        const prefs = revealMailGroup(record, state.prefs.mailView);
        if (JSON.stringify(prefs.collapsed) !== JSON.stringify(mailViewPreferences(state.prefs.mailView).collapsed)) {
            state.prefs = { ...state.prefs, mailView: prefs };
            mailViewSave = mailViewSave.catch(() => { }).then(() => api('preferences', { preferences: state.prefs }));
            void attempt(() => mailViewSave);
        }
    }
    if (state.app === 'mail') {
        const editingDraft = state.current && !state.current.meta.remote && state.current.meta.folder === 'Drafts';
        if (state.mailScope && state.current && !editingDraft && !matchesMailScope(state.current, state.mailScope, state.accounts))
            state.current = null;
        if (!state.current && selectFirst)
            state.current = navigableRows()[0] || null;
    }
    if (enteringApp) {
        const rows = navigableRows();
        state.current = rows.find(r => r.id === (preferId || lastSelectedItems.get(app))) || rows[0] || null;
    }
    if (state.app === 'tasks' && (!state.current || !filteredRows().some(r => r.id === state.current?.id)))
        state.current = selectFirst ? navigableRows()[0] || null : null;
    if (preserveSelection) {
        const rows = filteredRows(), visible = new Set(rows.map(r => r.id));
        for (const id of state.selected)
            if (!visible.has(id))
                state.selected.delete(id);
        if (selectionAnchor && !visible.has(selectionAnchor))
            selectionAnchor = null;
        if (listViewport?.scrollTop) {
            const bottommostSurvivor = [...listViewport.visible].reverse().find(row => visible.has(row.id));
            // Keep a viewport of rows after the anchor so the restored offset does not clamp at the paging cutoff.
            if (bottommostSurvivor)
                mailListLimit = Math.max(mailListLimit, navigableRows().findIndex(row => row.id === bottommostSurvivor.id) + 1 + listViewport.visible.length);
        }
    }
    const reuseWorkspace = preserveSelection && state.app === 'mail' && !!readerSnapshot && !!document.querySelector('#detail.mail-reader');
    if (reuseWorkspace) {
        document.querySelectorAll('#mail-folder-navigation .account-folders,.search-wrap .folder-current').forEach(node => node.remove());
        renderMailFolders(mailFolderEnv());
        renderList();
        renderDetail(readerSnapshot);
    }
    else
        renderWorkspace(readerSnapshot);
    if (focusedId)
        document.querySelector(`#items [data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
    restoreMailListViewport(listViewport);
    if (contentFocused && !document.activeElement?.closest('#detail'))
        restorePane('content');
    if (enteringApp) {
        setMode('normal');
        focusList();
        document.querySelector('#selected-item')?.scrollIntoView({ block: 'nearest' });
    }
}
function renderAppHeader() {
    const toolbar = document.querySelector('#app-toolbar');
    const a = apps[state.app];
    toolbar.hidden = state.app === 'mail' || state.app === 'settings';
    toolbar.innerHTML = toolbar.hidden ? '' : `${state.app === 'calendar' ? `<input id="search" type="search" aria-label="Search calendar" placeholder="Search cached events" value="${e(state.search)}">` : ''}<button class="quiet" data-action="import">↑ Import</button><button class="quiet" data-action="export-all">↓ Export</button><button class="primary" data-action="new">+ New ${a.singular}</button>`;
}
function renderWorkspace(readerSnapshot) {
    renderAppHeader();
    const a = apps[state.app];
    if (state.app === 'calendar') {
        document.querySelector('#main').innerHTML = `<div class="calendar-workspace"><section id="calendar-surface"></section><section class="detail calendar-detail" id="detail" aria-label="Selected event"></section></div>`;
        document.querySelector('#search').oninput = event => { state.search = event.target.value; renderList(); };
        calendar.render();
        if (state.current)
            calendar.ensureVisible(state.current.id);
        renderDetail();
        return;
    }
    document.querySelector('#main').innerHTML = `<div class="work-grid"><section class="list-pane" aria-label="${a.name} list"><div class="search-wrap"><label><span class="file-input">Search ${a.name}</span><input id="search" type="search" value="${e(state.search)}" placeholder="Search ${a.name.toLowerCase()}…   /" autocomplete="off"></label></div><div class="list-summary"><span id="list-count"></span><span id="selection-count"></span></div><div class="items" id="items" role="region" aria-label="Items"></div><div class="bottom-hint"><span><kbd>j</kbd> <kbd>k</kbd> navigate</span><span><kbd>i</kbd> edit</span><span><kbd>?</kbd> help</span></div></section><section class="detail" id="detail" aria-label="Selected ${a.singular}"></section></div>`;
    document.querySelector('#search').oninput = event => { state.search = event.target.value; mailListLimit = 100; renderList(); };
    if (state.app === 'tasks')
        bindTaskViewControls();
    if (state.app === 'mail') {
        bindMailViewControls();
        const folderNavigation = document.querySelector('#mail-folder-navigation');
        folderNavigation.innerHTML = '<div class="mail-folder-panel-head"><strong>Mail folders</strong><button data-action="close-mail-folders" aria-label="Close mail folders">✕</button></div>';
        folderNavigation.insertAdjacentHTML('beforeend', `<select id="mail-folder" aria-label="Mail folder"><option value="all">All cached mail</option>${['Inbox', 'Drafts', 'Sent', 'Archive', 'Trash', 'Local mail', 'Recovery copies', 'Sending', 'Delivery uncertain'].map(folder => `<option ${state.mailFolder === folder ? 'selected' : ''}>${folder}</option>`).join('')}</select>`);
        document.querySelector('#mail-folder').onchange = event => void attempt(async () => {
            const select = event.target, folder = select.value;
            select.disabled = true;
            try {
                await leaveEditor();
                state.mailFolder = folder;
                state.mailScope = null;
                mailListLimit = 100;
                state.current = navigableRows()[0] || null;
                state.selected.clear();
                selectionAnchor = null;
                keyboardSelection = false;
                setMode('normal');
                if (state.current?.meta.folder === 'Drafts')
                    mailDraftOrigins.set(state.current.id, mailDraftOrigin(false));
                renderWorkspace();
                if (matchMedia('(max-width: 800px)').matches)
                    setMailFolderPanel(false);
            }
            finally {
                select.value = state.mailFolder;
                select.disabled = false;
            }
        });
        if (state.mailScope) {
            const select = document.querySelector('#mail-folder');
            select.insertAdjacentHTML('afterbegin', '<option value="account-folder">Selected account folder</option>');
            select.value = 'account-folder';
        }
        renderMailFolders(mailFolderEnv());
    }
    renderList();
    renderDetail(readerSnapshot);
}
let mailListLimit = 100;
let mailViewSave = Promise.resolve();
function setMailView(value) {
    state.prefs = { ...state.prefs, mailView: mailViewPreferences(value) };
    mailListLimit = 100;
    renderList();
    // Serialize rapid menu/header changes so an older request cannot overwrite the latest view.
    mailViewSave = mailViewSave.catch(() => { }).then(() => api('preferences', { preferences: state.prefs }));
    void attempt(() => mailViewSave);
}
function bindMailViewControls() {
    const prefs = mailViewPreferences(state.prefs.mailView);
    const options = (values, selected) => Object.entries(values).map(([key, label]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${label}</option>`).join('');
    document.querySelector('.list-summary').insertAdjacentHTML('beforeend', `<details id="mail-list-view"><summary>List view</summary><div class="mail-view-menu"><label>Group by<select aria-label="Group mail by" data-mail-group>${options({ date: 'Date', sender: 'Sender', none: 'None' }, prefs.group)}</select></label><label>Sort by<select aria-label="Sort mail by" data-mail-sort>${options({ 'date-desc': 'Date · newest first', 'date-asc': 'Date · oldest first', 'sender-asc': 'Sender · A–Z', 'sender-desc': 'Sender · Z–A', 'subject-asc': 'Subject · A–Z', 'subject-desc': 'Subject · Z–A' }, prefs.sort)}</select></label><div><button type="button" data-mail-expand>Expand all</button><button type="button" data-mail-collapse>Collapse all</button></div></div></details>`);
    const menu = document.querySelector('#mail-list-view');
    menu.querySelector('[data-mail-group]').onchange = event => setMailView({ ...mailViewPreferences(state.prefs.mailView), group: event.target.value });
    menu.querySelector('[data-mail-sort]').onchange = event => setMailView({ ...mailViewPreferences(state.prefs.mailView), sort: event.target.value });
    menu.querySelector('[data-mail-expand]').onclick = () => { const p = mailViewPreferences(state.prefs.mailView); setMailView({ ...p, collapsed: p.collapsed.filter(key => !key.startsWith(p.group + ':')) }); };
    menu.querySelector('[data-mail-collapse]').onclick = () => { const p = mailViewPreferences(state.prefs.mailView); if (p.group !== 'none')
        setMailView({ ...p, collapsed: [...p.collapsed.filter(key => !key.startsWith(p.group + ':')), p.group + ':*'] }); };
    menu.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') {
        event.preventDefault();
        menu.open = false;
        menu.querySelector('summary').focus();
    } });
    document.addEventListener('pointerdown', event => { if (menu.isConnected && !menu.contains(event.target))
        menu.open = false; }, { signal: mailViewControlSignal() });
}
let mailViewControlAbort;
function mailViewControlSignal() { mailViewControlAbort?.abort(); mailViewControlAbort = new AbortController(); return mailViewControlAbort.signal; }
function setTaskView(value) {
    void attempt(async () => {
        await leaveEditor();
        state.prefs = { ...state.prefs, taskView: taskViewPreferences(value) };
        const rows = navigableRows(), ids = new Set(rows.map(r => r.id));
        for (const id of state.selected)
            if (!ids.has(id))
                state.selected.delete(id);
        selectionAnchor = null;
        if (state.current && !ids.has(state.current.id)) {
            state.current = rows[0] || null;
            renderDetail();
        }
        renderList();
        mailViewSave = mailViewSave.catch(() => { }).then(() => api('preferences', { preferences: state.prefs }));
        await mailViewSave;
    });
}
function bindTaskViewControls() {
    const p = taskViewPreferences(state.prefs.taskView);
    const options = (values, selected) => Object.entries(values).map(([key, label]) => `<option value="${e(key)}" ${key === selected ? 'selected' : ''}>${e(label)}</option>`).join('');
    const priorities = { all: 'All priorities', High: 'High', Normal: 'Normal', Low: 'Low' };
    for (const row of state.rows)
        priorities[taskPriority(row)] = taskPriority(row);
    if (!(p.priority in priorities))
        priorities[p.priority] = p.priority;
    document.querySelector('.list-summary').insertAdjacentHTML('beforeend', `<details id="task-list-view"><summary>List view</summary><div class="mail-view-menu task-view-menu">${[
        ['status', 'Show tasks', { unfinished: 'Unfinished', completed: 'Completed', all: 'All tasks' }, p.status],
        ['priority', 'Filter task priority', priorities, p.priority],
        ['due', 'Filter task due date', { all: 'Any due date', overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming', undated: 'No due date' }, p.due],
        ['group', 'Group tasks by', { none: 'None', due: 'Due date', status: 'Status', priority: 'Priority' }, p.group],
        ['sort', 'Sort tasks by', { 'due-asc': 'Due date · earliest first', 'due-desc': 'Due date · latest first', 'priority-desc': 'Priority · high first', 'priority-asc': 'Priority · low first', 'title-asc': 'Title · A–Z', 'title-desc': 'Title · Z–A', 'updated-desc': 'Updated · newest first', 'updated-asc': 'Updated · oldest first' }, p.sort],
    ].map(([key, label, values, selected]) => `<label>${label}<select data-task-pref="${key}" aria-label="${label}">${options(values, selected)}</select></label>`).join('')}<div><button type="button" data-task-expand>Expand all</button><button type="button" data-task-collapse>Collapse all</button></div></div></details>`);
    const menu = document.querySelector('#task-list-view');
    menu.querySelectorAll('[data-task-pref]').forEach(select => select.onchange = () => {
        menu.open = false;
        menu.querySelector('summary').focus();
        setTaskView({ ...taskViewPreferences(state.prefs.taskView), [select.dataset.taskPref]: select.value });
    });
    menu.querySelector('[data-task-expand]').onclick = () => { const p = taskViewPreferences(state.prefs.taskView); setTaskView({ ...p, collapsed: p.collapsed.filter(k => !k.startsWith(p.group + ':')) }); };
    menu.querySelector('[data-task-collapse]').onclick = () => { const p = taskViewPreferences(state.prefs.taskView); if (p.group !== 'none')
        setTaskView({ ...p, collapsed: [...p.collapsed.filter(k => !k.startsWith(p.group + ':')), p.group + ':*'] }); };
    menu.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') {
        event.preventDefault();
        menu.open = false;
        menu.querySelector('summary').focus();
    } });
    document.addEventListener('pointerdown', event => { if (menu.isConnected && !menu.contains(event.target))
        menu.open = false; }, { signal: mailViewControlSignal() });
}
function taskBadges(row) {
    const priority = taskPriority(row), due = taskDue(row), level = priority.toLowerCase();
    return `<span class="task-badges"><span class="badge task-status">${row.meta.done ? '✓ Completed' : '○ Unfinished'}</span><span class="badge task-priority ${['high', 'normal', 'low'].includes(level) ? 'task-priority-' + level : ''}">${level === 'high' ? '↑' : level === 'low' ? '↓' : '•'} ${e(priority)}</span>${!row.meta.done && ['overdue', 'today'].includes(due) ? `<span class="badge task-due-${due}">${due === 'overdue' ? '! Overdue' : '◷ Due today'}</span>` : ''}</span>`;
}
function renderList() {
    if (state.app === 'mail' && (state.mailScope || state.mailFolder !== 'Drafts'))
        lastMailView = { folder: state.mailFolder, scope: structuredClone(state.mailScope), search: state.search, selectedId: state.current?.meta.folder === 'Drafts' ? undefined : state.current?.id };
    if (state.app === 'calendar') {
        calendar.render();
        return;
    }
    const model = state.app === 'mail' ? mailView(matchingRows(), state.prefs.mailView) : state.app === 'tasks' ? taskView(matchingRows(), state.prefs.taskView) : undefined;
    const rows = model?.rows || filteredRows(), count = document.querySelector('#list-count');
    count.textContent = state.app === 'mail' ? `${rows.length} cached ${rows.length === 1 ? 'message' : 'messages'}` : `${rows.length} ${rows.length === 1 ? apps[state.app].singular : 'items'}`;
    count.title = state.app === 'mail' ? 'Messages stored in Office for this view. This count can grow as older mail downloads.' : '';
    document.querySelector('#selection-count').textContent = state.selected.size ? `${state.selected.size} selected` : '';
    const expanded = model?.visible || rows;
    if (state.app === 'mail')
        mailListLimit = Math.max(mailListLimit, expanded.findIndex(r => r.id === state.current?.id) + 1);
    const visible = state.app === 'mail' ? expanded.slice(0, mailListLimit) : expanded;
    const item = (r) => {
        const hint = state.app === 'mail' ? (r.meta.from || r.meta.to || r.meta.folder || 'Local archive') : state.app === 'calendar' ? (r.meta.start ? dateLabel(r.meta.start) + ' · ' : '') + e(r.meta.location || '') : state.app === 'tasks' ? (r.meta.done ? 'Completed' : r.meta.due ? 'Due ' + dateLabel(r.meta.due) : 'No due date') : state.app === 'contacts' ? e(r.meta.email || r.meta.company || '') : state.app === 'wiki' ? e(r.title.includes(':') ? r.title.split(':').slice(0, -1).join(':') : 'Root namespace') : 'Edited ' + dateLabel(r.updated);
        const selected = state.current?.id === r.id;
        const readState = state.app === 'mail' ? (r.meta.read ? 'read' : 'unread') : '';
        const readStatus = readState ? `<span class="mail-read-status"><span class="file-input">${readState === 'unread' ? 'Unread' : 'Read'}</span></span>` : '';
        const badges = state.app === 'mail' ? '' : `<span>${r.meta.folder ? `<span class="badge">${e(r.meta.folder)}</span>` : ''}${r.meta.remote ? '<span class="badge">Synced</span>' : ''}</span>`;
        const itemIcon = state.app === 'mail' ? renderMailListIcon(r, state.selected.has(r.id), icon('mail')) : `<span class="item-icon">${state.selected.has(r.id) ? '✓' : icon(state.app)}</span>`;
        return `<button class="item ${state.app === 'tasks' && r.meta.done ? 'task-completed' : ''} ${readState ? 'mail-' + readState : ''} ${selected ? 'selected' : ''} ${state.selected.has(r.id) ? 'multi-selected' : ''}" data-id="${r.id}" aria-pressed="${state.selected.has(r.id) || selected}" aria-haspopup="menu" ${selected ? 'id="selected-item"' : ''}>${readStatus}${itemIcon}${state.app === 'mail' ? renderMailListCopy(r, state.prefs.mailList, failedMailActions.get(r.id)) : `<span class="item-copy"><strong>${e(r.title)}</strong><small>${hint}</small>${state.app === 'tasks' ? taskBadges(r) : ''}</span>`}${badges}</button>`;
    };
    const list = document.querySelector('#items'), focusedGroup = document.activeElement?.closest('[data-mail-group-key]')?.dataset.mailGroupKey;
    const included = new Set(visible.map(row => row.id));
    list.innerHTML = rows.length ? (model && (state.app === 'tasks' ? taskViewPreferences(state.prefs.taskView) : mailViewPreferences(state.prefs.mailView)).group !== 'none' ? model.groups.map(group => {
        const rendered = group.rows.filter(row => included.has(row.id));
        if (!group.collapsed && !rendered.length)
            return '';
        return `<button type="button" class="mail-group-header" data-mail-group-key="${e(group.key)}" aria-expanded="${!group.collapsed}"><span aria-hidden="true">${group.collapsed ? '▸' : '▾'}</span><span class="mail-group-label">${e(group.label)}</span><span class="mail-group-count">${group.rows.length}</span></button>${rendered.map(item).join('')}`;
    }).join('') : visible.map(item).join('')) : `<div class="list-empty">${state.app === 'tasks' ? 'No tasks match this view. Adjust List view filters or add a task.' : state.search ? 'No matching items. Try a different search.' : 'No items yet.'}</div>`;
    if (state.app === 'mail')
        bindMailFavicons(list);
    list.querySelectorAll('[data-mail-group-key]').forEach(button => button.onclick = () => {
        const p = state.app === 'tasks' ? taskViewPreferences(state.prefs.taskView) : mailViewPreferences(state.prefs.mailView), key = button.dataset.mailGroupKey;
        const collapsed = button.getAttribute('aria-expanded') === 'false', all = p.collapsed.includes(p.group + ':*'), exception = p.group + ':!' + key;
        const retained = p.collapsed.filter(value => value !== key && value !== exception);
        (state.app === 'tasks' ? setTaskView : setMailView)({ ...p, collapsed: collapsed ? (all ? [...retained, exception] : retained) : (all ? retained : [...retained, key]) });
    });
    if (focusedGroup)
        list.querySelector(`[data-mail-group-key="${CSS.escape(focusedGroup)}"]`)?.focus({ preventScroll: true });
    if (state.app === 'mail' && visible.length < expanded.length) {
        const button = document.createElement('button');
        button.textContent = 'Show next 100 messages';
        button.onclick = () => { mailListLimit += 100; renderList(); };
        list.append(button);
    }
}
const bodyDownloads = new Set(), bodyFailures = new Set();
async function hydrateMailBody(record, manual = false) {
    if (bodyDownloads.has(record.id) || (!manual && bodyFailures.has(record.id)))
        return;
    bodyDownloads.add(record.id);
    const button = document.querySelector('[data-download-body]');
    if (button)
        button.disabled = true;
    const status = document.querySelector('[data-body-status]');
    if (status)
        status.textContent = ' Downloading…';
    try {
        await pendingMailReads.get(record.id);
        const result = await api('mail-content', { id: record.id, account: record.meta.account, summary: true });
        refreshMailRecord(result.record);
        bodyFailures.delete(record.id);
        if (state.app === 'mail') {
            updateMailListItem(record.id);
            if (state.current?.id === record.id)
                renderDetail();
        }
    }
    catch (cause) {
        bodyFailures.add(record.id);
        if (state.app === 'mail' && state.current?.id === record.id) {
            if (status)
                status.textContent = ' ' + asError(cause).message;
            if (button)
                button.disabled = false;
        }
    }
    finally {
        bodyDownloads.delete(record.id);
    }
}
let displayedMailBody;
function renderDetail(readerSnapshot = captureMailReader(), toolbarOnly = false) {
    const scrollingPanel = document.querySelector('#detail');
    if (scrollingPanel)
        keyboardScrollers.get(scrollingPanel)?.cancel();
    const panel = document.querySelector('#detail'), r = state.current, a = apps[state.app];
    if (state.app === 'calendar') {
        panel.hidden = !r;
        if (!r) {
            panel.innerHTML = '';
            return;
        }
    }
    const contentFocused = !!r && document.activeElement === contentEntry();
    const openedMail = state.app === 'mail' && r ? r.id : null, newlyOpened = openedMail !== displayedMailId;
    const restore = readerSnapshot?.id === openedMail ? readerSnapshot : undefined;
    displayedMailId = openedMail;
    const viewingMail = state.app === 'mail' && !!r && r.meta.folder !== 'Drafts';
    panel.classList.toggle('mail-reader', viewingMail);
    if (!r) {
        const emptyMail = state.app === 'mail' && !filteredRows().length;
        const heading = emptyMail ? (state.search ? 'No matching messages.' : 'No messages in this folder.') : (state.rows.length ? 'Select a ' + a.singular : a.empty);
        panel.innerHTML = `<div class="empty"><span class="empty-symbol">${state.app === 'mail' ? '↗' : state.app === 'wiki' ? 'Aa' : state.app === 'sheets' ? '∑' : '○'}</span><h2>${heading}</h2><p>${emptyMail ? (state.search ? 'Try a different search or choose another folder.' : 'Choose another folder or write a new message.') : a.hint}</p><button data-action="new">${state.app === 'mail' ? 'Write a message' : 'Create ' + a.singular} <span aria-hidden="true">↗</span></button></div>`;
        return;
    }
    const fillSender = state.app === 'mail' && !r.meta.remote && r.meta.folder === 'Drafts' && !r.meta.sendAccount ? draftAccount(r) : '';
    if (fillSender)
        r.meta.sendAccount = fillSender;
    const remote = !!r.meta.remote;
    const mailBadges = state.app === 'mail' ? `${r.meta.folder ? `<span class="badge">${e(mailLocation(r))}</span>` : ''}${remote ? '<span class="badge">Cached</span>' : ''}` : '';
    const bodyKey = viewingMail ? JSON.stringify([r.id, r.body, r.bodyHash, mailBody(r, state.prefs)]) : undefined;
    const retainBody = viewingMail && !newlyOpened && bodyKey === displayedMailBody && !!panel.querySelector('.mail-reader-header');
    displayedMailBody = bodyKey;
    const markup = `${viewingMail ? '' : `<div class="detail-toolbar"><div class="left ${state.app === 'mail' ? 'mail-detail-heading' : ''}"><span class="eyebrow">${remote ? (state.app === 'mail' ? 'Cached message' : 'Synced · read only') : a.singular}</span>${mailBadges}</div><div class="right"><span class="save-status" id="save-status">${remote ? 'Cached copy' : isUnsavedDraft() ? 'Unsaved draft' : state.dirty ? 'Unsaved changes' : 'Saved'}</span>${!isUnsavedDraft() && ['wiki', 'documents'].includes(state.app) ? '<button class="quiet" data-action="history">History</button>' : ''}${state.app === 'wiki' ? `<button data-action="wiki-mode">${state.wikiEditing ? 'View page' : 'Edit source'}</button>` : ''}<button class="quiet" data-action="export">Export</button>${!remote ? `<button class="primary" data-action="save">Save</button><button class="quiet danger" data-action="delete" title="${isUnsavedDraft() || r.kind === 'mail' && r.meta.folder === 'Drafts' ? 'Discard Draft' : 'Delete selected item'}">${isUnsavedDraft() || r.kind === 'mail' && r.meta.folder === 'Drafts' ? 'Discard Draft' : 'Delete'}</button>` : ''}</div></div><div class="print-only"><h1>${e(r.title)}</h1></div>`}${detailContent(r)}`;
    if (toolbarOnly) {
        const template = document.createElement('template');
        template.innerHTML = markup;
        for (const selector of ['.detail-toolbar', '.print-only'])
            panel.querySelector(selector)?.replaceWith(template.content.querySelector(selector));
        void connections.section();
        return;
    }
    if (retainBody) {
        // Keep the body connected: moving an iframe reloads its browsing context.
        const template = document.createElement('template');
        template.innerHTML = markup;
        panel.querySelector('.mail-reader-header').replaceWith(template.content.querySelector('.mail-reader-header'));
        panel.querySelector('.mail-action-failure')?.remove();
    }
    else
        panel.innerHTML = markup;
    void connections.section();
    panel.querySelectorAll('[data-mail-disclosure]').forEach(d => d.open = !!restore?.open.includes(d.dataset.mailDisclosure));
    const failure = state.app === 'mail' ? failedMailActions.get(r.id) : undefined;
    if (failure)
        panel.insertAdjacentHTML('afterbegin', `<p class="mail-action-failure" role="status">Mail action failed; message restored. ${e(failure)}</p>`);
    const form = panel.querySelector('#record-form');
    if (state.app === 'mail' && r.meta.folder !== 'Drafts')
        bindMailReader(panel, r, renderDetail, keys());
    if (contentFocused)
        focusContent();
    if (state.app === 'mail')
        bindAttachments(panel, r, { api, commit: requireSaved, notice, modal, update: record => {
                if (state.current?.id === record.id) {
                    state.current.revision = record.revision;
                    state.current.meta.attachments = record.meta.attachments;
                    state.current.meta.hasAttachments = record.meta.hasAttachments;
                }
                const row = state.rows.find(row => row.id === record.id);
                if (row) {
                    row.revision = record.revision;
                    row.meta.attachments = record.meta.attachments;
                    row.meta.hasAttachments = record.meta.hasAttachments;
                }
            } });
    if (restore?.focus) {
        const disclosure = panel.querySelector(`[data-mail-disclosure="${CSS.escape(restore.focus.disclosure)}"]`);
        const control = disclosure?.querySelector(restore.focus.selector);
        const target = control && !control.matches(':disabled') && (control.matches('summary') || disclosure?.open) ? control : disclosure?.querySelector('summary');
        target?.focus({ preventScroll: true });
    }
    if (newlyOpened && openedMail)
        markOpenedMailRead(r);
    const bodyButton = panel.querySelector('[data-download-body]');
    if (bodyButton) {
        bodyButton.onclick = () => void hydrateMailBody(r, true);
        if (Number(r.meta.messageSize || 0) <= 1400000 && !['Recovery copies', 'Not in Inbox'].includes(r.meta.folder || ''))
            void hydrateMailBody(r);
    }
    if (form) {
        form.oninput = () => markDirty();
        form.onsubmit = async (ev) => { ev.preventDefault(); await attempt(() => commit(true)); };
    }
    if (state.app === 'calendar') {
        const close = document.createElement('button');
        close.textContent = 'Close event';
        close.className = 'calendar-close';
        close.onclick = () => void attempt(async () => { await leaveEditor(); state.current = null; renderDetail(); renderList(); document.querySelector('#items button')?.focus(); });
        panel.prepend(close);
        const allDay = form?.querySelector('[name="allDay"]');
        if (allDay)
            allDay.onchange = () => { for (const name of ['start', 'end']) {
                const input = form.querySelector(`[name="${name}"]`);
                const value = input.value;
                input.type = allDay.checked ? 'date' : 'datetime-local';
                input.value = allDay.checked ? value.slice(0, 10) : value + 'T00:00';
            } markDirty(); };
    }
    if (fillSender)
        markDirty();
    panel.querySelectorAll('[data-format]').forEach(button => {
        button.onmousedown = event => event.preventDefault();
        button.onclick = () => { const rich = panel.querySelector('#rich-editor'); rich.focus(); const command = button.dataset.format; if (command === 'table')
            document.execCommand('insertHTML', false, '<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>');
        else
            document.execCommand(command, false, button.dataset.value || undefined); markDirty(); };
    });
    const rich = panel.querySelector('#rich-editor');
    if (rich) {
        rich.onpaste = event => { event.preventDefault(); const html = event.clipboardData.getData('text/html'); if (html)
            document.execCommand('insertHTML', false, safeDocument(html));
        else
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); markDirty(); };
        rich.ondrop = event => event.preventDefault();
    }
    const formula = panel.querySelector('#formula');
    if (formula)
        formula.oninput = () => { const workbook = state.current.meta.workbook; workbook.sheets[state.sheet].cells[state.cell] = formula.value; markDirty(); updateCells(); };
}
function detailContent(r) {
    const m = r.meta, disabled = m.remote ? 'disabled' : '';
    if (state.app === 'mail' && m.folder !== 'Drafts') {
        const recovery = !!m.remote && ['Recovery copies', 'Not in Inbox'].includes(m.folder || '');
        const actions = recovery ? '<button data-action="keep-local">Save locally</button><button class="danger quiet" data-action="discard-copy">Discard copy</button>' : `${m.folder !== 'Archive' ? `<button data-action="archive">${m.remote ? 'Archive' : 'Archive locally'}</button>` : ''}${m.remote ? m.folder === 'Trash' ? '<button data-action="restore-mail">Restore to Inbox</button>' : '<button data-action="trash-mail">Move to Trash</button>' : '<button class="danger quiet" data-action="delete">Delete</button>'}`;
        const date = m.date || m.sentAt || '', parsed = new Date(date), validDate = Number.isFinite(parsed.getTime());
        const compactDate = validDate ? parsed.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : date;
        const account = state.accounts.find(a => a.id === m.account);
        const metadata = [['From', m.from || 'Unknown'], ['To', m.to || ''], ['Date', date], ...(validDate ? [['Local time', parsed.toLocaleString()]] : []), ...(m.account ? [['Account', account?.label || m.account]] : []), ['Location', mailLocation(r)], ...(m.serverFolder ? [['Server folder', m.serverFolder]] : []), ...(m.source ? [['Source', m.source]] : [])];
        const provenance = m.remote ? `<p class="muted">Downloaded copy from ${e(mailLocation(r))}. Mail actions update the provider; Sync now refreshes its location.${m.headerOnly ? ' Only headers are cached.' : ''}</p>` : '';
        return `<header class="mail-reader-header"><div class="mail-subject-row"><h1>${e(r.title)}</h1><div class="mail-header-badges">${m.folder ? `<span class="badge">${e(mailLocation(r))}</span>` : ''}${m.remote ? '<span class="badge">Cached</span>' : ''}</div></div><div class="mail-envelope-row"><span class="mail-correspondents" title="${e((m.from || 'Unknown') + ' → ' + (m.to || ''))}">${e(m.from || 'Unknown')} <span aria-hidden="true">→</span><span class="file-input">to</span> ${e(m.to || 'Unspecified recipient')}</span><span class="mail-compact-date" title="${e(date)}">${timestampLabel(date, compactDate)}</span><details data-mail-disclosure="metadata" class="mail-metadata"><summary>Details</summary><div class="mail-reader-popover mail-metadata-popover"><dl>${metadata.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${label === 'Date' || label === 'Local time' ? timestampLabel(date, value || '') : e(value)}</dd></div>`).join('')}</dl>${provenance}<button data-action="message-headers">View message headers</button></div></details></div>${recovery ? '<p class="recurrence-note" role="status">This copy is absent from its synchronized folders. It may have moved elsewhere or been deleted. Save locally keeps an independent copy; Discard copy removes only this cached copy.</p>' : ''}<div class="head-actions mail-reader-actions">${m.from ? '<button data-action="reply">Reply</button>' : ''}<button data-action="forward">Forward</button>${actions}${attachmentSection(r)}<details data-mail-disclosure="more" class="mail-reader-more"><summary>More</summary><div class="mail-reader-popover mail-more-popover">${!recovery && m.remote ? '<button data-action="file-mail">Move / Labels</button>' : ''}${!recovery ? `<button data-action="read">Mark ${m.read ? 'unread' : 'read'}</button>` : ''}<button data-action="export">Export</button>${(m.rawBase64 || m.raw || r.hasOriginal) ? '<button data-action="eml">Download original EML</button>' : ''}${mailDisplayControls(r, state.prefs)}</div></details></div></header>${mailBody(r, state.prefs)}`;
    }
    if (state.app === 'wiki' && !state.wikiEditing)
        return `<span class="eyebrow">${e(r.title.split(':').slice(0, -1).join(' / ') || 'Root namespace')}</span><h1>${e(r.title.split(':').at(-1))}</h1><article class="article">${markdown(r.body)}</article><div class="wiki-layout"><span class="eyebrow">Backlinks</span>${state.rows.filter(x => x.id !== r.id && x.body.includes('[[' + r.title + ']]')).map(x => `<p><button class="wiki-link" data-wiki="${e(x.title)}">${e(x.title)}</button></p>`).join('') || '<p class="muted">No pages link here yet.</p>'}</div>`;
    let content = `<form id="record-form" class="detail-form"><label><span class="file-input">${state.app === 'wiki' ? 'Page ID (namespace:page)' : 'Title'}</span><input class="title-input" name="title" value="${e(r.title)}" required ${disabled} aria-label="Title"></label>`;
    if (state.app === 'tasks')
        content += `<div class="task-detail-badges">${taskBadges(r)}</div><div class="fields">${field('Due date', 'due', m.due, 'date')}<label>Priority<select name="priority" aria-label="Priority" ${disabled}>${[...new Set(['High', 'Normal', 'Low', taskPriority(r)])].map(value => `<option value="${e(value)}" ${value === taskPriority(r) ? 'selected' : ''}>${e(value)}</option>`).join('')}</select></label><label class="check-label"><input type="checkbox" name="done" ${m.done ? 'checked' : ''} ${disabled}> Completed</label></div>`;
    if (state.app === 'contacts')
        content += `<div class="fields">${field('Email', 'email', m.email, 'email')}${field('Phone', 'phone', m.phone, 'tel')}${field('Company', 'company', m.company)}${field('Group', 'group', m.group)}</div>`;
    if (state.app === 'calendar')
        content += `<label class="check-label"><input type="checkbox" name="allDay" ${dateOnly(m.start) ? 'checked' : ''} ${disabled}> All day</label><div class="fields">${field('Start (local time)', 'start', dateOnly(m.start) ? m.start : localInput(m.start), dateOnly(m.start) ? 'date' : 'datetime-local', disabled)}${field(dateOnly(m.start) ? 'End (exclusive date)' : 'End (local time)', 'end', dateOnly(m.start) ? m.end : localInput(m.end), dateOnly(m.start) ? 'date' : 'datetime-local', disabled)}${field('Location', 'location', m.location, 'text', disabled)}</div>${m.rawIcs || m.raw ? '<button type="button" data-action="original-ics">Download original ICS</button>' : ''}${m.recurrence ? `<p class="recurrence-note">Recurring series: ${e(m.recurrence)}. No additional occurrences are generated locally. Export the original ICS for full fidelity.</p>` : ''}`;
    if (state.app === 'mail')
        content += `<div class="fields">${field('To (one recipient)', 'to', m.to, 'email', 'required')}<label>Send using<select name="sendAccount" aria-label="Send using"><option value="">Choose an account</option>${m.sendAccount && !mailAccounts().some(a => a.id === m.sendAccount) ? `<option value="${e(m.sendAccount)}" selected>Unavailable account — choose another</option>` : ''}${mailAccounts().map(a => `<option value="${a.id}" ${m.sendAccount === a.id ? 'selected' : ''}>${e(a.label)}</option>`).join('')}</select></label></div>`;
    if (state.app === 'documents')
        content += `<div class="document-content"><div class="rich-toolbar" role="toolbar" aria-label="Document formatting"><button type="button" data-format="bold" aria-label="Bold"><b>B</b></button><button type="button" data-format="italic" aria-label="Italic"><i>I</i></button><button type="button" data-format="formatBlock" data-value="h1">Heading 1</button><button type="button" data-format="formatBlock" data-value="h2">Heading 2</button><button type="button" data-format="formatBlock" data-value="p">Paragraph</button><button type="button" data-format="insertUnorderedList">List</button><button type="button" data-format="insertOrderedList">1. List</button><button type="button" data-format="table">Table</button><button type="button" data-action="link">Link</button><button type="button" data-action="image">Image</button><button type="button" data-format="undo">Undo</button><button type="button" data-format="redo">Redo</button><button type="button" data-action="text">Plain text</button><button type="button" data-action="print">Print / PDF</button></div><div id="rich-editor" class="rich-editor" contenteditable="true" role="textbox" aria-label="Document content" aria-multiline="true">${safeDocument(r.body)}</div></div><p class="muted">Basic formatting · HTML / plain text export · Vim navigation outside the editing area</p>`;
    else if (state.app === 'sheets')
        content += sheetContent(r);
    else
        content += `<label>${state.app === 'wiki' ? 'Markdown source' : state.app === 'mail' ? 'Message' : 'Notes'}<textarea class="body-editor" name="body" ${disabled}>${e(r.body)}</textarea></label>`;
    if (state.app === 'mail')
        content += attachmentSection(r) + `<div class="head-actions"><button type="button" class="primary" data-action="send" title="Send message (Ctrl+Enter)" ${sendingMail ? 'disabled' : ''}>Send message</button><span class="muted">Ctrl+Enter to send. Saved drafts are never sent automatically.</span></div>`;
    return content + '</form>';
}
function localInput(value) { if (!value)
    return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return value + 'T00:00'; if (!/[Zz]|[+-]\d\d:\d\d$/.test(value))
    return value.slice(0, 16); const d = new Date(value); return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function workbook(r) {
    r.meta.workbook ??= { sheets: [{ name: 'Sheet 1', cells: {} }] };
    for (const s of r.meta.workbook.sheets)
        if (Array.isArray(s.cells))
            s.cells = { ...s.cells };
    return r.meta.workbook;
}
function sheetContent(r) {
    const w = workbook(r);
    state.sheet = Math.min(state.sheet, w.sheets.length - 1);
    const sheet = w.sheets[state.sheet];
    return `<div><div class="sheet-tabs">${w.sheets.map((s, i) => `<button type="button" data-sheet="${i}" class="${i === state.sheet ? 'primary' : ''}">${e(s.name)}</button>`).join('')}<button type="button" data-action="add-sheet" aria-label="Add sheet">+</button><button type="button" data-action="rename-sheet">Rename</button></div><label class="formula-bar"><code id="cell-label">${state.cell}</code><span class="file-input">Cell formula or value</span><input id="formula" value="${e(sheet.cells[state.cell] || '')}" autocomplete="off" aria-label="Cell formula or value"></label><div class="sheet-wrap"><table class="sheet" aria-label="Spreadsheet"><thead><tr><th></th>${Array.from({ length: 12 }, (_, c) => `<th scope="col">${colName(c)}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: 30 }, (_, row) => `<tr><th scope="row">${row + 1}</th>${Array.from({ length: 12 }, (_, col) => { const ref = colName(col) + (row + 1); return `<td><button type="button" data-cell="${ref}" class="${state.cell === ref ? 'cell-selected' : ''}" tabindex="${state.cell === ref ? '0' : '-1'}" aria-label="${ref}: ${e(cellValue(sheet.cells, ref))}">${e(cellValue(sheet.cells, ref))}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">30 × 12 visible cells · + − * / ^ · SUM, AVERAGE, MIN, MAX, COUNT · A1:B5 ranges. Use i or Enter to edit, Escape to return, Tab/arrows to move. Cross-sheet formulas are deferred.</p></div>`;
}
function updateCells() { const cells = workbook(state.current).sheets[state.sheet].cells; document.querySelectorAll('[data-cell]').forEach(b => { const v = cellValue(cells, b.dataset.cell); b.textContent = String(v); b.setAttribute('aria-label', b.dataset.cell + ': ' + v); }); }
function selectCell(ref, focus = false) {
    state.cell = ref;
    const sheet = workbook(state.current).sheets[state.sheet];
    document.querySelector('#cell-label').textContent = ref;
    document.querySelector('#formula').value = sheet.cells[ref] || '';
    document.querySelectorAll('[data-cell]').forEach(b => { const selected = b.dataset.cell === ref; b.classList.toggle('cell-selected', selected); b.tabIndex = selected ? 0 : -1; if (selected && focus)
        b.focus(); });
}
function collect() {
    if (!state.current)
        return;
    const form = document.querySelector('#record-form');
    if (!form)
        return;
    const values = Object.fromEntries(new FormData(form));
    state.current.title = values.title || state.current.title;
    if ('body' in values)
        state.current.body = values.body;
    // PHP returns empty metadata as []; JSON would drop named properties added to it.
    if (Array.isArray(state.current.meta))
        state.current.meta = { ...state.current.meta };
    const m = state.current.meta;
    for (const key of ['due', 'priority', 'email', 'phone', 'company', 'group', 'location', 'to', 'sendAccount'])
        if (key in values)
            m[key] = values[key];
    for (const key of ['start', 'end'])
        if (key in values)
            m[key] = values[key] ? (dateOnly(values[key]) ? values[key] : new Date(values[key]).toISOString()) : '';
    if (state.app === 'tasks')
        m.done = values.done === 'on';
    if (state.app === 'documents')
        state.current.body = safeDocument(document.querySelector('#rich-editor').innerHTML);
}
function markDirty() { collect(); state.dirty = true; const s = document.querySelector('#save-status'); if (s)
    s.textContent = isUnsavedDraft() ? 'Unsaved draft' : 'Unsaved changes'; clearTimeout(saveTimer); if (!isUnsavedDraft())
    saveTimer = setTimeout(() => void attempt(() => commit()), 800); }
async function completeTask() {
    if (state.app !== 'tasks' || !state.current || state.current.meta.remote)
        return;
    const checkbox = document.querySelector('#record-form input[name="done"]');
    if (!checkbox || checkbox.checked)
        return;
    const pane = activePane();
    checkbox.checked = true;
    markDirty();
    await commit();
    if (state.app === 'tasks')
        restorePane(pane);
}
async function requireSaved() {
    if (isUnsavedDraft())
        throw Error('Save this draft first.');
    await commit();
}
function discardUnsavedDraft() {
    const draft = unsavedDraft;
    clearTimeout(saveTimer);
    unsavedDraft = null;
    pendingLinkedSource = undefined;
    state.current = null;
    state.dirty = false;
    if (draft?.kind === 'mail') {
        returnFromMailDraft(draft.id);
        return;
    }
    renderList();
    renderDetail();
}
async function leaveEditor() {
    if (state.savePromise)
        await state.savePromise;
    if (isUnsavedDraft()) {
        collect();
        const choice = await new Promise(resolve => {
            modal('Unsaved draft', '<p>Save this draft before leaving?</p><div class="dialog-actions"><button data-draft-choice="cancel">Cancel</button><button data-draft-choice="discard">Discard Draft</button><button class="primary" data-draft-choice="save">Save</button></div>');
            dialog.addEventListener('close', () => resolve('cancel'), { once: true });
            dialog.querySelectorAll('[data-draft-choice]').forEach(button => button.onclick = () => { resolve(button.dataset.draftChoice); dialog.close(); });
            dialog.querySelector('[data-draft-choice="cancel"]').focus();
        });
        if (choice === 'cancel')
            throw new DraftCancelled();
        if (choice === 'discard')
            discardUnsavedDraft();
        else
            await commit(true);
    }
    else
        await commit();
}
async function commit(explicit = false) {
    clearTimeout(saveTimer);
    if (state.savePromise)
        await state.savePromise;
    if (!state.dirty || !state.current)
        return;
    collect();
    if (isUnsavedDraft() && !explicit)
        return;
    const taskOrder = state.app === 'tasks' ? [...document.querySelectorAll('#items [data-id]')].map(el => el.dataset.id) : [];
    const taskPane = activePane();
    const firstSave = isUnsavedDraft(), payload = structuredClone(state.current);
    state.dirty = false;
    const id = payload.id;
    const input = firstSave ? { kind: payload.kind, title: payload.title, body: payload.body, meta: payload.meta, ...(pendingLinkedSource?.draft === id ? { linkedTo: pendingLinkedSource.source } : {}) } : payload;
    state.savePromise = (async () => {
        try {
            const result = await api('save', input);
            if (state.current?.id === id) {
                if (firstSave) {
                    const origin = mailDraftOrigins.get(id);
                    if (origin) {
                        mailDraftOrigins.set(result.record.id, origin);
                        mailDraftOrigins.delete(id);
                    }
                    Object.assign(state.current, { id: result.record.id, revision: result.record.revision, created: result.record.created, updated: result.record.updated });
                    unsavedDraft = null;
                    pendingLinkedSource = undefined;
                    state.rows.push(state.current);
                }
                else {
                    state.current.revision = result.record.revision;
                    state.current.updated = result.record.updated;
                    const pos = state.rows.findIndex(r => r.id === id);
                    if (pos >= 0)
                        state.rows[pos] = state.current;
                }
            }
            const s = document.querySelector('#save-status');
            if (s)
                s.textContent = state.dirty ? 'Unsaved changes' : 'Saved';
            renderList();
        }
        catch (cause) {
            const error = asError(cause);
            state.dirty = true;
            const s = document.querySelector('#save-status');
            if (s)
                s.textContent = 'Save failed · keep this page open';
            throw error;
        }
        finally {
            state.savePromise = null;
        }
    })();
    await state.savePromise;
    if (state.dirty)
        await commit();
    if (state.app === 'tasks' && state.current && (firstSave || state.current.id === id) && !state.dirty) {
        if (!filteredRows().some(r => r.id === state.current?.id)) {
            const visible = navigableRows(), ids = new Set(visible.map(r => r.id)), index = taskOrder.indexOf(id);
            const next = taskOrder.slice(index + 1).find(id => ids.has(id)) || taskOrder.slice(0, Math.max(0, index)).reverse().find(id => ids.has(id));
            state.selected.delete(state.current.id);
            selectionAnchor = null;
            state.current = visible.find(r => r.id === next) || visible[0] || null;
            renderList();
            renderDetail();
            restorePane(taskPane);
        }
        else {
            const badges = document.querySelector('.task-detail-badges');
            if (badges)
                badges.innerHTML = taskBadges(state.current);
        }
    }
    if (firstSave)
        renderDetail(undefined, true);
    if (firstSave)
        void connections.section();
}
async function openConnectedRecord(id) {
    await waitForAttachments();
    await leaveEditor();
    const record = (await api(`record&id=${encodeURIComponent(id)}`)).record;
    if (!apps[record.kind])
        throw new CommandError('This item type is not available in this version.');
    rememberSelection();
    state.app = record.kind;
    state.current = null;
    state.search = '';
    state.sheet = 0;
    state.cell = 'A1';
    setMode('normal');
    location.hash = record.kind;
    if (record.kind === 'mail') {
        state.mailScope = null;
        state.mailFolder = record.meta.folder === 'Not in Inbox' ? 'Recovery copies' : record.meta.folder === 'Custom folder' ? 'all' : record.meta.folder || 'Archive';
    }
    await load(record.id, { selectFirst: record.kind !== 'mail', revealMail: record.kind === 'mail' });
    const opened = state.current;
    if (record.kind === 'mail' && opened?.id !== record.id)
        throw new CommandError('This linked item is no longer available. Reopen the connections window and try again.');
    if (record.kind === 'calendar')
        calendar.ensureVisible(record.id, true);
    focusList();
    document.querySelector('#selected-item')?.scrollIntoView({ block: 'nearest' });
}
async function changeApp(name) { await waitForAttachments(); await leaveEditor(); rememberSelection(); if (name === 'mail' && state.app !== 'mail') {
    state.mailFolder = 'Inbox';
    state.mailScope = null;
} state.app = name; state.current = null; state.search = ''; state.sheet = 0; state.cell = 'A1'; state.mode = 'normal'; location.hash = name; await load(undefined, { enteringApp: true }); }
function updateMailListItem(id) {
    const row = state.rows.find(r => r.id === id), button = document.querySelector(`#items [data-id="${CSS.escape(id)}"]`);
    if (!row || !button)
        return;
    const selected = state.current?.id === id;
    const copy = button.querySelector('.item-copy');
    if (copy)
        copy.outerHTML = renderMailListCopy(row, state.prefs.mailList, failedMailActions.get(row.id));
    button.classList.toggle('selected', selected);
    button.classList.toggle('mail-read', !!row.meta.read);
    button.classList.toggle('mail-unread', !row.meta.read);
    button.setAttribute('aria-pressed', String(selected || state.selected.has(id)));
    if (selected)
        button.id = 'selected-item';
    else
        button.removeAttribute('id');
    const label = button.querySelector('.mail-read-status .file-input');
    if (label)
        label.textContent = row.meta.read ? 'Read' : 'Unread';
}
async function selectRecord(id, focus = false) {
    const pane = activePane();
    await waitForAttachments();
    await leaveEditor();
    const previous = state.current?.id, origin = mailDraftOrigin(false);
    state.current = state.rows.find(r => r.id === id) || null;
    if (state.app === 'wiki') {
        state.wikiEditing = false;
        setMode('normal');
    }
    if (state.app === 'mail' && state.current?.meta.folder === 'Drafts' && previous !== id)
        mailDraftOrigins.set(id, origin);
    state.sheet = 0;
    state.cell = 'A1';
    if (state.app === 'mail') {
        if (!document.querySelector('#items [data-id="' + CSS.escape(id) + '"]'))
            renderList();
        if (previous)
            updateMailListItem(previous);
        if (state.current)
            updateMailListItem(state.current.id);
    }
    else
        renderList();
    if (state.app === 'calendar')
        calendar.ensureVisible(id);
    renderDetail();
    if (focus && pane === 'content') {
        focusContent();
        document.querySelector('#selected-item')?.scrollIntoView({ block: 'nearest' });
    }
    else if (focus) {
        const selected = document.querySelector('#selected-item');
        selected?.focus({ preventScroll: true });
        selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}
async function clickRecord(id, event) {
    await leaveEditor();
    if (event.shiftKey) {
        keyboardSelection = false;
        const rows = navigableRows(), to = rows.findIndex(r => r.id === id), anchor = rows.findIndex(r => r.id === (selectionAnchor || state.current?.id)), from = anchor < 0 ? to : anchor;
        if (!event.ctrlKey && !event.metaKey)
            state.selected.clear();
        for (const r of rows.slice(Math.max(0, Math.min(from, to)), Math.max(from, to) + 1))
            state.selected.add(r.id);
    }
    else if (event.ctrlKey || event.metaKey) {
        keyboardSelection = false;
        if (!state.selected.size && state.current)
            state.selected.add(state.current.id);
        if (state.selected.has(id))
            state.selected.delete(id);
        else
            state.selected.add(id);
        selectionAnchor = id;
    }
    else {
        if (!keyboardSelection)
            state.selected.clear();
        selectionAnchor = id;
    }
    renderList();
    await selectRecord(id, true);
}
function mailAccounts() { return state.accounts.filter(a => ['imap', 'google'].includes(a.type)); }
function draftAccount(context) {
    const accounts = mailAccounts();
    return [context?.meta.sendAccount, context?.meta.account, state.prefs.defaultMailAccount, accounts.length === 1 ? accounts[0].id : ''].find(id => accounts.some(a => a.id === id)) || '';
}
async function createRecord(initial = {}, { keepMailList = false, focusBody = false } = {}) {
    await waitForAttachments();
    await leaveEditor();
    const kind = state.app;
    if (!apps[kind])
        return;
    const previous = state.current;
    const origin = kind === 'mail' ? mailDraftOrigin() : undefined;
    const record = { kind: kind, title: initial.title || 'Untitled ' + apps[kind].singular, body: initial.body || '', meta: { ...(kind === 'mail' ? { folder: 'Drafts' } : {}), ...initial.meta } };
    if (kind === 'mail' && !record.meta.sendAccount)
        record.meta.sendAccount = draftAccount(previous);
    if (kind === 'calendar' && !record.meta.start) {
        const start = new Date();
        start.setMinutes(0, 0, 0);
        record.meta.start = start.toISOString();
        record.meta.end = new Date(+start + 3600000).toISOString();
    }
    if (kind === 'sheets')
        record.meta.workbook = { sheets: [{ name: 'Sheet 1', cells: {} }] };
    if (kind === 'mail' && !keepMailList) {
        state.mailScope = null;
        if (state.mailFolder !== 'all')
            state.mailFolder = 'Drafts';
    }
    try {
        const now = new Date().toISOString();
        state.current = { ...record, id: 'draft-' + crypto.randomUUID(), revision: 0, created: now, updated: now };
        unsavedDraft = state.current;
        if (origin)
            mailDraftOrigins.set(state.current.id, origin);
        state.dirty = true;
        state.wikiEditing = true;
        state.sheet = 0;
        state.cell = 'A1';
        state.selected.clear();
        selectionAnchor = null;
        keyboardSelection = false;
        renderWorkspace();
        if (kind === 'mail' && focusBody) {
            const body = document.querySelector('#detail [name="body"]');
            body?.focus();
            body?.setSelectionRange(0, 0);
            setMode('insert');
        }
        else
            enterEdit(true);
    }
    catch (cause) {
        const error = asError(cause);
        state.current = previous;
        renderDetail();
        throw error;
    }
}
function enterEdit(preferTitle = false) {
    if (state.current?.meta.remote) {
        notice('This synced copy is read-only.');
        return;
    }
    if (state.app === 'wiki' && !state.wikiEditing) {
        state.wikiEditing = true;
        renderDetail();
    }
    const target = state.app === 'sheets' ? document.querySelector('#formula') : preferTitle ? document.querySelector('.title-input') : state.app === 'documents' ? document.querySelector('#rich-editor') : document.querySelector('#detail [name=body]');
    target?.focus();
    if (target instanceof HTMLInputElement && (preferTitle || target.id === 'formula'))
        target.select();
    setMode('insert');
}
function setMode(mode) { state.mode = mode; const m = document.querySelector('#mode'); if (m)
    m.textContent = mode.toUpperCase(); }
async function attempt(fn) { try {
    return await fn();
}
catch (cause) {
    if (cause instanceof DraftCancelled)
        return;
    const error = asError(cause);
    notice(error.message, true);
} }
function modal(title, body) { dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2><button class="quiet" data-close aria-label="Close dialog">✕</button></div>${body}`; dialog.querySelector('[data-close]').onclick = () => dialog.close(); dialog.showModal(); }
function confirmation(title, message, action) { modal(title, `<p>${e(message)}</p><div class="dialog-actions"><button id="cancel">Cancel</button><button class="primary" id="confirm">${e(title)}</button></div>`); dialog.querySelector('#cancel').onclick = () => dialog.close(); dialog.querySelector('#cancel').focus(); dialog.querySelector('#confirm').onclick = async () => { dialog.close(); await attempt(action); }; }
function download(name, text, type = 'text/plain') { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function originalMail(record) { return record.meta.rawBase64 ? Uint8Array.from(atob(record.meta.rawBase64), c => c.charCodeAt(0)) : record.meta.raw || ''; }
async function viewMessageHeaders() {
    const original = state.current;
    // Read the local record only: mail-content can contact the provider.
    const record = original.summary ? (await api(`record&id=${encodeURIComponent(original.id)}`)).record : original;
    if (state.current?.id !== original.id || state.app !== 'mail')
        return;
    const headers = messageHeaders(record.meta);
    document.querySelector('#detail [data-mail-disclosure="metadata"]').open = false;
    modal('Message headers', headers ? '<div class="message-headers-tools"><label>Search headers <input type="search" data-header-search aria-describedby="header-search-help" autocomplete="off" spellcheck="false"></label><span data-header-count role="status"></span><button data-header-previous disabled>Previous</button><button data-header-next disabled>Next</button><button data-header-copy>Copy all headers</button></div><p id="header-search-help" class="recurrence-note">/ focuses search; n / p move between matches. In search, Enter / Shift+Enter move between matches.</p><p data-header-status role="status"></p><pre class="message-headers" tabindex="0" aria-label="Original message headers"></pre>' : '<p>Original message headers are unavailable for this message.</p>');
    if (headers)
        setupHeaderViewer(dialog, headers);
    dialog.addEventListener('close', () => {
        if (state.current?.id === original.id)
            document.querySelector('#detail [data-mail-disclosure="metadata"] > summary')?.focus();
    }, { once: true });
}
async function fullMailRecord(record) {
    if (record.meta.headerOnly) {
        await pendingMailReads.get(record.id);
        return (await api('mail-content', { id: record.id, account: record.meta.account })).record;
    }
    if (!record.summary)
        return record;
    const cached = latestMail(record.id);
    if (cached && !cached.summary && cached.revision === record.revision && sameMailTarget(record, cached))
        return cached;
    return (await api(`record&id=${encodeURIComponent(record.id)}`)).record;
}
async function exportRecords(all = false, selectedRecords = null) {
    await commit();
    let records = selectedRecords || (all ? state.rows : [state.current].filter(isPresent));
    if (!records.length) {
        notice('There is nothing to export yet.');
        return;
    }
    if (state.app === 'mail')
        records = await Promise.all(records.map(fullMailRecord));
    all = all || records.length > 1;
    const name = all ? state.app : records[0].title;
    if (state.app === 'calendar')
        download(name + '.ics', icsExport(records), 'text/calendar');
    else if (state.app === 'contacts')
        download(name + '.vcf', vcardExport(records), 'text/vcard');
    else if (state.app === 'sheets' && !all) {
        const sheet = workbook(records[0]).sheets[state.sheet];
        const refs = Object.keys(sheet.cells).map(ref => cellPosition(ref));
        const rows = Math.max(1, ...refs.map(x => x[0] + 1)), cols = Math.max(1, ...refs.map(x => x[1] + 1));
        download(name + '.csv', csvWrite(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => sheet.cells[colName(c) + (r + 1)] || ''))), 'text/csv');
    }
    else if (state.app === 'wiki' && !all)
        download(name + '.md', records[0].body, 'text/markdown');
    else if (state.app === 'documents' && !all)
        download(name + '.html', '<!doctype html><html lang="en"><meta charset="utf-8"><title>' + e(name) + '</title><body>' + safeDocument(records[0].body) + '</body></html>', 'text/html');
    else if (state.app === 'mail' && !all && (records[0].meta.rawBase64 || records[0].meta.raw))
        download(name + '.eml', originalMail(records[0]), 'message/rfc822');
    else
        download(name + '.json', JSON.stringify({ format: 'portable-office-items', version: 1, records }, null, 2), 'application/json');
}
async function importFile() {
    await leaveEditor();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.md,.txt,.html,.htm,.csv,.ics,.vcf,.eml';
    input.onchange = () => void attempt(async () => {
        const file = input.files?.[0];
        if (!file)
            return;
        if (file.size > 8 * 1024 * 1024)
            throw Error('Import files up to 8 MB.');
        const text = await file.text(), ext = file.name.split('.').at(-1).toLowerCase();
        let records = [];
        if (ext === 'ics' || ext === 'eml') {
            const payload = { format: ext, text: ext === 'ics' ? text : '' };
            if (ext === 'eml') {
                if (file.size > 1400000)
                    throw Error('Original EML import supports up to 1.4 MB.');
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = '';
                for (let i = 0; i < bytes.length; i += 8192)
                    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                payload.base64 = btoa(binary);
            }
            const r = await api('import', payload);
            notice(`Imported ${r.count} items locally.`);
            await load();
            return;
        }
        if (ext === 'json') {
            const data = JSON.parse(text);
            if (data.format === 'portable-office') {
                confirmation('Restore backup', 'Restore into this empty workspace? Remote copies become local archives. Accounts and credentials are not restored.', async () => { const r = await api('restore', { backup: data }); state.prefs = data.preferences || {}; applyTheme(); await load(); notice(`Restored ${r.count} items.`); });
                return;
            }
            if (data.format !== 'portable-office-items' || data.version !== 1 || !Array.isArray(data.records))
                throw Error('Unsupported JSON file.');
            records = data.records;
        }
        else if (ext === 'vcf')
            records = vcardParse(text);
        else if (ext === 'csv') {
            const rows = csvParse(text);
            if (rows.length > 100 || rows.some(r => r.length > 26))
                throw Error('CSV import supports 100 rows and 26 columns.');
            const cells = {};
            rows.forEach((row, r) => row.forEach((value, c) => { if (value)
                cells[colName(c) + (r + 1)] = value; }));
            records = [{ kind: 'sheets', title: file.name.replace(/\.csv$/i, ''), body: '', meta: { workbook: { sheets: [{ name: 'Sheet 1', cells }] } } }];
        }
        else if (['md', 'txt', 'html', 'htm'].includes(ext)) {
            const kind = state.app === 'wiki' ? 'wiki' : 'documents';
            const body = kind === 'wiki' ? text : ['html', 'htm'].includes(ext) ? safeDocument(text) : text.split('\n').map(line => '<p>' + e(line) + '</p>').join('');
            records = [{ kind, title: file.name.replace(/\.[^.]+$/, ''), body, meta: {} }];
        }
        else
            throw Error('Unsupported format.');
        if (records.length > 500)
            throw Error('Import up to 500 items at a time.');
        const result = await api('import-items', { records });
        await load();
        notice(`Imported ${result.count} items locally.`);
    });
    input.click();
}
async function syncAccounts(manual = true) {
    if (state.syncing || document.hidden || (!manual && Date.now() - state.lastActivity > 120000))
        return;
    if (!state.accounts.length) {
        if (manual) {
            notice('Add an account in Settings to start syncing.');
            await changeApp('settings');
        }
        return;
    }
    if (state.dirty) {
        if (manual)
            await commit();
        else
            return;
    }
    state.syncing = true;
    busyButton(document.querySelector('#sync-button'), true);
    let errors = 0;
    const accounts = [...state.accounts];
    const queue = accounts.map(account => ({ account, batch: 0 }));
    let next = 0;
    const active = new Map(), pendingHistory = new Set();
    const showActive = () => { const status = document.querySelector('#sync-status'); if (status)
        status.textContent = 'Syncing ' + [...active.values()].join('; ') + '…'; };
    const worker = async () => {
        while (next < queue.length) {
            if (document.hidden || (!manual && Date.now() - state.lastActivity > 120000))
                return;
            const { account: a, batch } = queue[next++];
            try {
                const batchCount = a.type === 'imap' && state.prefs.mailOffline !== true && batch > 0 ? 5 - batch : 1;
                active.set(a.id, `${a.label} · batch ${batch + 1}${pendingHistory.has(a.id) ? ' · downloading older mail' : ''}`);
                showActive();
                const result = await api('sync', { id: a.id, batches: batchCount });
                if (result.more)
                    pendingHistory.add(a.id);
                else
                    pendingHistory.delete(a.id);
                if (state.app === 'mail' && !state.dirty)
                    await load(undefined, { preserveSelection: true });
                // Give every account a first pass before continuing older history.
                if (result.more && batch + batchCount < 5 && !document.hidden)
                    queue.push({ account: a, batch: batch + batchCount });
            }
            catch (cause) {
                const error = asError(cause);
                errors++;
                if (manual)
                    notice(a.label + ': ' + error.message, true);
            }
            finally {
                active.delete(a.id);
                if (active.size)
                    showActive();
            }
        }
    };
    // Two accounts at a time leave PHP workers available for local browsing and
    // interactive requests. The per-account operation queue still serializes writes.
    try {
        await Promise.all([worker(), worker()]);
    }
    finally {
        state.syncing = false;
        busyButton(document.querySelector('#sync-button'), false);
    }
    const s = document.querySelector('#sync-status');
    if (s) {
        const checked = new Date();
        s.innerHTML = errors ? 'Sync needs attention' : pendingHistory.size ? 'Older mail remains · continues on next check' : 'Checked ' + timestampLabel(checked.toISOString(), checked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        s.title = pendingHistory.size ? 'Older messages are still being downloaded for ' + accounts.filter(a => pendingHistory.has(a.id)).map(a => a.label).join(', ') + '. Each check processes up to five batches.' : '';
    }
    state.accounts = (await api('accounts')).accounts;
    // The standard scan already refreshed Inbox/Archive/Trash. Only custom scopes
    // need another scan (or a larger requested download window).
    const scope = state.mailScope, scopeAccount = state.accounts.find(a => a.id === scope?.account), scopeFolder = scopeAccount?.folders?.find(f => f.id === scope?.folder);
    if (state.app === 'mail' && scope && !state.dirty && (scope.limit > 100 || !['Inbox', 'Archive', 'Trash'].includes(scopeFolder?.role || ''))) {
        try {
            await syncOpenFolder(mailFolderEnv());
        }
        catch (cause) {
            const error = asError(cause);
            if (manual)
                notice(error.message, true);
        }
    }
    // Never replace an active editor with network data.
    if (state.app === 'settings')
        renderSettings();
    else if (!state.dirty && !editable(document.activeElement))
        await load(undefined, { preserveSelection: state.app === 'mail' });
}
function help() { openHelp(dialog, keys(), e, () => setMode('normal')); }
async function history() { await requireSaved(); const r = await api(`history&id=${state.current.id}`); modal('Revision history', r.revisions.map(h => `<button class="history-row" data-revision="${h.revision}">Revision ${h.revision} · ${e(h.snapshot.title)}</button>`).join('') || '<p>No saved revisions.</p>'); dialog.querySelectorAll('[data-revision]').forEach(b => b.onclick = () => { const h = r.revisions.find(x => x.revision === Number(b.dataset.revision)); modal('Revision ' + h.revision, `<pre class="mail-body">${e(h.snapshot.body)}</pre><button id="restore-revision">Restore this content</button>`); dialog.querySelector('#restore-revision').onclick = () => void attempt(async () => { state.current.title = h.snapshot.title; state.current.body = h.snapshot.body; state.current.meta = h.snapshot.meta; state.dirty = true; dialog.close(); renderDetail(); await commit(); }); }); }
async function handleClick(event) {
    const disclosure = event.target.closest('[data-mail-disclosure]')?.dataset.mailDisclosure;
    document.querySelectorAll('#detail [data-mail-disclosure][open]').forEach(d => { if (d.dataset.mailDisclosure !== disclosure)
        d.open = false; });
    const mailMenu = document.querySelector('#mail-actions-menu');
    if (mailMenu?.open && !event.target.closest('#mail-actions-menu'))
        mailMenu.open = false;
    if (event.target.closest('#mail-actions-menu button') && mailMenu)
        mailMenu.open = false;
    const button = event.target.closest('button');
    if (!button)
        return;
    await attempt(async () => {
        if (button.dataset.app) {
            await changeApp(button.dataset.app);
            return;
        }
        if (button.dataset.id) {
            await clickRecord(button.dataset.id, event);
            return;
        }
        if (button.dataset.wiki) {
            const page = state.rows.find(r => r.title === button.dataset.wiki);
            if (page) {
                await selectRecord(page.id);
            }
            else {
                confirmation('Create page', `Create “${button.dataset.wiki}”?`, () => createRecord({ title: button.dataset.wiki }));
            }
            return;
        }
        if (button.dataset.cell) {
            selectCell(button.dataset.cell, true);
            return;
        }
        if (button.dataset.sheet !== undefined) {
            await commit();
            state.sheet = Number(button.dataset.sheet);
            state.cell = 'A1';
            renderDetail();
            return;
        }
        const action = button.dataset.action;
        if (action === 'connections') {
            await connections.view(true);
            return;
        }
        if (action === 'toggle-mail-folders')
            setMailFolderPanel(!document.querySelector('.shell').classList.contains('folders-open'));
        if (action === 'close-mail-folders') {
            setMailFolderPanel(false);
            document.querySelector('#mail-folders-toggle')?.focus();
        }
        if (action === 'new')
            await createRecord();
        if (action === 'save')
            await commit(true);
        if (action === 'help')
            help();
        if (action === 'sync')
            await syncAccounts();
        if (action === 'file-mail')
            await fileMail(mailFolderEnv());
        if (action === 'trash-mail')
            await deleteSelectedMail();
        if (action === 'restore-mail')
            await mailAction('restore');
        if (action === 'keep-local')
            await mailAction('keep-local');
        if (action === 'discard-copy') {
            const record = state.current;
            await connections.confirmDeletion([record], 'Discard copy', 'Permanently remove this cached recovery copy from Office? Your server mailbox is unaffected.', choices => mailAction('discard', record, choices));
        }
        if (action === 'import')
            await importFile();
        if (action === 'export')
            await exportRecords();
        if (action === 'export-all')
            await exportRecords(true);
        if (action === 'print') {
            await commit();
            window.print();
        }
        if (action === 'image')
            insertImage();
        if (action === 'link')
            insertLink();
        if (action === 'text') {
            await commit();
            const html = safeDocument(state.current.body).replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n');
            const doc = new DOMParser().parseFromString(html, 'text/html');
            download(state.current.title + '.txt', doc.body.textContent);
        }
        if (action === 'wiki-mode') {
            await commit();
            state.wikiEditing = !state.wikiEditing;
            renderDetail();
            if (state.wikiEditing)
                enterEdit();
            else
                setMode('normal');
        }
        if (action === 'history')
            await history();
        if (action === 'delete') {
            if (state.savePromise)
                await state.savePromise;
            if (isUnsavedDraft()) {
                confirmation('Discard Draft', 'Discard this unsaved draft?', discardUnsavedDraft);
                return;
            }
            if (state.app === 'mail')
                await deleteSelectedMail();
            else {
                await commit();
                const record = state.current;
                await connections.confirmDeletion([record], 'Delete item', 'Delete this item and its revision history? Export a copy first if you need it.', async (choices) => { await commit(); const reload = mailDeletionReload(); await api('delete', { id: record.id, revision: record.revision, ...choices[record.id] }); await reload([record.id]); notice('Item deleted.'); });
            }
        }
        if (action === 'logout')
            await signOut();
        if (action === 'message-headers')
            await viewMessageHeaders();
        if (action === 'eml') {
            const record = await fullMailRecord(state.current);
            download(record.title + '.eml', originalMail(record), 'message/rfc822');
        }
        if (action === 'original-ics')
            download(state.current.title + '.ics', state.current.meta.rawIcs || state.current.meta.raw || '', 'text/calendar');
        if (action === 'read')
            await readMail();
        if (action === 'archive')
            await archiveLocal();
        if (action === 'reply') {
            const original = state.current;
            const r = original.meta.headerOnly ? await fullMailRecord(original) : original;
            if (state.current?.id !== original.id)
                return;
            const match = (r.meta.from || '').match(/<([^>]+)>/);
            await createRecord({ title: /^Re:/i.test(r.title) ? r.title : 'Re: ' + r.title, body: '\n\nOn ' + (r.meta.date || '') + ', ' + (r.meta.from || '') + ' wrote:\n' + r.body.split('\n').map(l => '> ' + l).join('\n'), meta: { to: match ? match[1] : r.meta.from } }, { keepMailList: true, focusBody: true });
        }
        if (action === 'forward') {
            const original = state.current;
            await waitForAttachments();
            await commit();
            await pendingMailReads.get(original.id);
            const origin = mailDraftOrigin();
            const source = original.meta.headerOnly ? await fullMailRecord(original) : original;
            const response = await api('mail-files', { id: source.id, action: 'forward' });
            mailDraftOrigins.set(response.record.id, origin);
            if (state.app !== 'mail' || state.current?.id !== original.id)
                return;
            state.mailScope = null;
            state.mailFolder = 'Drafts';
            await load(response.record.id);
            enterEdit();
        }
        if (action === 'send')
            await sendMail();
        if (action === 'add-sheet') {
            await commit();
            const w = workbook(state.current);
            if (w.sheets.length >= 10)
                throw Error('Up to 10 sheets per workbook.');
            w.sheets.push({ name: 'Sheet ' + (w.sheets.length + 1), cells: {} });
            state.sheet = w.sheets.length - 1;
            state.cell = 'A1';
            renderDetail();
            markDirty();
        }
        if (action === 'rename-sheet') {
            modal('Rename sheet', `<form id="rename-form">${field('Name', 'name', workbook(state.current).sheets[state.sheet].name, 'text', 'required maxlength="60"')}<button class="primary">Rename</button></form>`);
            dialog.querySelector('form').onsubmit = ev => { ev.preventDefault(); collect(); workbook(state.current).sheets[state.sheet].name = new FormData(ev.target).get('name'); dialog.close(); renderDetail(); markDirty(); };
        }
    });
}
async function sendMail() {
    const record = state.current;
    if (sendingMail || dialog.open || state.app !== 'mail' || !record || record.meta.remote || record.meta.folder !== 'Drafts')
        return;
    const form = document.querySelector('#record-form');
    if (!form || !form.reportValidity())
        return;
    sendingMail = true;
    busyButton(document.querySelector('#detail [data-action="send"]'), true);
    try {
        await waitForAttachments();
        await requireSaved();
        if (state.app !== 'mail' || state.current?.id !== record.id)
            return;
        if (!mailAccounts().some(a => a.id === record.meta.sendAccount))
            throw Error('Choose a sending account first.');
        if (state.prefs.confirmBeforeSend !== false) {
            const confirmed = await new Promise(resolve => {
                confirmation('Send message', `Send this saved draft to ${record.meta.to}?`, () => resolve(true));
                dialog.addEventListener('close', () => resolve(false), { once: true });
            });
            if (!confirmed)
                return;
        }
        try {
            await api('send', { id: record.id, revision: record.revision, account: record.meta.sendAccount });
            if (state.app === 'mail' && state.current?.id === record.id && !state.dirty && !state.savePromise) {
                returnFromMailDraft(record.id);
                await load(state.current?.id);
            }
            else
                mailDraftOrigins.delete(record.id);
            notice('Message accepted by the provider.');
        }
        finally {
            if (state.app === 'mail' && state.current?.id === record.id && !state.dirty && !state.savePromise)
                await load();
        }
    }
    finally {
        sendingMail = false;
        busyButton(document.querySelector('#detail [data-action="send"]'), false);
    }
}
async function deleteSelectedMail() {
    if (state.app !== 'mail')
        return;
    if (isUnsavedDraft()) {
        document.querySelector('#detail [data-action="delete"]')?.click();
        return;
    }
    await commit();
    const visible = filteredRows();
    const rows = state.selected.size ? visible.filter(r => state.selected.has(r.id)) : [state.current].filter(isPresent);
    if (!rows.length)
        return;
    const protectedMail = (r) => r.meta.remote && ['Trash', 'Recovery copies', 'Not in Inbox'].includes(r.meta.folder || '');
    if (rows.some(protectedMail)) {
        if (rows.length === 1)
            throw Error(rows[0].meta.folder === 'Trash' ? 'This email is already in Trash. Use Restore to Inbox to return it to your inbox.' : 'This is a recovery copy. Use Save locally to keep it or Discard copy to remove only the cached copy.');
        throw Error('The selection includes messages in Trash or recovery copies. Deselect them before deleting.');
    }
    const ids = rows.map(r => r.id), local = rows.filter(r => !r.meta.remote).length;
    const apply = async (choices) => {
        if (state.app !== 'mail')
            throw Error('The application changed. Select the messages again.');
        await commit();
        const current = ids.map(id => state.rows.find(r => r.id === id));
        if (current.some(r => !r || protectedMail(r) || !!r.meta.remote !== !!rows.find(original => original.id === r.id).meta.remote))
            throw Error('The selected messages changed. Select them again.');
        await deleteMailImmediately(current.filter(isPresent), r => r.meta.remote ? api('mail-action', { id: r.id, revision: r.revision, action: 'trash', undoable: true }) : api('delete', { id: r.id, revision: r.revision, undoable: true, ...choices[r.id] }), true);
        notice(rows.length === 1 ? (local ? 'Item deleted.' : 'Moved to Trash.') : `${rows.length} items updated.`);
    };
    const singleDraft = rows.length === 1 && rows[0].meta.folder === 'Drafts';
    await connections.confirmDeletion(rows, singleDraft ? 'Discard Draft' : local ? (rows.length === 1 ? 'Delete item' : 'Delete selected messages') : 'Move to Trash', singleDraft ? 'Discard this saved draft? Undo is available for fifteen minutes.' : `Delete ${local} local message(s)${local < rows.length ? ` and move ${rows.length - local} provider message(s) to Trash` : ''}? Undo is available for fifteen minutes.`, apply, !local);
}
async function archiveLocal() {
    if (state.app !== 'mail')
        return;
    await commit();
    const ids = state.selected.size ? [...state.selected] : [state.current?.id].filter(isPresent);
    let count = 0;
    const rows = ids.map(id => state.rows.find(r => r.id === id)).filter(isPresent);
    if (rows.length && rows.every(r => r.meta.remote && r.meta.folder !== 'Archive')) {
        await deleteMailImmediately(rows, r => api('mail-action', { id: r.id, revision: r.revision, action: 'archive' }));
        notice(`Archived ${rows.length} messages.`);
        return;
    }
    const reconciled = new Set(), reload = mailDeletionReload();
    try {
        for (const id of ids) {
            if (reconciled.has(id)) {
                count++;
                continue;
            }
            const r = state.rows.find(r => r.id === id);
            await pendingMailReads.get(id);
            if (r.meta.remote) {
                const result = await api('mail-action', { id: r.id, revision: r.revision, action: 'archive' });
                for (const related of result.removedIds || [])
                    reconciled.add(related);
            }
            else {
                r.meta.folder = 'Archive';
                await api('save', r);
            }
            count++;
        }
    }
    catch (cause) {
        const error = asError(cause);
        // The provider check may have corrected cached membership even when the move failed.
        try {
            await load();
        }
        catch { }
        throw error;
    }
    await reload(ids);
    notice(`Archived ${count} messages.`);
}
async function mailAction(action, record = state.current, choices = {}) {
    if (state.app !== 'mail' || !record)
        return;
    await commit();
    if (['trash', 'discard'].includes(action)) {
        await deleteMailImmediately([record], r => api('mail-action', { id: r.id, revision: r.revision, action, undoable: action === 'trash', ...choices[r.id] }), action === 'trash');
        notice(action === 'trash' ? 'Moved to Trash.' : 'Cached copy discarded.');
        return;
    }
    const reload = mailDeletionReload(), removed = [];
    try {
        await api('mail-action', { id: record.id, revision: record.revision, action });
        if (['trash', 'discard'].includes(action))
            removed.push(record.id);
    }
    finally {
        await reload(removed);
    }
    notice(action === 'keep-local' ? 'Saved in Local mail.' : action === 'discard' ? 'Cached copy discarded.' : action === 'trash' ? 'Moved to Trash.' : 'Restored to Inbox.');
}
async function repairMail(accountId, button) {
    if (state.syncing) {
        notice('Wait for the current sync to finish.', true);
        return;
    }
    await commit();
    state.syncing = true;
    busyButton(button, true);
    busyButton(document.querySelector('#sync-button'), true);
    try {
        await api('sync', { id: accountId, repair: true });
        notice('Mail folders resynchronized. Local mail and credentials were kept.');
    }
    catch (cause) {
        const error = asError(cause);
        notice(error.message, true);
    }
    finally {
        state.syncing = false;
        busyButton(button, false);
        busyButton(document.querySelector('#sync-button'), false);
        state.accounts = (await api('accounts')).accounts;
        if (state.app === 'settings')
            renderSettings();
        else
            await load();
    }
}
function applyMailReadResult(original, previousRevision, updated) {
    const identity = (row) => JSON.stringify([row.id, row.kind, ...['remote', 'account', 'source', 'serverFolder', 'uidValidity', 'providerId', 'folder'].map(key => row.meta[key])]);
    if (identity(original) !== identity(updated))
        return;
    const update = (row) => {
        if (row && identity(row) === identity(original) && row.revision <= updated.revision && (row.revision === previousRevision || sameMailTarget(row, updated))) {
            row.meta.read = updated.meta.read;
            row.revision = updated.revision;
            row.updated = updated.updated;
        }
    };
    update(original);
    if (state.app === 'mail') {
        state.rows.forEach(update);
        update(state.current);
        updateMailListItem(original.id);
        if (state.current?.id === original.id) {
            const button = document.querySelector('#detail [data-action="read"]');
            if (button)
                button.textContent = `Mark ${state.current.meta.read ? 'unread' : 'read'}`;
        }
    }
}
async function setMailRead(record, read) {
    await pendingMailReads.get(record.id);
    const current = state.app === 'mail' ? state.rows.find(row => row.id === record.id) : undefined;
    const target = current || record, previousRevision = target.revision;
    const snapshot = structuredClone(target);
    mailReadVersion++;
    const pending = (async () => {
        try {
            const result = await api(target.meta.remote ? 'mail-action' : 'save', target.meta.remote ? { id: target.id, revision: previousRevision, action: read ? 'read' : 'unread' } : { ...snapshot, meta: { ...snapshot.meta, read } });
            if (!result.record)
                throw Error('The server did not return the updated message.');
            applyMailReadResult(snapshot, previousRevision, result.record);
            return { ...result, record: result.record, previousRevision };
        }
        finally {
            pendingMailReads.delete(record.id);
            mailReadVersion++;
        }
    })();
    pendingMailReads.set(record.id, pending);
    await pending;
}
function markOpenedMailRead(record) {
    if (record.meta.read || ['Drafts', 'Sending', 'Delivery uncertain', 'Recovery copies', 'Not in Inbox'].includes(record.meta.folder || '') || pendingMailReads.has(record.id))
        return;
    const previousRevision = record.revision;
    mailReadVersion++;
    // Rendering and navigation remain synchronous; only mutations of this message wait.
    const pending = (async () => {
        try {
            const result = await api(record.meta.remote ? 'mail-action' : 'save', record.meta.remote ? { id: record.id, revision: previousRevision, action: 'read' } : { ...record, meta: { ...record.meta, read: true } });
            const updatedRecord = result.record;
            if (!updatedRecord)
                throw Error('The server did not return the updated message.');
            applyMailReadResult(record, previousRevision, updatedRecord);
            return { ...result, record: updatedRecord, previousRevision };
        }
        catch (cause) {
            const error = asError(cause);
            notice('Could not mark message as read: ' + error.message, true);
        }
        finally {
            pendingMailReads.delete(record.id);
            mailReadVersion++;
        }
    })();
    pendingMailReads.set(record.id, pending);
}
async function readMail() {
    if (state.app !== 'mail' || !state.current)
        return;
    await commit();
    const r = state.current;
    await pendingMailReads.get(r.id);
    await setMailRead(r, !r.meta.read);
}
function editorSelection() {
    const editor = document.querySelector('#rich-editor'), selection = getSelection();
    const range = selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0).cloneRange() : null;
    return () => { if (!document.contains(editor))
        throw Error('The document changed before insertion. Reopen it and try again.'); editor.focus(); const selection = getSelection(); selection.removeAllRanges(); if (range)
        selection.addRange(range);
    else {
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        selection.addRange(end);
    } };
}
function insertImage() {
    const restore = editorSelection(), input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => void attempt(async () => { const file = input.files?.[0]; if (!file)
        return; if (file.size > 900000)
        throw Error('Choose an image smaller than 900 KB.'); if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type))
        throw Error('Use PNG, JPEG, GIF or WebP.'); const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Cannot read image.')); reader.readAsDataURL(file); }); restore(); document.execCommand('insertHTML', false, safeDocument('<img src="' + e(data) + '" alt="' + e(file.name) + '">')); markDirty(); });
    input.click();
}
function insertLink() {
    const restore = editorSelection();
    modal('Insert link', `<form id="link-form">${field('URL', 'url', 'https://', 'url', 'required')}<button class="primary">Apply link to selection</button></form>`);
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); const url = new FormData(event.target).get('url'); if (!/^(https?:|mailto:)/i.test(url)) {
        notice('Use an HTTP(S) or mailto URL.', true);
        return;
    } dialog.close(); restore(); if (getSelection().isCollapsed)
        document.execCommand('insertHTML', false, '<a href="' + e(url) + '" rel="noreferrer noopener">' + e(url) + '</a>');
    else
        document.execCommand('createLink', false, url); markDirty(); };
}
function renderSettings() {
    renderAppHeader();
    const p = state.prefs;
    document.querySelector('#main').innerHTML = `<div class="settings"><p class="settings-intro">Preferences, connected accounts, and backups.</p><div class="settings-grid"><section class="card"><h2>Look & feel</h2><p>Choose a theme, accent color, and density.</p><form id="preferences"><label>Theme<select name="theme" aria-label="Theme">${['system', 'light', 'dark'].map(x => `<option ${p.theme === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Accent<select name="accent" aria-label="Accent">${['green', 'blue', 'plum'].map(x => `<option ${p.accent === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Density<select name="density" aria-label="Density"><option value="comfortable">Comfortable</option><option value="compact" ${p.density === 'compact' ? 'selected' : ''}>Compact</option></select></label><label class="check-label"><input type="checkbox" name="showElapsedTime" ${p.showElapsedTime !== false ? 'checked' : ''}> Show elapsed time beside dates</label><button class="primary">Save preferences</button></form></section><section class="card"><h2>Data and backups</h2><p>Your database and content live inside this application folder. Backups include local records, cached messages, revisions and preferences. Account credentials and your password are excluded.</p><button id="backup">↓ Download full backup</button><p>Restore into an empty installation. Synced copies become local archives; reconnect providers separately. Never copy a live SQLite file as a backup.</p><button id="restore">↑ Restore backup</button><p>Documents: basic formatting and HTML/text. Calendar: Month, Week, Day and Agenda views; no local recurrence expansion or invitations. Sheets: simple formulas. See README for version limits.</p></section><section class="card full"><h2>Mail</h2><form id="mail-preferences"><label>Default email display<select name="mailDisplay" aria-label="Default email display"><option value="html" ${p.mailDisplay !== 'text' ? 'selected' : ''}>HTML</option><option value="text" ${p.mailDisplay === 'text' ? 'selected' : ''}>Text only</option></select></label><label class="check-label"><input type="checkbox" name="mailOffline" ${p.mailOffline === true ? 'checked' : ''}> Download message contents during sync for offline use</label><label>Default mail account<select name="defaultMailAccount" aria-label="Default mail account"><option value="">Automatic (only account, when available)</option>${mailAccounts().map(a => `<option value="${e(a.id)}" ${p.defaultMailAccount === a.id ? 'selected' : ''}>${e(a.label)}</option>`).join('')}</select></label><p>New drafts use the selected message’s account first, then this default. Saved drafts keep their chosen account.</p><button class="primary">Save mail preferences</button></form></section><section class="card full" id="google-integration"><h2>Google integration</h2><p>Loading…</p></section><section class="card full"><h2>Connected accounts</h2><p>Only checked while this page is visible and you have used it within two minutes. Automatic checks every two minutes; Sync now is always available. Inbox, Archive and Trash: headers download in resumable batches of 100, including older history. Message bodies download when opened, or during sync when offline downloads are enabled. Folder membership is reconciled against the server. Agenda: previous week through next 90 days, up to 100 events. Previously downloaded mail remains available offline.</p><div>${state.accounts.map(a => `<div class="account"><div><strong>${e(a.label)} <span class="badge">${e(a.type)}</span></strong><small>${a.last_sync ? 'Last checked ' + timestampLabel(a.last_sync, new Date(a.last_sync).toLocaleString()) : 'Not checked yet'}${a.error ? ' · ' + e(a.error) : ''}</small></div><div class="actions">${['imap', 'google'].includes(a.type) ? `<button data-repair-account="${a.id}">Repair / resync</button>` : ''}${a.type === 'google' ? `<button data-google="${a.id}">Authorize</button>` : ''}<button class="danger quiet" data-remove-account="${a.id}">Remove</button></div></div>`).join('') || '<p>No accounts connected. Your local apps work without a provider.</p>'}</div><button id="add-account">+ Add account</button><label class="check-label"><input id="keep-recovery" type="checkbox" ${p.keepRecoveryCopies !== false ? 'checked' : ''}> Keep recovery copies of messages absent from synchronized folders</label><p>Recovery copies are excluded from All cached mail. Save them in Local mail or discard them. Turning this off removes absent cached copies on the next successful sync; local mail is kept.</p><p>IMAP uses TLS port 993; SMTP uses TLS port 465 with the same credentials. CalDAV requires the calendar collection URL. Public hostnames only. For Gmail email without Google integration setup, choose Gmail — app password in Add account. For Google sign-in and optional Calendar access, configure Google integration once above.</p></section><section class="card full"><h2>Keyboard bindings</h2><p>Home-row navigation is on by default. Remap single-character actions below. Full Vim text operators and visual selections inside document editors are future work.</p><form id="key-form"><div class="fields">${Object.entries(defaultKeys).map(([action, key]) => field(action, 'key_' + action, keys()[action], 'text', 'required maxlength="1"')).join('')}</div><button class="primary">Save bindings</button></form></section></div></div>`;
    document.querySelector('#mail-preferences').closest('section').insertAdjacentHTML('afterend', '<section class="card full" id="mail-list-settings"></section>');
    bindMailListSettings(document.querySelector('#mail-list-settings'), p.mailList, async (layout) => { await attempt(async () => { const preferences = { ...state.prefs, mailList: layout }; await api('preferences', { preferences }); state.prefs = preferences; notice('List appearance saved.'); }); });
    document.querySelector('#mail-preferences button').insertAdjacentHTML('beforebegin', `<label class="check-label"><input type="checkbox" name="confirmBeforeSend" ${p.confirmBeforeSend !== false ? 'checked' : ''}> Confirm before sending</label>`);
    void renderGoogleSettings(document.querySelector('#google-integration'), api);
    document.querySelector('#preferences').onsubmit = ev => { ev.preventDefault(); void attempt(async () => { const form = ev.target, preferences = { ...state.prefs, ...Object.fromEntries(new FormData(form)), showElapsedTime: form.elements.namedItem('showElapsedTime').checked }; await api('preferences', { preferences }); state.prefs = preferences; applyTheme(); notice('Preferences saved.'); }); };
    document.querySelector('#mail-preferences').onsubmit = event => { event.preventDefault(); void attempt(async () => { const preferences = { ...state.prefs, ...Object.fromEntries(new FormData(event.target)), mailOffline: event.target.elements.namedItem('mailOffline').checked, confirmBeforeSend: event.target.elements.namedItem('confirmBeforeSend').checked }; await api('preferences', { preferences }); state.prefs = preferences; notice('Mail preferences saved.'); }); };
    document.querySelector('#key-form').onsubmit = ev => { ev.preventDefault(); void attempt(async () => { const map = Object.fromEntries([...new FormData(ev.target)].map(([k, v]) => [k.slice(4), v])); if (new Set(Object.values(map)).size !== Object.values(map).length)
        throw Error('Choose a different key for each action.'); if (Object.values(map).some(v => 'gGnN0123456789'.includes(v) || /\s/.test(v)))
        throw Error('g/G, n/N, numbers and whitespace are reserved.'); state.prefs.keys = map; await api('preferences', { preferences: state.prefs }); notice('Bindings saved.'); }); };
    document.querySelector('#backup').onclick = () => void attempt(async () => download('office-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(await api('backup'), null, 2), 'application/json'));
    document.querySelector('#restore').onclick = () => void attempt(importFile);
    document.querySelector('#add-account').onclick = accountDialog;
    document.querySelector('#keep-recovery').onchange = event => void attempt(async () => { state.prefs = { ...state.prefs, keepRecoveryCopies: event.target.checked }; await api('preferences', { preferences: state.prefs }); notice('Recovery preference saved.'); });
    document.querySelectorAll('[data-repair-account]').forEach(b => b.onclick = () => void repairMail(b.dataset.repairAccount, b));
    document.querySelectorAll('[data-google]').forEach(b => b.onclick = () => void attempt(async () => { const r = await api('google-connect', { id: b.dataset.google }); location.href = r.url; }));
    document.querySelectorAll('[data-remove-account]').forEach(b => b.onclick = () => confirmation('Remove account', 'Remove the saved credentials and downloaded cache from this workspace? The provider account is unaffected.', async () => { await api('account-delete', { id: b.dataset.removeAccount }); state.accounts = (await api('accounts')).accounts; renderSettings(); }));
}
function accountDialog() {
    openAccountSetup({ dialog, request: api, onSaved: async () => {
            state.accounts = (await api('accounts')).accounts;
            renderSettings();
        } });
}
const itemMenus = installItemMenus({ confirmDeletion: connections.confirmDeletion, state, e, commit: leaveEditor, renderList, selectRecord, enterEdit, api, load, mailDeletionReload, deleteMailImmediately, notice, confirmation, attempt, exportRecords, setMailRead, waitForMailRead: id => pendingMailReads.get(id), capturePane: () => { const pane = activePane(); return () => restorePane(pane); }, mouseSelection: () => { keyboardSelection = false; }, fileMail: () => fileMail(mailFolderEnv()) });
function contentEntry() {
    const panel = document.querySelector('#detail');
    return panel?.querySelector('.mail-html, .mail-body, .sheet-wrap') || panel;
}
function focusContent() {
    if (!state.current)
        return;
    const entry = contentEntry();
    if (entry) {
        entry.tabIndex = -1;
        entry.focus({ preventScroll: true });
    }
}
function focusList() {
    const entry = document.querySelector('#selected-item') || document.querySelector('#items') || document.querySelector('#main');
    if (entry) {
        if (entry.id !== 'selected-item')
            entry.tabIndex = -1;
        entry.focus({ preventScroll: true });
    }
}
const keyboardScrollers = new WeakMap();
function scrollMailBody(target, direction) {
    const frame = target.closest('.mail-html');
    if (frame) {
        frame.contentWindow?.postMessage({ type: 'office-mail-scroll', direction }, '*');
        return;
    }
    const panel = document.querySelector('#detail');
    if (!panel)
        return;
    let scroll = keyboardScrollers.get(panel);
    if (!scroll) {
        scroll = createKeyboardScroller(panel);
        keyboardScrollers.set(panel, scroll);
    }
    scroll(direction);
}
function scrollFocusedPane(target, direction) {
    if (target.closest('.mail-html')) {
        scrollMailBody(target, direction);
        return;
    }
    const pane = target.closest('#items,#detail') || document.querySelector(activePane() === 'content' ? '#detail' : '#items');
    if (!pane)
        return false;
    let panel = pane;
    for (let node = target; node && pane.contains(node); node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
            panel = node;
            break;
        }
        if (node === pane)
            break;
    }
    let scroll = keyboardScrollers.get(panel);
    if (!scroll) {
        scroll = createKeyboardScroller(panel);
        keyboardScrollers.set(panel, scroll);
    }
    scroll(direction);
    return true;
}
let lastPane = 'list';
function activePane() { const node = document.activeElement; if (node?.closest('#detail'))
    return 'content'; if (node?.closest('#items'))
    return 'list'; return lastPane; }
document.addEventListener('focusin', event => { const node = event.target; if (node.closest('#detail'))
    lastPane = 'content';
else if (node.closest('#items'))
    lastPane = 'list'; });
function restorePane(pane) {
    if (pane === 'content') {
        if (state.current)
            focusContent();
        else {
            const panel = document.querySelector(state.app === 'calendar' ? '#items' : '#detail');
            if (panel) {
                panel.tabIndex = -1;
                panel.focus({ preventScroll: true });
            }
        }
    }
    else
        focusList();
}
document.addEventListener('keydown', event => {
    if (event.defaultPrevented)
        return;
    if (commandInput) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeCommand(true);
        }
        return;
    }
    if (!document.querySelector('.shell'))
        return;
    state.lastActivity = Date.now();
    if (document.querySelector('dialog[open]'))
        return;
    const mailMenu = document.querySelector('#mail-actions-menu');
    if (event.key === 'Escape' && mailMenu?.open) {
        mailMenu.open = false;
        mailMenu.querySelector('summary').focus();
        event.preventDefault();
        return;
    }
    if (event.target.closest('#mail-actions-menu'))
        return;
    if (event.target.closest('[data-mail-disclosure]'))
        return;
    if (event.key === 'Enter' && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && state.app === 'mail' && state.current?.meta.folder === 'Drafts' && !state.current.meta.remote) {
        event.preventDefault();
        if (!event.repeat)
            void attempt(sendMail);
        return;
    }
    if (event.key === 'Escape' && document.querySelector('.shell')?.classList.contains('folders-open')) {
        setMailFolderPanel(false);
        document.querySelector('#mail-folders-toggle')?.focus();
        event.preventDefault();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void attempt(() => commit(true));
        return;
    }
    if (event.key === 'Escape') {
        setMode('normal');
        if (editable(event.target)) {
            event.target.blur();
            setMode('normal');
            event.preventDefault();
            void attempt(commit);
            if (event.target.id === 'formula')
                selectCell(state.cell, true);
        }
        else {
            const pane = activePane();
            state.selected.clear();
            if (state.app !== 'settings') {
                renderList();
                restorePane(pane);
            }
        }
        return;
    }
    if (editable(event.target)) {
        setMode('insert');
        return;
    }
    const vimDirection = vimScrollDirection(event);
    if (vimDirection) {
        if (scrollFocusedPane(event.target, vimDirection) !== false) {
            event.preventDefault();
            keySequence = '';
        }
        return;
    }
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
        return;
    if (event.target.closest('button:not(#items [data-id]):not([data-cell]),a,summary,select,input') && ['Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
        return;
    const target = event.target;
    if (event.key === 'Tab' && !event.shiftKey && (target.matches('#selected-item') || state.current && target.id === 'items')) {
        event.preventDefault();
        keySequence = '';
        focusContent();
        return;
    }
    if (event.key === 'Tab' && event.shiftKey && target === contentEntry()) {
        event.preventDefault();
        keySequence = '';
        focusList();
        return;
    }
    if (event.key === ':' && !event.isComposing && state.mode === 'normal') {
        event.preventDefault();
        if (!event.repeat)
            openCommand();
        return;
    }
    const k = keys(), key = event.key;
    setMode('normal');
    const mailBody = state.app === 'mail' && state.current && state.current.meta.folder !== 'Drafts' && !!target.closest('.mail-body,.mail-html');
    if (Date.now() - sequenceTime > 900)
        keySequence = '';
    sequenceTime = Date.now();
    if (event.repeat && key === 'g') {
        event.preventDefault();
        return;
    }
    if (keySequence === 'g' && /^[1-7]$/.test(key)) {
        event.preventDefault();
        keySequence = '';
        void attempt(() => changeApp(Object.keys(apps)[Number(key) - 1]));
        return;
    }
    if (keySequence === 'g' && key === 'g') {
        keySequence = '';
        event.preventDefault();
        if (mailBody) {
            scrollMailBody(target, 'start');
            return;
        }
        const row = navigableRows()[0];
        if (row)
            void attempt(() => selectRecord(row.id, true));
        return;
    }
    if (key === 'g') {
        keySequence = 'g';
        event.preventDefault();
        return;
    }
    keySequence = '';
    const listArrow = activePane() === 'list' ? (key === 'ArrowUp' || key === 'ArrowLeft' ? 'up' : key === 'ArrowDown' || key === 'ArrowRight' ? 'down' : undefined) : undefined;
    const action = listArrow || Object.keys(k).find(action => k[action] === key);
    if (action === 'pageDown' || action === 'pageUp') {
        if (scrollFocusedPane(target, action === 'pageDown' ? 'half-page-down' : 'half-page-up') !== false)
            event.preventDefault();
        return;
    }
    const scrollKey = { ArrowUp: 'up', ArrowDown: 'down', PageUp: 'page-up', PageDown: 'page-down', Home: 'start', End: 'end' };
    if (mailBody && scrollKey[key]) {
        event.preventDefault();
        scrollMailBody(target, scrollKey[key]);
        return;
    }
    if (event.repeat && action && !['down', 'up', 'left', 'right'].includes(action)) {
        event.preventDefault();
        return;
    }
    if (mailBody && (action === 'down' || action === 'up' || key === 'G')) {
        event.preventDefault();
        scrollMailBody(target, key === 'G' ? 'end' : action === 'up' ? 'up' : 'down');
        return;
    }
    if (action === 'help') {
        event.preventDefault();
        help();
        return;
    }
    if (state.app === 'settings')
        return;
    if (action === 'search') {
        event.preventDefault();
        document.querySelector('#search')?.focus();
        return;
    }
    if (action === 'new') {
        event.preventDefault();
        void attempt(createRecord);
        return;
    }
    if (action === 'completeTask' && state.app === 'tasks' && !event.shiftKey) {
        event.preventDefault();
        void attempt(completeTask);
        return;
    }
    if (action === 'edit' || (state.app === 'sheets' && key === 'Enter')) {
        event.preventDefault();
        enterEdit();
        return;
    }
    if (action === 'save') {
        event.preventDefault();
        void attempt(() => commit(true));
        return;
    }
    if (action === 'delete') {
        event.preventDefault();
        if (!event.repeat) {
            if (state.app === 'mail')
                void attempt(deleteSelectedMail);
            else if (state.current)
                document.querySelector('#detail [data-action="delete"]')?.click();
        }
        return;
    }
    if (action === 'undoDelete' && state.app === 'mail') {
        event.preventDefault();
        if (!event.repeat && !event.isComposing)
            void attempt(undoMailDelete);
        return;
    }
    if (action === 'archive') {
        event.preventDefault();
        if (event.repeat)
            return;
        void attempt(archiveLocal);
        return;
    }
    if (action === 'move' && state.app === 'mail') {
        event.preventDefault();
        if (!event.repeat)
            void attempt(() => quickMoveMail(mailFolderEnv()));
        return;
    }
    if (action === 'reply' && state.app === 'mail') {
        event.preventDefault();
        document.querySelector('[data-action=reply]')?.click();
        return;
    }
    if (action === 'select' && state.current) {
        event.preventDefault();
        const id = state.current.id;
        selectionAnchor = id;
        keyboardSelection = true;
        if (state.selected.has(id))
            state.selected.delete(id);
        else
            state.selected.add(id);
        const pane = activePane();
        renderList();
        restorePane(pane);
        return;
    }
    if (state.app === 'sheets' && state.current && target.closest('[data-cell]') && (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Tab'].includes(key))) {
        event.preventDefault();
        let [r, c] = cellPosition(state.cell);
        if (key === 'ArrowLeft' || key === 'Tab' && event.shiftKey)
            c--;
        else if (key === 'ArrowRight' || key === 'Tab')
            c++;
        else if (key === 'ArrowUp')
            r--;
        else
            r++;
        selectCell(colName(Math.max(0, Math.min(11, c))) + (Math.max(0, Math.min(29, r)) + 1), true);
        return;
    }
    if (action === 'left') {
        event.preventDefault();
        focusList();
        return;
    }
    if (action === 'right') {
        event.preventDefault();
        if (state.app === 'sheets' && state.current)
            selectCell(state.cell, true);
        else
            focusContent();
        return;
    }
    if (action === 'down' || action === 'up' || key === 'n' || key === 'N' || key === 'G') {
        event.preventDefault();
        const rows = navigableRows();
        const index = rows.findIndex(r => r.id === state.current?.id);
        const next = key === 'G' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (action === 'up' || key === 'N' ? -1 : 1)));
        if (rows[next])
            void attempt(() => selectRecord(rows[next].id, true));
    }
});
document.addEventListener('focusin', event => { if (event.target.id !== 'command-input' && editable(event.target))
    setMode('insert'); });
document.addEventListener('pointerdown', () => state.lastActivity = Date.now(), { passive: true });
document.addEventListener('wheel', () => state.lastActivity = Date.now(), { passive: true });
window.addEventListener('beforeunload', event => { if (state.dirty || state.savePromise) {
    event.preventDefault();
    event.returnValue = '';
} });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
let mailCalendarDay = new Date().toDateString();
function refreshMailCalendarDay() { const day = new Date().toDateString(); if (day !== mailCalendarDay) {
    mailCalendarDay = day;
    if (state.app === 'mail' && document.querySelector('#items'))
        renderList();
} }
setInterval(refreshMailCalendarDay, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden)
    refreshMailCalendarDay(); });
window.addEventListener('focus', refreshMailCalendarDay);
setInterval(() => { if (document.querySelector('.shell'))
    void attempt(() => syncAccounts(false)); }, 120000);
void boot();
