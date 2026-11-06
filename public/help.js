// Generated from frontend/help.ts by pnpm build. Do not edit.
import { commandRegistry } from './commands.js';
export function helpEntries(k) {
    const rows = [];
    const add = (shortcut, action, context = 'Normal mode', options = '') => rows.push({ shortcut, action, context, options });
    add(k.help, 'Open keyboard and command help', 'Normal mode, including Settings', 'Remappable in Settings.');
    add(k.down + ' / ' + k.up, 'Next / previous item', 'Normal mode', 'Works from the list and nonediting content; scrolls a focused read-only mail body. Use arrows or Tab for spreadsheet cells.');
    add(k.left + ' / ' + k.right, 'Focus the pane to the left / right', 'Normal mode', 'Move between the application sidebar, item list, and selected content.');
    add(k.down + ' / ' + k.up + '; ArrowDown / ArrowUp', 'Focus next / previous sidebar entry', 'Application sidebar', 'Navigate apps, mail accounts, and visible folders. The Mail folder dropdown uses arrow keys to choose a folder.');
    add('Enter / Space', 'Activate the focused sidebar entry', 'Application sidebar', 'Enter opens an app, folder, or the focused account’s Inbox. Space expands or collapses account groups. Use the Mail folders button on narrow screens.');
    add('Backspace', 'Go up a folder or return to app selection', 'Mail sidebar', 'Opens the nearest selectable parent, then the account’s Inbox. From the Inbox, focuses the Mail app button and leaves the Inbox open.');
    add('ArrowDown / ArrowRight; ArrowUp / ArrowLeft', 'Next / previous item', 'Item lists', 'Down or Right moves to the next item; Up or Left moves to the previous item.');
    add('Ctrl+f / Ctrl+b', 'Page down / up', 'Focused list or nonediting content', 'Scrolls the focused pane, including HTML mail. Repeating the key continues scrolling.');
    add('Ctrl+d / Ctrl+u', 'Half page down / up', 'Focused list or nonediting content', 'Uses half the pane height. Editors and typing fields retain their native shortcuts.');
    add(k.pageDown + ' / ' + k.pageUp, 'Half page down / up', 'Focused list or nonediting content', 'Vimium-style scrolling; remappable in Settings. Uses half the pane height and supports key repeat.');
    add('ArrowDown / ArrowUp; PageDown / PageUp; Home / End', 'Scroll message; page down / up; top / bottom', 'Read-only mail body', 'Uses the same smooth scrolling in HTML and text. Respects reduced-motion preferences.');
    add('gg / G', 'First / last item', 'Normal mode', 'Keeps focus in the current pane; goes to top / bottom in a focused read-only mail body. Press g twice within 900 ms.');
    add('Tab / Shift+Tab', 'Enter selected content / return to list', 'Selected list row / content entry', 'Enters without editing. Standard controls and spreadsheet cells retain native Tab behavior.');
    add('g 1 … g 7', 'Switch application', 'Normal mode', '1 Mail; 2 Calendar; 3 Tasks; 4 Contacts; 5 Documents; 6 Wiki; 7 Sheets. Sequence timeout: 900 ms.');
    add(k.search, 'Search current application');
    add('n / N', 'Next / previous item in search results', 'Normal mode', 'Keeps focus in the current pane, including mail bodies.');
    add(k.connections || 'L', 'Open selected item connections', 'Normal mode', 'Remappable in Settings. Also available as :links or :l; add all for the workspace overview.');
    add(k.new, 'Create an item / compose');
    add(k.edit, 'Enter edit mode');
    add(k.select, 'Toggle current item selection');
    add(k.save, 'Save changes');
    add('Ctrl+S / Cmd+S', 'Save changes', 'Normal or insert mode, outside dialogs');
    add('Escape', 'Leave edit mode; clear selection otherwise', 'Outside dialogs', 'Saves existing items. New drafts stay unsaved until Save. In formula input, return focus to selected cell.');
    add(k.delete, 'Delete selected mail or current item', 'Normal mode', 'Local deletion requires confirmation. Connected mail moves to Trash; mail already in Trash and synced read-only items are protected.');
    add(k.undoDelete, 'Undo last mail deletion', 'Mail, normal mode', 'Includes batches; available for 15 minutes in this page.');
    add(k.completeTask || 'x', 'Mark current task complete', 'Tasks, normal mode', 'Already completed tasks stay complete. New drafts remain unsaved until Save.');
    add(k.archive, 'Archive messages', 'Mail, normal mode');
    add(k.move, 'Quick Move to folder', 'Mail, normal mode', 'Selected messages, or current message.');
    add(k.reply, 'Reply to message', 'Mail, normal mode');
    add('Ctrl+Enter', 'Send current message', 'Mail, normal or insert mode', 'Press Enter to confirm or Escape to cancel. Change confirmation in Settings → Mail.');
    add(':', 'Open command line', 'Normal mode, including Settings', 'Enter executes once. Escape dismisses suggestions while keeping command mode and text; with suggestions closed, Escape exits and restores focus.');
    for (const [name, entry] of Object.entries(commandRegistry))
        add(':' + name, entry.action, entry.context, entry.options + ('aliases' in entry ? ' Aliases: ' + entry.aliases.map(alias => ':' + alias).join(', ') + '.' : ''));
    add('Arrow keys', 'Move between cells', 'Sheets, focused cell', '30 rows × 12 columns; item shortcuts still navigate records.');
    add(k.edit + ' / Enter', 'Edit selected cell', 'Sheets, normal mode');
    add('Tab / Shift+Tab', 'Next / previous cell', 'Sheets, focused cell');
    add('/', 'Focus header search', 'Message headers, outside search field');
    add('n / p', 'Next / previous header match', 'Message headers, outside search field');
    add('Enter / Shift+Enter', 'Next / previous header match', 'Message headers search field');
    add(`${k.left} / ${k.down} / ${k.up} / ${k.right}; Arrow keys`, 'Navigate map cards', 'Connections map', `Left/right continue across row boundaries. In a single horizontal row, ${k.down} moves left and ${k.up} moves right. Focused items stay in view.`);
    add('Enter / Space', 'Explore or open focused item / select item', 'Connections map', 'Enter explores groups and item neighborhoods. When the selected item is already the neighborhood center, Enter opens its content, just like Open item.');
    add(k.search === '/' ? '/' : `/ / ${k.search}`, 'Search connected items', 'Connections window', 'Enter or Escape in search returns focus to the map. Typing fields retain their normal keys.');
    add('gg / G; Home / End', 'First / last map card', 'Connections map');
    add('Backspace', 'Go back through connections', 'Connections window, outside typing fields', 'Restores the previous map and focus. Without earlier history, moves up to the workspace overview; stays there when already at the top.');
    add('Enter / Space on From card', 'Return to the view you came from', 'Connections map', 'The faded From card and dashed line show your navigation path. Current identifies the neighborhood center independently of selection.');
    add('Active / Archived / All', 'Choose connection visibility', 'Connections toolbar', 'Active is the default. Archive or restore a group, the selected item’s connections, or a single link. Underlying items are unchanged.');
    add('Shift+Arrow keys; + / -', 'Pan / zoom the map', 'Connections map', 'Fit view remains available in the toolbar.');
    add('ArrowDown / ArrowUp', 'Choose matching folder', 'Quick Move search');
    add('Enter', 'Move to chosen folder', 'Quick Move');
    add('Escape', 'Cancel Quick Move', 'Quick Move', 'Cannot dismiss while a move is running.');
    add('Shift+F10 / Menu key', 'Open item action menu', 'List or nonediting content');
    add('ArrowDown / ArrowUp / Home / End', 'Focus next / previous / first / last action', 'Item action menu');
    add('Enter / Space', 'Run focused action', 'Item action menu');
    add('Escape / Tab', 'Close menu and return focus', 'Item action menu');
    add('Escape', 'Close mail disclosure, actions menu or narrow-screen folders', 'Mail', 'Returns focus to the relevant toggle.');
    add('Tab / Shift+Tab', 'Move focus forward / backward', 'Standard controls', 'Native buttons and disclosures use Enter / Space. Editors retain browser editing keys.');
    add('Escape', 'Close help or other dismissible dialog', 'Dialogs', 'Help returns focus to its opener.');
    return rows;
}
export function searchHelp(entries, query) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(entry => { const text = Object.values(entry).join(' ').toLocaleLowerCase(); return terms.every(term => text.includes(term)); });
}
export function openHelp(dialog, keys, escape, onClose) {
    const opener = document.activeElement, entries = helpEntries(keys);
    dialog.classList.add('help-dialog');
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">Keyboard shortcuts and commands</h2><button class="quiet" data-close aria-label="Close help">✕</button></div><div class="help-tools"><p>Normal mode navigates; insert mode types. Single-key actions use your current Settings bindings. Editors retain browser editing keys; full Vim operators are not implemented.</p><label>Search shortcuts and commands <input type="search" data-help-search autocomplete="off"></label><button data-help-clear>Clear search</button><span data-help-count role="status" aria-live="polite"></span></div><div class="help-results" tabindex="0" role="region" aria-label="Shortcut and command results"><table class="help-table"><thead><tr><th scope="col">Shortcut or command</th><th scope="col">Action</th><th scope="col">Context</th><th scope="col">Options/parameters</th></tr></thead><tbody></tbody></table><p data-help-empty hidden>No shortcuts or commands match your search.</p></div>`;
    const input = dialog.querySelector('[data-help-search]'), clear = dialog.querySelector('[data-help-clear]');
    const render = () => { const matches = searchHelp(entries, input.value); dialog.querySelector('tbody').innerHTML = matches.map(row => '<tr><td><kbd>' + escape(row.shortcut) + '</kbd></td><td>' + escape(row.action) + '</td><td>' + escape(row.context) + '</td><td>' + escape(row.options) + '</td></tr>').join(''); dialog.querySelector('[data-help-count]').textContent = matches.length + ' of ' + entries.length + ' entries'; dialog.querySelector('[data-help-empty]').hidden = !!matches.length; clear.disabled = !input.value; };
    input.oninput = render;
    clear.onclick = () => { input.value = ''; render(); input.focus(); };
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.classList.remove('help-dialog'); onClose(); if (opener?.isConnected)
        opener.focus({ preventScroll: true }); }, { once: true });
    render();
    dialog.showModal();
    input.focus();
}
