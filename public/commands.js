// Generated from frontend/commands.ts by pnpm build. Do not edit.
// Validation completes before any action runs. Extend this registry for new commands.
export const creationTypes = { mail: 'mail', event: 'calendar', task: 'tasks', contact: 'contacts', doc: 'documents', page: 'wiki', sheet: 'sheets' };
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
    new: { arguments: 1, action: 'Create an item', context: 'Normal mode', options: ':new [type], for example :new event. ' + Object.entries(creationTypes).map(([type, app]) => type + ' → ' + ({ mail: 'Mail', calendar: 'Calendar', tasks: 'Tasks', contacts: 'Contacts', documents: 'Documents', wiki: 'Wiki', sheets: 'Sheets' }[app])).join('; ') + '. Omit type for current app; type required in Settings.' },
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
export function resolveCommand(value) {
    const [name, ...args] = value.trim().replace(/^:/, '').trim().split(/\s+/);
    const command = Object.hasOwn(registry, name) ? name : aliases.get(name);
    if (!command)
        throw new CommandError('Unknown command' + (name ? ': ' + name : ''));
    for (const [index, argument] of args.entries())
        if (index >= registry[command].arguments || (command === 'new' && !Object.hasOwn(creationTypes, argument)))
            throw new CommandError('Unknown parameter: ' + argument);
    return { name: command, argument: args.length ? creationTypes[args[0]] : undefined };
}
