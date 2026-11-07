// Generated from frontend/commands.ts by pnpm build. Do not edit.
// Validation completes before any action runs. Extend this registry for new commands.
import { creationTypes } from './item-types.js';
export { creationTypes } from './item-types.js';
export const commandRegistry = {
    mail: { arguments: 1, aliases: ['m'], action: 'Switch to Mail', context: 'Normal mode', options: ':mail [account name or ID] opens the account’s Inbox. Type a space for suggestions. Use ↑/↓ to choose, Tab to fill, and Enter to open.' },
    calendar: { arguments: 0, aliases: ['cal'], action: 'Switch to Calendar', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    tasks: { arguments: 0, aliases: ['t'], action: 'Switch to Tasks', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    contacts: { arguments: 0, aliases: ['con'], action: 'Switch to Contacts', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    docs: { arguments: 0, aliases: ['doc', 'd'], action: 'Switch to Documents', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    sheets: { arguments: 0, aliases: ['sh'], action: 'Switch to Sheets', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    wiki: { arguments: 0, aliases: ['w'], action: 'Switch to Wiki', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    lists: { arguments: 0, action: 'Switch to Lists', context: 'Normal mode', options: 'No arguments. Prompts for unsaved drafts and saves existing lists.' },
    settings: { arguments: 0, aliases: ['set'], action: 'Switch to Settings', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    backup: { arguments: 0, action: 'Open Backups settings', context: 'Normal mode', options: 'No arguments. Open Settings → Backups to prepare a SQLite backup.' },
    sync: { arguments: 1, action: 'Sync connected accounts', context: 'Normal mode, including Settings', options: ':sync [account name or ID]. Omit the account to sync all. Type a space after :sync for suggestions. Use ↑/↓ to choose, Tab to fill, and Enter to sync.' },
    head: { arguments: 0, action: 'View original message headers', context: 'Selected mail message', options: 'No arguments; locally cached headers.' },
    q: { arguments: 0, action: 'Sign out', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts, saves existing items and returns to the password screen.' },
    log: { arguments: 0, action: 'Open activity log', context: 'Normal mode', options: 'All levels; no arguments.' },
    errors: { arguments: 0, action: 'Open activity errors', context: 'Normal mode', options: 'Errors filter; no arguments.' },
    warnings: { arguments: 0, action: 'Open activity warnings', context: 'Normal mode', options: 'Warnings filter; no arguments.' },
    new: { arguments: 2, action: 'Create an item', context: 'Normal mode', options: ':new [type] [title], for example :new event Project kickoff. Use :new "Project kickoff" for the current application. :new linked <type> [title] links the draft to the current item on first save. ' + Object.entries(creationTypes).map(([type, app]) => type + ' → ' + app).join('; ') + '. Type required in Settings.' },
    link: { arguments: 2, action: 'Link an existing item', context: 'Selected item', options: ':link [type] <name or ID>. Enter a type to browse its items, or search titles and descriptions. ↑/↓ choose; Tab accepts; Enter links. Escape dismisses suggestions and keeps command mode.' },
    unlink: { arguments: 2, action: 'Remove a connection', context: 'Selected item', options: ':unlink [type] <name or ID>. Only current connections are suggested.' },
    links: { arguments: 1, aliases: ['l'], action: 'View connections', context: 'Selected item or workspace', options: ':links opens current connections; :links all opens the workspace list and graph.' },
};
const registry = commandRegistry;
const aliases = new Map();
for (const name of Object.keys(registry)) {
    const entry = registry[name];
    if ('aliases' in entry)
        for (const alias of entry.aliases)
            aliases.set(alias, name);
}
export function commandNameSuggestions(value) {
    const prefix = value.trimStart().match(/^:([^\s:]+)$/)?.[1];
    if (!prefix || Object.hasOwn(registry, prefix) || aliases.has(prefix))
        return [];
    return Object.keys(registry).filter(name => name.startsWith(prefix));
}
export class CommandError extends Error {
}
export function accountCommandQuery(value) {
    const match = value.trimStart().replace(/^:/, '').trimStart().match(/^(\S+)\s+([\s\S]*)$/);
    if (!match)
        return;
    const [, token, parameters] = match;
    const name = aliases.get(token) || token;
    if (name !== 'mail' && name !== 'sync')
        return;
    let query = parameters.trim();
    if (query.startsWith('"') && query.endsWith('"')) {
        try {
            query = JSON.parse(query);
        }
        catch { /* Keep the typed text. */ }
    }
    return { name, token, query };
}
export function connectionQuery(value) {
    const match = value.trimStart().replace(/^:/, '').trimStart().match(/^(link|unlink)(?:\s+(.*))?$/);
    if (!match)
        return null;
    const text = (match[2] || '').trim(), [type, ...rest] = text.split(/\s+/);
    return { name: match[1], kind: Object.hasOwn(creationTypes, type) ? creationTypes[type] : undefined, query: Object.hasOwn(creationTypes, type) ? rest.join(' ') : text };
}
export function resolveCommand(value) {
    const input = value.trim().replace(/^:/, '').trim();
    const [name, ...args] = input.split(/\s+/);
    const command = Object.hasOwn(registry, name) ? name : aliases.get(name);
    if (!command)
        throw new CommandError('Unknown command' + (name ? ': ' + name : ''));
    if (command === 'sync' || command === 'mail')
        return { name: command, argument: args.length ? accountCommandQuery(value)?.query : undefined };
    if (command === 'link' || command === 'unlink') {
        const query = connectionQuery(value);
        if (!query.query)
            throw new CommandError('Choose an item name or ID.');
        return { name: command, argument: query.query, kind: query.kind };
    }
    if (command === 'links') {
        if (args.length > 1 || args.length === 1 && args[0] !== 'all')
            throw new CommandError('Use :links or :links all.');
        return { name: command, argument: args[0] };
    }
    if (command === 'new') {
        const parameters = input.slice(name.length).trimStart();
        if (!parameters)
            return { name: command, argument: undefined };
        const quotedTitle = parameters.match(/^"([^"]*)"$/)?.[1].trim();
        if (quotedTitle)
            return { name: command, title: quotedTitle };
        const linked = args[0] === 'linked';
        const type = args[linked ? 1 : 0];
        if (!Object.hasOwn(creationTypes, type)) {
            if (linked)
                throw new CommandError('Use :new linked <type> [title].');
            throw new CommandError('Unknown parameter: ' + type);
        }
        const typedParameters = linked ? parameters.slice('linked'.length).trimStart() : parameters;
        const title = typedParameters.slice(type.length).trimStart();
        const result = { name: command, argument: creationTypes[type] };
        if (linked)
            result.linked = true;
        if (title)
            result.title = title;
        return result;
    }
    if (args.length)
        throw new CommandError('Unknown parameter: ' + args[0]);
    return { name: command, argument: undefined };
}
