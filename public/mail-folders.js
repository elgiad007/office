// Generated from frontend/mail-folders.ts by pnpm build. Do not edit.
import { asError } from './utils.js';
import { isPresent } from './utils.js';
export function matchesMailScope(row, scope, accounts) {
    if (!row.meta.remote || row.meta.account !== scope.account || ['Recovery copies', 'Not in Inbox'].includes(row.meta.folder || ''))
        return false;
    return accounts.find(a => a.id === scope.account)?.type === 'google'
        ? (row.meta.labelIds || []).includes(scope.folder || '') : row.meta.serverFolder === scope.folder;
}
async function busy(env, run) {
    if (env.state.syncing)
        throw Error('Wait for the current mail operation to finish.');
    env.state.syncing = true;
    const buttons = [...document.querySelectorAll('#sync-button, #folder-refresh, #folder-more, [data-open-folder], [data-refresh-folders], [data-manage-folder]')].map(button => [button, button.disabled]);
    buttons.forEach(([button]) => button.disabled = true);
    try {
        return await run();
    }
    finally {
        env.state.syncing = false;
        buttons.forEach(([button, disabled]) => button.disabled = disabled);
    }
}
async function reloadMail(env, preserveSelection = false) {
    // A request may finish after the owner has opened an editor in another app.
    if (env.state.app === 'mail' && !env.state.dirty && !env.state.savePromise)
        await env.load(undefined, { preserveSelection });
}
export async function syncOpenFolder(env, more = false) {
    const scope = env.state.mailScope;
    if (!scope)
        return;
    const limit = 100;
    await busy(env, async () => { for (let batch = 0; batch < (more ? 1 : 5); batch++) {
        const result = await env.api('mail-folder-sync', { account: scope.account, folder: scope.folder, limit });
        await reloadMail(env, true);
        if (!result.more || document.hidden)
            break;
    } });
    scope.limit = limit;
    await reloadMail(env, true);
}
function tree(folders, e, account, path = '', depth = 0) {
    // Construct missing parent containers as well as selectable nested folders.
    if (depth > 50)
        return '';
    const nodes = new Map();
    for (const f of folders) {
        const parts = f.delimiter ? f.name.split(f.delimiter) : [f.name];
        const prefix = parts.slice(0, depth).join(f.delimiter ?? undefined);
        if (prefix !== path || parts.length <= depth)
            continue;
        const name = parts[depth], key = parts.slice(0, depth + 1).join(f.delimiter ?? undefined);
        if (!nodes.has(key))
            nodes.set(key, { name, key, folder: null, children: [] });
        const node = nodes.get(key);
        if (parts.length === depth + 1)
            node.folder = f;
        else
            node.children.push(f);
    }
    return [...nodes.values()].map(n => {
        const button = n.folder ? `<button class="folder-link" data-open-folder="${e(n.folder.id)}" data-folder-account="${e(account)}">${e(n.name)}</button>` : `<span>${e(n.name)}</span>`;
        return n.children.length ? `<details open><summary>${button}</summary><div class="folder-children">${tree(n.children, e, account, n.key, depth + 1)}</div></details>` : button;
    }).join('');
}
export function renderMailFolders(env) {
    const { state, e } = env, navigation = document.querySelector('#mail-folder-navigation'), controls = document.querySelector('.search-wrap'), host = document.querySelector('.shell');
    const scope = state.mailScope, account = state.accounts.find(a => a.id === scope?.account), folder = account?.folders?.find(f => f.id === scope.folder);
    navigation.insertAdjacentHTML('beforeend', `<div class="account-folders" aria-label="Account folders">${state.accounts.filter(a => ['imap', 'google'].includes(a.type)).map(a => `<details class="folder-account" ${state.folderOpen.has(a.id) ? 'open' : ''} data-account-tree="${e(a.id)}"><summary>${e(a.label)}${a.type === 'google' ? ' · Labels' : ''}</summary><div class="folder-tools"><button data-refresh-folders="${e(a.id)}">Refresh folders</button><button data-manage-folder="create" data-folder-account="${e(a.id)}">New ${a.type === 'google' ? 'label' : 'folder'}</button></div>${tree(a.folders || [], e, a.id) || '<p class="muted">Refresh folders to discover this account’s folders.</p>'}</details>`).join('')}</div>`);
    controls.insertAdjacentHTML('beforeend', scope ? `<div class="folder-current"><strong>${e(account?.label || 'Account')} / ${e(folder?.name || scope.folder)}</strong><div class="folder-tools"><button id="folder-refresh">Refresh mail</button><button id="folder-more" ${''}>Load next batch</button>${folder && !folder.protected ? `<button data-manage-folder="rename" data-folder-account="${e(scope.account)}">Rename</button><button data-manage-folder="delete" data-folder-account="${e(scope.account)}">Delete</button>` : ''}</div><small>Headers sync in batches of 100. Open a message to download its contents.</small></div>` : '');
    host.querySelectorAll('[data-account-tree]').forEach(d => d.ontoggle = () => { if (d.open)
        state.folderOpen.add(d.dataset.accountTree);
    else
        state.folderOpen.delete(d.dataset.accountTree); });
    host.querySelectorAll('[data-refresh-folders]').forEach(b => b.onclick = () => env.attempt(async () => {
        await env.commit();
        b.disabled = true;
        try {
            const result = await busy(env, () => env.api('mail-folders', { account: b.dataset.refreshFolders }));
            state.accounts.find(a => a.id === b.dataset.refreshFolders).folders = result.folders;
            await reloadMail(env);
        }
        finally {
            b.disabled = false;
        }
    }));
    host.querySelectorAll('[data-open-folder]').forEach(b => b.onclick = () => env.attempt(async () => {
        await env.commit();
        state.mailScope = { account: b.dataset.folderAccount, folder: b.dataset.openFolder, limit: 100 };
        state.current = null;
        state.selected.clear();
        if (matchMedia('(max-width: 800px)').matches)
            env.closeFolderPanel?.();
        await reloadMail(env);
        await syncOpenFolder(env);
    }));
    host.querySelectorAll('[data-open-folder]').forEach(b => { if (scope?.account === b.dataset.folderAccount && scope.folder === b.dataset.openFolder)
        b.setAttribute('aria-current', 'location'); });
    host.querySelectorAll('[data-manage-folder]').forEach(b => b.onclick = () => env.attempt(() => manageFolder(env, b.dataset.folderAccount, b.dataset.manageFolder)));
    const refresh = host.querySelector('#folder-refresh'), more = host.querySelector('#folder-more');
    if (refresh)
        refresh.onclick = () => env.attempt(() => syncOpenFolder(env));
    if (more)
        more.onclick = () => env.attempt(() => syncOpenFolder(env, true));
}
async function manageFolder(env, accountId, action) {
    const { state, e } = env;
    await env.commit();
    const account = state.accounts.find(a => a.id === accountId), scope = state.mailScope;
    const folder = action === 'create' ? null : account.folders.find(f => f.id === scope?.folder);
    const save = async (name) => {
        const result = await busy(env, () => env.api('mail-folder-manage', { account: accountId, action, folder: folder?.id || '', name }));
        account.folders = result.folders;
        if (action !== 'create') {
            state.mailScope = null;
            state.current = null;
            state.selected.clear();
        }
        env.dialog.close();
        await reloadMail(env);
        env.notice(action === 'delete' ? 'Folder removed.' : 'Folder saved.');
    };
    if (action === 'delete') {
        env.confirmation('Delete ' + (account.type === 'google' ? 'label' : 'folder'), account.type === 'google' ? `Delete label “${folder.name}” from this account and all messages? The messages themselves will remain.` : `Delete empty folder “${folder.name}” from this account? Move messages and subfolders out first.`, () => save(''));
        return;
    }
    env.modal(action === 'create' ? 'New folder or label' : 'Rename folder or label', `<form id="folder-name-form">${env.field('Name (full path for nested folders)', 'name', folder?.name || '', 'text', 'required maxlength="500"')}<p class="muted">${account.type === 'google' ? 'Use / for nested label names. Renaming changes this label only.' : 'Use the account’s folder separator for nested paths. Renaming also moves its subfolders.'}</p><button class="primary">Save folder</button></form>`);
    env.dialog.querySelector('form').onsubmit = event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; void env.attempt(async () => { try {
        await save(new FormData(event.target).get('name'));
    }
    finally {
        button.disabled = false;
    } }); };
}
export async function fileMail(env) {
    const reload = env.mailDeletionReload?.();
    await env.commit();
    const { state, e } = env;
    const rows = state.selected.size ? state.rows.filter(r => state.selected.has(r.id)) : [state.current].filter(isPresent);
    if (!rows.length || rows.some(r => !r.meta.remote || ['Recovery copies', 'Not in Inbox'].includes(r.meta.folder || '')))
        throw Error('Select connected mail from one account.');
    const account = state.accounts.find(a => a.id === rows[0].meta.account);
    if (!account || rows.some(r => r.meta.account !== account.id))
        throw Error('Select messages from the same account.');
    const result = await busy(env, () => env.api('mail-folders', { account: account.id }));
    account.folders = result.folders;
    const folders = result.folders.filter(f => account.type !== 'google' || !f.protected);
    if (!folders.length)
        throw Error('Create a custom folder or label first using the account’s folder list.');
    env.modal(account.type === 'google' ? 'Organize with labels' : 'Move to folder', `<form id="file-mail-form"><p>${rows.length} selected message(s) · ${e(account.label)}</p><label>Destination<select name="folder" required>${folders.map(f => `<option value="${e(f.id)}">${e(f.name)}</option>`).join('')}</select></label>${account.type === 'google' ? '<label>Action<select name="action"><option value="label">Add label (keep Inbox and other labels)</option><option value="unlabel">Remove label</option><option value="move">Move here (remove Inbox and Trash, keep other labels)</option></select></label>' : ''}<button class="primary">Apply</button></form>`);
    env.dialog.querySelector('form').onsubmit = event => {
        event.preventDefault();
        const form = new FormData(event.target), button = event.target.querySelector('button');
        button.disabled = true;
        void env.attempt(async () => {
            let count = 0;
            const removed = new Set(), moved = [];
            try {
                await busy(env, async () => { for (const row of rows) {
                    if (!removed.has(row.id)) {
                        const result = await env.api('mail-action', { id: row.id, revision: row.revision, action: form.get('action') || 'move', folder: form.get('folder') });
                        for (const id of result.removedIds || [])
                            removed.add(id);
                        if ((form.get('action') || 'move') === 'move')
                            moved.push(row.id);
                    }
                    count++;
                } });
                env.dialog.close();
                env.notice(`Organized ${count} message(s).`);
            }
            catch (cause) {
                const error = asError(cause);
                throw Error(`${count} of ${rows.length} messages organized. ${error.message}`);
            }
            finally {
                button.disabled = false;
                if (reload)
                    await reload([...removed, ...moved]);
                else
                    await reloadMail(env);
            }
        });
    };
}
/** Quick Move keeps typing focus in the search box, including while navigating matches. */
export async function quickMoveMail(env) {
    const reload = env.mailDeletionReload?.();
    await env.commit();
    const { state, e } = env;
    if (state.app !== 'mail')
        return;
    const rows = state.selected.size ? state.rows.filter(r => state.selected.has(r.id)) : [state.current].filter(isPresent);
    if (!rows.length || rows.some(r => !r.meta.remote || ['Drafts', 'Sending', 'Delivery uncertain', 'Recovery copies', 'Not in Inbox'].includes(r.meta.folder || '')))
        throw Error('Select synchronized messages to move.');
    const accounts = state.accounts.filter(a => ['imap', 'google'].includes(a.type));
    env.modal('Move to folder', `<form id="quick-move-form"><label>Folder name<input id="quick-move-search" type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="quick-move-results" placeholder="Type a folder name…"></label><div id="quick-move-results" class="quick-move-results" role="listbox" aria-label="Matching folders"></div><p id="quick-move-status" class="muted" role="status"></p><p class="muted">↑ ↓ to choose · Enter to move · Esc to cancel</p></form>`);
    const form = env.dialog.querySelector('#quick-move-form'), input = form.querySelector('input'), list = form.querySelector('[role="listbox"]'), status = form.querySelector('[role="status"]');
    let matches = [], index = 0, moving = false;
    const completed = new Set(), closeButton = env.dialog.querySelector('[data-close]');
    form.insertAdjacentHTML('beforeend', '<button type="submit" class="primary">Move</button>');
    const submit = form.querySelector('[type="submit"]');
    const missing = accounts.filter(a => !a.folders?.length);
    let discovering = missing.length > 0, discoveryFailed = false;
    const render = () => {
        const query = input.value.trim().toLocaleLowerCase();
        matches = accounts.flatMap(account => (account.folders || []).filter(folder => (account.type !== 'google' || !folder.protected || ['INBOX', 'TRASH', 'SPAM'].includes(folder.id)) && folder.name.toLocaleLowerCase().includes(query)).map(folder => ({ account, folder })));
        matches.sort((a, b) => Number(!a.folder.name.toLocaleLowerCase().startsWith(query)) - Number(!b.folder.name.toLocaleLowerCase().startsWith(query)) || a.folder.name.localeCompare(b.folder.name) || a.account.label.localeCompare(b.account.label));
        index = Math.max(0, Math.min(index, matches.length - 1));
        list.innerHTML = matches.map(({ account, folder }, i) => `<button type="button" role="option" tabindex="-1" id="quick-folder-${i}" data-match="${i}" aria-selected="${i === index}" ${moving ? 'disabled' : ''}><strong>${e(folder.name)}</strong><small>${e(account.label)}</small></button>`).join('');
        if (matches.length)
            input.setAttribute('aria-activedescendant', `quick-folder-${index}`);
        else
            input.removeAttribute('aria-activedescendant');
        status.textContent = moving ? 'Moving messages…' : `${matches.length ? matches.length + ' matching folder(s).' : 'No matching folders.'}${discovering ? ' Discovering folders…' : ''}${discoveryFailed ? ' Some accounts could not be refreshed. Cached folders are shown.' : ''}`;
        submit.disabled = moving || discovering || !matches.length;
        list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    const move = async () => {
        const target = matches[index];
        if (moving || discovering || !target)
            return;
        moving = true;
        input.disabled = true;
        closeButton.disabled = true;
        render();
        let count = completed.size;
        try {
            await busy(env, async () => {
                const removed = new Set();
                for (const row of rows) {
                    if (completed.has(row.id))
                        continue;
                    if (!removed.has(row.id)) {
                        const result = await env.api('mail-action', { id: row.id, revision: row.revision, action: 'move', folder: target.folder.id, destinationAccount: target.account.id });
                        for (const id of result.removedIds || [])
                            removed.add(id);
                    }
                    count++;
                    completed.add(row.id);
                }
            });
            env.dialog.close();
            env.notice(`Moved ${count} message(s) to ${target.account.label} / ${target.folder.name}.`);
        }
        catch (cause) {
            throw Error(`${count} of ${rows.length} messages moved. ${asError(cause).message}`);
        }
        finally {
            moving = false;
            input.disabled = false;
            closeButton.disabled = false;
            if (state.app === 'mail' && !state.dirty && !state.savePromise) {
                if (reload)
                    await reload([...completed]);
                else
                    await reloadMail(env);
            }
            if (env.dialog.open && form.isConnected) {
                render();
                input.focus();
            }
        }
    };
    input.oninput = () => { index = 0; render(); };
    input.onkeydown = event => {
        if (event.isComposing)
            return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            index = Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            render();
        }
    };
    list.onclick = event => { const button = event.target.closest('[data-match]'); if (button) {
        index = Number(button.dataset.match);
        void env.attempt(move);
    } };
    form.onsubmit = event => { event.preventDefault(); void env.attempt(move); };
    // Do not let a provider mutation outlive a dismissed dialog unnoticed.
    const cancel = (event) => { if (moving)
        event.preventDefault(); };
    env.dialog.addEventListener('cancel', cancel);
    env.dialog.addEventListener('close', () => env.dialog.removeEventListener('cancel', cancel), { once: true });
    render();
    input.focus();
    if (missing.length) {
        const results = await Promise.allSettled(missing.map(async (account) => { account.folders = (await env.api('mail-folders', { account: account.id })).folders; }));
        discoveryFailed = results.some(r => r.status === 'rejected');
        discovering = false;
        if (form.isConnected && env.dialog.open)
            render();
    }
}
