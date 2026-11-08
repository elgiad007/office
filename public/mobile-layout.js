// Generated from frontend/mobile-layout.ts by pnpm build. Do not edit.
export const phoneLayout = matchMedia('(max-width: 800px), (max-width: 950px) and (max-height: 550px) and (pointer: coarse)');
const mobileIconPaths = {
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    back: 'M19 12H5 M12 5l-7 7 7 7',
    close: 'M6 6l12 12 M18 6 6 18',
    folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11H3z',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    listView: 'M4 6h5m4 0h7 M4 12h9m4 0h3 M4 18h3m4 0h9 M9 3v6 M17 9v6 M7 15v6',
    refresh: 'M20 11a8 8 0 0 0-14-5L4 8 M4 3v5h5 M4 13a8 8 0 0 0 14 5l2-2 M20 21v-5h-5',
    formatting: 'M4 6h16 M12 6v13 M8 19h8 M4 6v3 M20 6v3',
};
export function mobileIcon(icon) {
    return `<svg class="mobile-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${mobileIconPaths[icon]}"/></svg>`;
}
export function mobileDisclosure(id, label, buttonId = id + '-toggle', icon) {
    return `<button type="button" id="${buttonId}" class="mobile-only mobile-disclosure${icon ? ' mobile-icon-button' : ''}" data-action="mobile-disclosure" aria-controls="${id}" aria-expanded="false"${icon ? ` aria-label="${label}" title="${label}"` : ''}>${icon ? mobileIcon(icon) : label}</button>`;
}
export function setDisclosure(button, open) {
    const panel = document.getElementById(button?.getAttribute('aria-controls') || '');
    button?.setAttribute('aria-expanded', String(open));
    panel?.classList.toggle('mobile-expanded', open);
}
