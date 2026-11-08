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
  add: 'M12 5v14 M5 12h14',
  edit: 'M4 20l1-5L16 4a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3L9 19l-5 1z M14 6l4 4',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  attach: 'M8 13l7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9 M8 13a1.5 1.5 0 0 0 2 2l6-6',
  link: 'M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2 M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2',
  connections: 'M9 10l6-4 M9 14l6 4 M9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  unlink: 'M7 13l-2 2a3 3 0 0 0 4 4l3-3 M12 8l3-3a3 3 0 0 1 4 4l-2 2 M5 5l14 14',
};

export function mobileIcon(icon: keyof typeof mobileIconPaths) {
  return `<svg class="mobile-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${mobileIconPaths[icon]}"/></svg>`;
}

export function mobileActionLabel(icon: keyof typeof mobileIconPaths, desktopLabel: string) {
  return `${mobileIcon(icon)}<span class="mobile-icon-label">${desktopLabel}</span>`;
}

export function mobileDisclosure(id: string, label: string, buttonId=id+'-toggle', icon?: keyof typeof mobileIconPaths) {
  return `<button type="button" id="${buttonId}" class="mobile-only mobile-disclosure${icon?' mobile-icon-button':''}" data-action="mobile-disclosure" aria-controls="${id}" aria-expanded="false"${icon?` aria-label="${label}" title="${label}"`:''}>${icon?mobileIcon(icon):label}</button>`;
}

export function setDisclosure(button: HTMLElement | null, open: boolean) {
  const panel = document.getElementById(button?.getAttribute('aria-controls') || '');
  button?.setAttribute('aria-expanded', String(open));
  panel?.classList.toggle('mobile-expanded', open);
}
