// Generated from frontend/activity.ts by pnpm build. Do not edit.
import { isPresent } from './utils.js';
import { escapeHtml as e } from './formats.js';
export function createActivity({ csrf }) {
    const bar = document.querySelector('#activity-status'), status = document.querySelector('#notice'), button = document.querySelector('#view-activity'), dialog = document.querySelector('#activity-dialog');
    let enabled = false, entries = [], cursor = 0, polling = false, generation = 0, lastMessage = 'Ready.', lastError = false, sequence = 0;
    const tasks = new Map();
    let idle = true, idleTimer;
    const markBusy = () => { clearTimeout(idleTimer); idle = false; };
    const settle = () => {
        clearTimeout(idleTimer);
        if (!tasks.size)
            idleTimer = setTimeout(() => { idle = true; renderStatus(); }, 1200);
    };
    const request = async (data) => {
        const response = await fetch('api.php?r=activity' + (data ? '' : '&after=' + cursor), { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() } : undefined, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' });
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
        const errors = entries.filter(entry => entry.level === 'error').length;
        button.textContent = 'View activity' + (errors ? ` (${errors} ${errors === 1 ? 'error' : 'errors'})` : '');
    }
    function filtered() {
        const level = dialog.querySelector('#activity-level')?.value || '', account = dialog.querySelector('#activity-account')?.value || '';
        return entries.filter(entry => (!level || entry.level === level) && (!account || entry.account === account));
    }
    function renderEntries() {
        if (!dialog.open)
            return;
        const select = dialog.querySelector('#activity-account'), selected = select.value;
        select.innerHTML = '<option value="">All accounts</option>' + [...new Set(entries.map(entry => entry.account).filter(isPresent))].sort().map(account => `<option ${account === selected ? 'selected' : ''}>${e(account)}</option>`).join('');
        const rows = filtered().slice().reverse();
        dialog.querySelector('#activity-entries').innerHTML = rows.length ? rows.map(entry => `<li data-level="${e(entry.level)}"><div><time datetime="${e(entry.time)}">${e(new Date(entry.time).toLocaleString())}</time> · ${e(entry.level)}${entry.account ? ' · ' + e(entry.account) : ''}${entry.duration_ms !== null ? ' · ' + e(entry.duration_ms) + ' ms' : ''}</div><strong>${e(entry.operation)}</strong><p>${e(entry.message)}</p></li>`).join('') : '<li>No recent activity matches these filters.</li>';
        dialog.querySelector('#activity-count').textContent = `${rows.length} of ${entries.length} recent entries · latest 500 retained`;
    }
    function receive(newEntries) {
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        for (const entry of newEntries)
            byId.set(entry.id, entry);
        entries = [...byId.values()].sort((a, b) => a.id - b.id).slice(-500);
        cursor = entries.at(-1)?.id || cursor;
        const latest = entries.at(-1);
        if (!latest)
            return;
        lastMessage = (latest.account ? latest.account + ': ' : '') + latest.message;
        lastError = latest.level === 'error';
        if (latest.phase === 'progress' && tasks.size) {
            const active = [...tasks.values()].filter(task => task.active), task = active.find(task => latest.account && task.message.startsWith(latest.account + ': ')) || active.at(-1);
            if (task)
                task.message = lastMessage;
        }
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
    button.onclick = () => {
        if (!enabled)
            return;
        dialog.innerHTML = `<div class="dialog-head"><h2 id="activity-title">Recent activity</h2><button type="button" id="activity-close" aria-label="Close activity">✕</button></div>
      <p>Connection progress and recent Office activity. Passwords, tokens, mail contents and raw commands are excluded.</p>
      <div class="activity-tools"><label>Level<select id="activity-level" aria-label="Level"><option value="">All levels</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="success">Success</option><option value="info">Information</option></select></label><label>Account<select id="activity-account" aria-label="Account"><option value="">All accounts</option></select></label><button type="button" id="activity-copy">Copy visible log</button><button type="button" id="activity-clear">Clear log</button></div>
      <p id="activity-count"></p><p id="activity-feedback" role="status"></p><ol id="activity-entries" tabindex="0" aria-label="Recent activity entries"></ol>`;
        dialog.showModal();
        dialog.querySelector('#activity-close').onclick = () => dialog.close();
        dialog.querySelectorAll('select').forEach(select => select.onchange = renderEntries);
        dialog.querySelector('#activity-copy').onclick = async () => {
            const text = filtered().map(entry => `${entry.time} [${entry.level}] ${entry.account ? entry.account + ' · ' : ''}${entry.operation}: ${entry.message}${entry.duration_ms !== null ? ' (' + entry.duration_ms + ' ms)' : ''}`).join('\n');
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
        void poll();
    };
    dialog.addEventListener('close', () => button.focus());
    setInterval(() => void poll(), 2000);
    renderStatus();
    return {
        receive(entry) { if (enabled)
            receive([entry]); },
        configure(value) { enabled = value; button.disabled = !value; if (!value) {
            generation++;
            entries = [];
            cursor = 0;
            tasks.clear();
            clearTimeout(idleTimer);
            idle = true;
            lastMessage = 'Ready.';
            lastError = false;
            if (dialog.open)
                dialog.close();
            renderStatus();
        }
        else
            void poll(); },
        notice(message, error = false) { lastMessage = message; lastError = error; markBusy(); settle(); renderStatus(); if (enabled)
            void request({ action: 'notice', message: String(message).slice(0, 1000), error }).then(() => poll()).catch(() => { }); },
        queued(message) { if (!message)
            return null; markBusy(); const id = ++sequence; tasks.set(id, { message, active: false }); renderStatus(); return id; },
        running(id) { if (id !== null && tasks.has(id)) {
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
