// Generated from frontend/commands.ts by pnpm build. Do not edit.
// Validation completes before any action runs. Extend this registry for new commands.
import { creationTypes } from './item-types.js';
export { creationTypes } from './item-types.js';
export const commandRegistry = {
    mail: { arguments: 0, aliases: ['m'], action: 'Switch to Mail', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    calendar: { arguments: 0, aliases: ['cal'], action: 'Switch to Calendar', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    tasks: { arguments: 0, aliases: ['t'], action: 'Switch to Tasks', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    contacts: { arguments: 0, aliases: ['con'], action: 'Switch to Contacts', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    docs: { arguments: 0, aliases: ['doc', 'd'], action: 'Switch to Documents', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    sheets: { arguments: 0, aliases: ['sh'], action: 'Switch to Sheets', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    wiki: { arguments: 0, aliases: ['w'], action: 'Switch to Wiki', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    settings: { arguments: 0, aliases: ['set'], action: 'Switch to Settings', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts and saves existing items.' },
    head: { arguments: 0, action: 'View original message headers', context: 'Selected mail message', options: 'No arguments; locally cached headers.' },
    q: { arguments: 0, action: 'Sign out', context: 'Normal mode', options: 'No arguments; prompts for unsaved drafts, saves existing items and returns to the password screen.' },
    log: { arguments: 0, action: 'Open activity log', context: 'Normal mode', options: 'All levels; no arguments.' },
    errors: { arguments: 0, action: 'Open activity errors', context: 'Normal mode', options: 'Errors filter; no arguments.' },
    warnings: { arguments: 0, action: 'Open activity warnings', context: 'Normal mode', options: 'Warnings filter; no arguments.' },
    new: { arguments: 1, action: 'Create an item', context: 'Normal mode', options: ':new [type], for example :new event. :new linked <type> links the saved new draft to the current item. ' + Object.entries(creationTypes).map(([type, app]) => type + ' → ' + app).join('; ') + '. Omit type for current app; type required in Settings.' },
    link: { arguments: 2, action: 'Link an existing item', context: 'Selected item', options: ':link [type] <name or ID>. Search titles and descriptions. ↑/↓ choose; Tab accepts; Enter links. Escape dismisses suggestions and keeps command mode.' },
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
export class CommandError extends Error {
}
export function connectionQuery(value) {
    const match = value.trimStart().replace(/^:/, '').trimStart().match(/^(link|unlink)(?:\s+(.*))?$/);
    if (!match)
        return null;
    const text = (match[2] || '').trim(), [type, ...rest] = text.split(/\s+/);
    return { name: match[1], kind: Object.hasOwn(creationTypes, type) ? creationTypes[type] : undefined, query: Object.hasOwn(creationTypes, type) ? rest.join(' ') : text };
}
export function resolveCommand(value) {
    const [name, ...args] = value.trim().replace(/^:/, '').trim().split(/\s+/);
    const command = Object.hasOwn(registry, name) ? name : aliases.get(name);
    if (!command)
        throw new CommandError('Unknown command' + (name ? ': ' + name : ''));
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
    if (command === 'new' && args[0] === 'linked') {
        if (args.length !== 2 || !Object.hasOwn(creationTypes, args[1]))
            throw new CommandError('Use :new linked <type>.');
        return { name: 'new', argument: creationTypes[args[1]], linked: true };
    }
    for (const [index, argument] of args.entries())
        if (index >= registry[command].arguments || (command === 'new' && !Object.hasOwn(creationTypes, argument)))
            throw new CommandError('Unknown parameter: ' + argument);
    return { name: command, argument: args.length ? creationTypes[args[0]] : undefined };
}
