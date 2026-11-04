// Generated from frontend/item-types.ts by pnpm build. Do not edit.
/** Register future record types here; connection storage is independent of kind. */
export const itemTypes = {
    mail: { command: 'mail', label: 'Mail', fields: ['from', 'to', 'folder'] },
    calendar: { command: 'event', label: 'Event', fields: ['start', 'location'] },
    tasks: { command: 'task', label: 'Task', fields: ['due', 'priority'] },
    contacts: { command: 'contact', label: 'Contact', fields: ['email', 'company', 'phone'] },
    documents: { command: 'doc', label: 'Document', fields: [] },
    wiki: { command: 'page', label: 'Wiki page', fields: [] },
    sheets: { command: 'sheet', label: 'Sheet', fields: [] },
};
export const creationTypes = Object.fromEntries(Object.entries(itemTypes).map(([kind, type]) => [type.command, kind]));
