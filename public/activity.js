// Generated from frontend/activity.ts by pnpm build. Do not edit.
import { asError, isPresent } from './utils.js';
import { escapeHtml as e } from './formats.js';
import { timestampLabel, timestampText } from './time-labels.js';
export function createActivity({ csrf, keys = () => ({ down: 'j', up: 'k' }), openItem, onSessionExpired }) {
    const bar = document.querySelector('#activity-status'), status = document.querySelector('#notice'), button = document.querySelector('#view-activity'), dialog = document.querySelector('#activity-dialog');
    let enabled = false, entries = [], cursor = 0, polling = false, generation = 0, lastMessage = 'Ready.', lastError = false, sequence = 0;
    const tasks = new Map();
    let idle = true, localErrorHeld = false, commandErrorHeld = false, idleTimer;
    let selectedId, keySequence = '', sequenceTime = 0;
    function selectEntry(id, scroll = false) {
        if (id !== selectedId)
            dialog.querySelector('#activity-feedback').textContent = '';
        selectedId = id;
        const list = dialog.querySelector('#activity-entries');
        list.querySelectorAll('[data-entry-id]').forEach(row => row.setAttribute('aria-selected', String(Number(row.dataset.entryId) === id)));
        if (id === undefined)
            list.removeAttribute('aria-activedescendant');
        else
            list.setAttribute('aria-activedescendant', 'activity-entry-' + id);
        if (scroll && id !== undefined)
            list.querySelector('#activity-entry-' + id)?.scrollIntoView({ block: 'nearest' });
    }
    const markBusy = () => { clearTimeout(idleTimer); idle = false; localErrorHeld = false; commandErrorHeld = false; };
    const settle = () => {
        clearTimeout(idleTimer);
        if (!tasks.size)
            idleTimer = setTimeout(() => { idle = true; localErrorHeld = false; commandErrorHeld = false; renderStatus(); }, lastError ? 8000 : 1200);
    };
    const request = async (data) => {
        const currentGeneration = generation;
        const response = await fetch('api.php?r=activity' + (data ? '' : '&after=' + cursor), { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() } : undefined, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' });
        if (response.status === 401 && currentGeneration === generation)
            onSessionExpired?.();
        if (!response.ok)
            throw Error('Activity log could not be loaded.');
        return response.json();
    };
    function renderStatus() {
        const active = [...tasks.values()].filter(task => task.active), queued = tasks.size - active.length;
        status.textContent = idle && !tasks.size ? 'Ready.' : lastError ? lastMessage + (tasks.size ? ` · ${tasks.size} pending` : '') : active.length ? active.at(-1).message + (queued ? ` · ${queued} queued` : '') : queued ? `${queued} operation(s) queued…` : lastMessage;
        status.className = 'show';
        status.setAttribute('role', lastError && !idle ? 'alert' : 'status');
        bar.dataset.level = lastError && !idle ? 'error' : tasks.size ? 'busy' : 'info';
        bar.dataset.busy = String(tasks.size > 0);
        bar.setAttribute('aria-busy', String(tasks.size > 0));
        const errors = entries.filter(entry => entry.level === 'error').length, warnings = entries.filter(entry => entry.level === 'warning').length;
        const attention = errors ? 'error' : warnings ? 'warning' : '';
        const counts = [errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : '', warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''].filter(Boolean);
        const icon = attention ? `<svg class="activity-attention-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${errors ? '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>' : '<path d="M12 3 2 21h20L12 3Zm0 6v5m0 3v.01"/>'}</svg>` : '';
        button.dataset.attention = attention;
        button.innerHTML = icon + `<span>View activity${counts.length ? ' (' + counts.join(', ') + ')' : ''}</span>`;
    }
    function filtered() {
        const level = dialog.querySelector('#activity-level')?.value || '', account = dialog.querySelector('#activity-account')?.value || '';
        return entries.filter(entry => (!level || entry.level === level) && (!account || entry.account === account));
    }
    function runTargets() {
        // Completion can supply a newly created or replacement ID for earlier events.
        const targets = new Map();
        for (const entry of entries)
            if (entry.run && entry.record_id)
                targets.set(entry.run, entry.record_id);
        return targets;
    }
    function renderEntries() {
        if (!dialog.open)
            return;
        const select = dialog.querySelector('#activity-account'), selected = select.value;
        select.innerHTML = '<option value="">All accounts</option>' + [...new Set(entries.map(entry => entry.account).filter(isPresent))].sort().map(account => `<option ${account === selected ? 'selected' : ''}>${e(account)}</option>`).join('');
        const rows = filtered().slice().reverse();
        const targets = runTargets();
        const list = dialog.querySelector('#activity-entries'), scrollTop = list.scrollTop;
        list.innerHTML = rows.length ? rows.map(entry => {
            const linked = openItem && (entry.record_id || targets.has(entry.run || ''));
            return `<li id="activity-entry-${entry.id}" data-entry-id="${entry.id}" role="option" data-level="${e(entry.level)}">
        <div><time datetime="${e(entry.time)}">${timestampLabel(entry.time, new Date(entry.time).toLocaleString())}</time> · ${e(entry.level)}${entry.account ? ' · ' + e(entry.account) : ''}${entry.duration_ms !== null ? ' · ' + e(entry.duration_ms) + ' ms' : ''}</div>
        <span class="activity-event-heading"><strong>${e(entry.operation)}</strong>${linked ? `<span class="activity-linked-badge"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2 M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2"/></svg>Linked item</span><span class="activity-open-hint">Enter to open item</span>` : ''}</span>
        <p>${e(entry.message)}</p></li>`;
        }).join('') : '<li role="presentation">No recent activity matches these filters.</li>';
        list.scrollTop = scrollTop;
        selectEntry(rows.some(entry => entry.id === selectedId) ? selectedId : rows[0]?.id, document.activeElement === list);
        dialog.querySelector('#activity-count').textContent = `${rows.length} of ${entries.length} recent entries · latest 500 retained`;
    }
    function updateStatus(latest) {
        if (localErrorHeld || !latest)
            return;
        lastMessage = (latest.account ? latest.account + ': ' : '') + latest.message;
        lastError = latest.level === 'error';
        if (['progress', 'sync-progress'].includes(latest.phase) && tasks.size) {
            const active = [...tasks.values()].filter(task => task.active), task = active.find(task => latest.account && task.message.startsWith(latest.account + ': ')) || (!latest.account ? active.at(-1) : undefined);
            if (task && (latest.phase === 'sync-progress' || !task.syncProgress)) {
                task.message = lastMessage;
                task.syncProgress = latest.phase === 'sync-progress';
            }
        }
    }
    function receive(newEntries) {
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        for (const entry of newEntries)
            byId.set(entry.id, entry);
        entries = [...byId.values()].sort((a, b) => a.id - b.id).slice(-500);
        cursor = entries.at(-1)?.id || cursor;
        updateStatus(entries.filter(entry => entry.phase !== 'diagnostic').at(-1));
        renderStatus();
        renderEntries();
    }
    async function poll() {
        if (!enabled || polling || document.hidden || tasks.size)
            return;
        polling = true;
        const currentGeneration = generation;
        try {
            const result = await request();
            if (currentGeneration !== generation || !enabled)
                return;
            if (result.entries?.length)
                receive(result.entries);
            renderStatus();
            renderEntries();
        }
        catch {
            if (dialog.open)
                dialog.querySelector('#activity-feedback').textContent = 'Activity log could not be loaded. Retrying shortly.';
        }
        finally {
            polling = false;
        }
    }
    function open(level = '') {
        if (!enabled)
            return;
        if (dialog.open) {
            dialog.querySelector('#activity-level').value = level;
            renderEntries();
            dialog.querySelector('#activity-entries').focus();
            void poll();
            return;
        }
        selectedId = undefined;
        keySequence = '';
        dialog.returnValue = '';
        dialog.innerHTML = `<div class="dialog-head"><h2 id="activity-title">Recent activity</h2><button type="button" id="activity-close" aria-label="Close activity">✕</button></div>
      <p>Recent Office activity. Choose what gets saved in Activity Log settings. Passwords, tokens, mail contents and raw commands are excluded.</p>
      <div class="activity-tools"><label>Level<select id="activity-level" aria-label="Level"><option value="">All levels</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="success">Success</option><option value="info">Information</option></select></label><label>Account<select id="activity-account" aria-label="Account"><option value="">All accounts</option></select></label><button type="button" id="activity-copy">Copy visible log</button><button type="button" id="activity-clear">Clear log</button></div>
      <p id="activity-count"></p><p id="activity-feedback" role="status"></p><ol id="activity-entries" tabindex="0" role="listbox" aria-label="Recent activity entries"></ol>`;
        dialog.querySelector('#activity-level').value = level;
        dialog.showModal();
        dialog.querySelector('#activity-close').onclick = () => dialog.close();
        dialog.querySelectorAll('select').forEach(select => select.onchange = renderEntries);
        const list = dialog.querySelector('#activity-entries');
        const feedback = dialog.querySelector('#activity-feedback');
        let openingItem = false;
        list.onclick = event => {
            const row = event.target.closest('[data-entry-id]');
            if (row) {
                selectEntry(Number(row.dataset.entryId));
                list.focus({ preventScroll: true });
            }
        };
        list.onblur = () => { keySequence = ''; };
        list.onkeydown = event => {
            if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
                return;
            const key = event.key, bindings = keys(), rows = filtered().slice().reverse();
            if (Date.now() - sequenceTime > 900)
                keySequence = '';
            sequenceTime = Date.now();
            if (key === 'g') {
                event.preventDefault();
                if (event.repeat)
                    return;
                if (keySequence === 'g') {
                    keySequence = '';
                    selectEntry(rows[0]?.id, true);
                }
                else
                    keySequence = 'g';
                return;
            }
            keySequence = '';
            if (key === 'Enter') {
                event.preventDefault();
                const entry = rows.find(row => row.id === selectedId);
                if (!openItem || !entry || openingItem || event.repeat)
                    return;
                const recordId = runTargets().get(entry.run || '') || entry.record_id;
                if (!recordId)
                    return;
                const isCurrent = () => dialog.open && list.isConnected && selectedId === entry.id;
                openingItem = true;
                feedback.textContent = 'Opening related item…';
                void openItem(recordId, () => {
                    if (!isCurrent())
                        return false;
                    dialog.close('open-item');
                    return true;
                }).catch(cause => {
                    if (isCurrent())
                        feedback.textContent = asError(cause).status === 404 ? 'This item is no longer available.' : 'The related item could not be opened. Try again.';
                }).finally(() => { openingItem = false; });
                return;
            }
            const direction = ['ArrowUp', 'ArrowLeft'].includes(key) ? -1 : ['ArrowDown', 'ArrowRight'].includes(key) ? 1 :
                key === bindings.down ? 1 : key === bindings.up ? -1 : key === 'n' ? 1 : key === 'N' ? -1 : 0;
            if (!direction && key !== 'G' && key !== 'Home' && key !== 'End')
                return;
            event.preventDefault();
            const index = rows.findIndex(entry => entry.id === selectedId);
            const next = key === 'Home' ? 0 : key === 'G' || key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + direction));
            selectEntry(rows[next]?.id, true);
        };
        dialog.querySelector('#activity-copy').onclick = async () => {
            const text = filtered().map(entry => `${timestampText(entry.time, entry.time)} [${entry.level}] ${entry.account ? entry.account + ' · ' : ''}${entry.operation}: ${entry.message}${entry.duration_ms !== null ? ' (' + entry.duration_ms + ' ms)' : ''}`).join('\n');
            try {
                await navigator.clipboard.writeText(text);
                dialog.querySelector('#activity-feedback').textContent = 'Visible log copied.';
            }
            catch {
                dialog.querySelector('#activity-feedback').textContent = 'Clipboard access is unavailable. Select and copy the log text.';
            }
        };
        dialog.querySelector('#activity-clear').onclick = async () => {
            generation++;
            const clear = dialog.querySelector('#activity-clear');
            clear.disabled = true;
            try {
                await request({ action: 'clear' });
                entries = [];
                cursor = 0;
                lastMessage = 'Activity log cleared.';
                lastError = false;
                localErrorHeld = false;
                commandErrorHeld = false;
                renderEntries();
                renderStatus();
            }
            catch {
                dialog.querySelector('#activity-feedback').textContent = 'Activity log could not be cleared.';
            }
            finally {
                clear.disabled = false;
            }
        };
        renderEntries();
        list.focus();
        void poll();
    }
    button.onclick = () => open();
    dialog.addEventListener('close', () => { if (!dialog.open && dialog.returnValue !== 'open-item')
        button.focus(); });
    setInterval(() => void poll(), 2000);
    renderStatus();
    return {
        open,
        receive(entry) { if (enabled)
            receive([entry]); },
        progress(entry) { if (enabled) {
            updateStatus(entry);
            renderStatus();
        } },
        configure(value) { enabled = value; button.disabled = !value; if (!value) {
            generation++;
            entries = [];
            cursor = 0;
            tasks.clear();
            clearTimeout(idleTimer);
            idle = true;
            localErrorHeld = false;
            commandErrorHeld = false;
            lastMessage = 'Ready.';
            lastError = false;
            if (dialog.open)
                dialog.close();
            renderStatus();
        }
        else
            void poll(); },
        clearCommandError() { if (!commandErrorHeld)
            return; clearTimeout(idleTimer); localErrorHeld = false; commandErrorHeld = false; lastError = false; lastMessage = 'Ready.'; idle = !tasks.size; renderStatus(); },
        notice(message, error = false, { log = true } = {}) { lastMessage = message; lastError = error; markBusy(); localErrorHeld = error; commandErrorHeld = error && !log; settle(); renderStatus(); if (enabled && log)
            void request({ action: 'notice', message: String(message).slice(0, 1000), error }).then(() => poll()).catch(() => { }); },
        diagnostic(message) { if (enabled)
            void request({ action: 'diagnostic', message: message.slice(0, 1000) }).catch(() => { }); },
        queued(message) { if (!message)
            return null; markBusy(); lastError = false; const id = ++sequence; tasks.set(id, { message, active: false }); renderStatus(); return id; },
        running(id) { if (id !== null && tasks.has(id)) {
            markBusy();
            lastError = false;
            tasks.get(id).active = true;
            renderStatus();
        } },
        done(id) { if (id === null)
            return; const task = tasks.get(id); if (task) {
            if (!enabled && !lastError)
                lastMessage = 'Finished: ' + task.message.replace(/…$/, '');
            tasks.delete(id);
            settle();
            renderStatus();
            void poll();
        } },
    };
}
