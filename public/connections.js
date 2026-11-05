// Generated from frontend/connections.ts by pnpm build. Do not edit.
import { openConnectionExplorer } from './connection-explorer.js';
import { connectionQuery, CommandError } from './commands.js';
import { itemTypes } from './item-types.js';
import { escapeHtml as e } from './formats.js';
const label = (kind) => itemTypes[kind]?.label || kind;
const detail = (item) => Object.entries(item.meta).filter(([key]) => itemTypes[item.kind]?.fields.some(field => field === key)).map(([, value]) => value).join(' · ');
export function createConnections(env) {
    let checkingDeletion = false;
    const confirmDeletion = async (rows, title, message, action, skipUnconnected = false) => {
        if (checkingDeletion)
            return;
        const linked = [];
        checkingDeletion = true;
        try {
            for (const row of rows) {
                const result = await env.api(`connections&id=${encodeURIComponent(row.id)}&visibility=all`);
                if (result.links.length)
                    linked.push({ row, result });
            }
        }
        finally {
            checkingDeletion = false;
        }
        if (!linked.length) {
            if (skipUnconnected)
                await action({});
            else
                env.confirmation(title, message, () => action({}));
            return;
        }
        const choices = {}, names = new Map(linked.map(({ row }) => [row.id, row.title]));
        const removable = (row) => !row.meta.remote || ['Recovery copies', 'Not in Inbox'].includes(row.meta.folder || '');
        const render = () => {
            env.modal(title, `<p>${e(message)}</p><p>These items have connections. Review them and choose how to keep their shared context.</p>${linked.map(({ row, result }, index) => `<fieldset class="connection-delete-options"><legend>${e(row.title)} · ${result.links.length}${result.more ? '+' : ''} connections</legend><button type="button" data-review-connections="${index}">View connections</button>${removable(row) ? `<label class="check-label"><input type="checkbox" data-preserve="${index}" ${choices[row.id]?.connectionHubTitle === undefined && row.id in choices ? '' : 'checked'}> Preserve connections as a hub in Documents</label><label>Hub name<input data-hub-name="${index}" value="${e(names.get(row.id))}" required maxlength="500"></label><p class="muted">Keeps the name and links only. Uncheck to remove the links.</p>` : '<p>Connections stay with this message in Trash.</p>'}</fieldset>`).join('')}<div class="dialog-actions"><button id="cancel">Cancel</button><button class="primary" id="confirm">${e(title)}</button></div>`);
            const dialog = env.dialog;
            const collect = () => { for (const { row } of linked)
                if (removable(row))
                    choices[row.id] = {}; dialog.querySelectorAll('[data-hub-name]').forEach(input => { const index = Number(input.dataset.hubName), row = linked[index].row; names.set(row.id, input.value); if (dialog.querySelector(`[data-preserve="${index}"]`).checked)
                choices[row.id] = { connectionHubTitle: input.value }; }); };
            dialog.querySelectorAll('[data-review-connections]').forEach(button => button.onclick = () => {
                collect();
                void view(false, linked[Number(button.dataset.reviewConnections)].row.id).then(() => {
                    if (!dialog.querySelector('.connections-view'))
                        return;
                    const back = document.createElement('button');
                    back.textContent = 'Back to deletion';
                    back.onclick = render;
                    dialog.querySelector('.connections-view').prepend(back);
                    back.focus();
                }).catch(error => env.notice(error.message, true));
            });
            dialog.querySelector('#cancel').onclick = () => dialog.close();
            dialog.querySelector('#confirm').onclick = () => {
                collect();
                for (const input of dialog.querySelectorAll('[data-hub-name]')) {
                    const row = linked[Number(input.dataset.hubName)].row;
                    if (choices[row.id]?.connectionHubTitle !== undefined && !input.reportValidity())
                        return;
                }
                dialog.close();
                env.attempt(() => action(choices));
            };
            dialog.querySelector('#cancel').focus();
        };
        render();
    };
    async function search(value) {
        const query = connectionQuery(value);
        if (!query)
            return [];
        const id = env.current();
        if (!id || id.startsWith('draft-'))
            return [];
        if (query.name === 'unlink') {
            let offset = 0, all = [];
            for (;;) {
                const result = await env.api(`connections&id=${encodeURIComponent(id)}&offset=${offset}`);
                all.push(...result.items.filter(item => item.id !== id));
                if (!result.more)
                    break;
                offset += result.links.length;
            }
            const text = query.query.toLocaleLowerCase();
            return all.filter(item => (!query.kind || item.kind === query.kind) && (item.id === query.query || (item.title + ' ' + item.excerpt + ' ' + detail(item)).toLocaleLowerCase().includes(text))).slice(0, 20);
        }
        return (await env.api(`connection-search&q=${encodeURIComponent(query.query)}&kind=${encodeURIComponent(query.kind || '')}&exclude=${encodeURIComponent(id)}`)).items;
    }
    function autocomplete(input) {
        const list = document.createElement('div');
        list.id = 'connection-suggestions';
        list.className = 'connection-suggestions';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'Matching items');
        list.hidden = true;
        input.after(list);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', list.id);
        input.setAttribute('aria-expanded', 'false');
        let version = 0, timer, items = [], index = 0;
        const hide = () => { version++; clearTimeout(timer); list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
        const accept = () => { if (!items[index])
            return; const query = connectionQuery(input.value); input.value = ':' + query.name + ' ' + items[index].id; hide(); input.focus(); };
        function render() {
            list.innerHTML = items.length ? items.map((item, i) => `<div role="option" id="connection-option-${i}" aria-selected="${i === index}" data-index="${i}"><strong>${e(label(item.kind))} · ${e(item.title)}</strong><small>${e(detail(item))} · ${e(item.id)}</small><span>${e(item.excerpt)}</span></div>`).join('') : '<p role="status">No matching items.</p>';
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            if (items.length) {
                input.setAttribute('aria-activedescendant', 'connection-option-' + index);
                list.children[index]?.scrollIntoView({ block: 'nearest' });
            }
            else
                input.removeAttribute('aria-activedescendant');
        }
        list.onpointerdown = event => { event.preventDefault(); const option = event.target.closest('[data-index]'); if (option) {
            index = Number(option.dataset.index);
            accept();
        } };
        input.addEventListener('input', () => {
            hide();
            if (!connectionQuery(input.value))
                return;
            const request = version;
            timer = setTimeout(() => { void search(input.value).then(result => { if (request !== version || !input.isConnected)
                return; items = result; index = 0; render(); }).catch(error => { if (request === version) {
                items = [];
                list.innerHTML = `<p role="status">${e(error.message)}</p>`;
                list.hidden = false;
                input.setAttribute('aria-expanded', 'true');
            } }); }, 150);
        });
        return {
            key(event) {
                if (event.isComposing || list.hidden)
                    return false;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    hide();
                    return true;
                }
                if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                    event.preventDefault();
                    if (items.length) {
                        index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                        render();
                    }
                    return true;
                }
                if (event.key === 'Tab') {
                    event.preventDefault();
                    accept();
                    return true;
                }
                return false;
            },
            close() { hide(); list.remove(); },
        };
    }
    async function mutate(action, query, kind) {
        const id = env.current();
        if (!id || id.startsWith('draft-'))
            throw new CommandError('Save and select an item before linking.');
        const type = kind ? itemTypes[kind]?.command : undefined;
        const results = await search(':' + action + ' ' + (type ? type + ' ' : '') + query);
        const matching = results.filter(item => !kind || item.kind === kind);
        const exact = matching.filter(item => item.id === query);
        // Names are safe only when the entire search result is unambiguous.
        const target = exact[0] || (matching.length === 1 ? matching[0] : undefined);
        if (!target)
            throw new CommandError(matching.length ? 'Several items match. Use Tab to select an exact item.' : 'No matching item found.');
        await env.api('connection', { id, target: target.id, action: action === 'link' ? 'add' : 'remove' });
        env.notice(action === 'link' ? 'Items linked.' : 'Connection removed.');
        await section();
    }
    let headerEvents, headerVersion = 0;
    async function section() {
        const version = ++headerVersion;
        headerEvents?.abort();
        headerEvents = new AbortController();
        const id = env.current(), panel = document.querySelector('#detail');
        if (!id || !panel)
            return;
        const header = panel.querySelector('.mail-header-badges, .detail-toolbar .left');
        if (!header)
            return;
        let host = header.querySelector('.item-connections');
        if (!host) {
            host = document.createElement('div');
            host.className = 'item-connections';
            host.setAttribute('role', 'group');
            host.setAttribute('aria-label', 'Connections');
            header.append(host);
        }
        const target = host, wasOpen = !!target.querySelector(':popover-open'), hadFocus = target.contains(document.activeElement);
        const draft = id.startsWith('draft-');
        target.innerHTML = `<button type="button" class="connection-count" id="connection-count" popovertarget="item-connection-popover" aria-expanded="false" ${draft ? 'disabled title="Save this draft to manage connections"' : ''}>Connections · ${draft ? '—' : '…'}</button><button type="button" class="connection-add" data-connections-add aria-label="Link item" title="Link an existing item (:link)" ${draft ? 'disabled' : ''}>+ Link</button><div id="item-connection-popover" class="connection-popover" popover="auto" role="region" aria-label="Item connections"><div class="connection-popover-heading"><strong>Connections</strong><button type="button" data-connections-view>View map</button></div><div data-connection-items><p class="muted" role="status">Loading connections…</p></div></div>`;
        const toggle = target.querySelector('.connection-count'), popover = target.querySelector('[popover]'), itemsHost = target.querySelector('[data-connection-items]');
        function position() {
            if (!popover.matches(':popover-open'))
                return;
            const anchor = toggle.getBoundingClientRect(), width = popover.offsetWidth, height = popover.offsetHeight, gap = 6;
            popover.style.left = Math.max(8, Math.min(anchor.left, innerWidth - width - 8)) + 'px';
            popover.style.top = Math.max(8, Math.min(anchor.bottom + gap, innerHeight - height - 8)) + 'px';
        }
        const close = () => { if (popover.matches(':popover-open'))
            popover.hidePopover(); };
        popover.addEventListener('toggle', () => { toggle.setAttribute('aria-expanded', String(popover.matches(':popover-open'))); position(); });
        target.onkeydown = event => {
            if (event.key === 'Escape' && popover.matches(':popover-open')) {
                event.preventDefault();
                event.stopPropagation();
                close();
                toggle.focus();
                return;
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                if (!popover.matches(':popover-open') && !draft)
                    popover.showPopover();
                const buttons = Array.from(popover.querySelectorAll('button:not(:disabled)'));
                const current = buttons.indexOf(document.activeElement);
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : current < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0) : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
                buttons[index]?.focus();
                position();
            }
            else if (popover.contains(event.target))
                event.stopPropagation();
        };
        window.addEventListener('resize', position, { signal: headerEvents.signal });
        document.addEventListener('scroll', position, { capture: true, signal: headerEvents.signal });
        target.querySelector('[data-connections-view]').onclick = () => { close(); void view(false).catch(error => env.notice(error.message, true)); };
        target.querySelector('[data-connections-add]').onclick = () => { close(); env.command(':link '); };
        if (wasOpen && !draft)
            popover.showPopover();
        if (hadFocus)
            toggle.focus();
        if (draft)
            return;
        try {
            const result = await env.api(`connections&id=${encodeURIComponent(id)}`);
            if (version !== headerVersion || env.current() !== id || !target.isConnected)
                return;
            const items = result.items.filter(item => item.id !== id);
            toggle.textContent = `Connections · ${result.links.length}${result.more ? '+' : ''}`;
            itemsHost.innerHTML = items.length ? items.map(item => `<div class="connection-popover-item"><button type="button" class="wiki-link" data-connection-open="${e(item.id)}">${e(label(item.kind))} · ${e(item.title)}</button><button type="button" class="quiet" data-connection-remove="${e(item.id)}" aria-label="Remove connection to ${e(item.title)}">Unlink</button></div>`).join('') : '<p class="muted">No connections yet.</p>';
            if (result.more)
                itemsHost.insertAdjacentHTML('beforeend', '<p class="muted">Showing the first 100 connections. View map to browse all.</p>');
            target.querySelectorAll('[data-connection-open]').forEach(button => button.onclick = () => { close(); void env.open(button.dataset.connectionOpen).catch(error => env.notice(error.message, true)); });
            target.querySelectorAll('[data-connection-remove]').forEach(button => button.onclick = () => void mutate('unlink', button.dataset.connectionRemove).catch(error => env.notice(error.message, true)));
            position();
        }
        catch (error) {
            if (version === headerVersion && target.isConnected) {
                toggle.textContent = 'Connections · !';
                itemsHost.innerHTML = `<p role="status">${e(error.message)}</p>`;
                position();
            }
        }
    }
    async function view(all = false, sourceId) {
        const source = all ? '' : sourceId ?? env.current();
        if (source === undefined || source?.startsWith('draft-'))
            throw new CommandError('Save and select an item first, or use :links all.');
        await openConnectionExplorer({ ...env, changed: () => void section() }, source || '');
    }
    return { autocomplete, mutate, section, view, confirmDeletion };
}
