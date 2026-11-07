const railWidth = 65;
const collapseThreshold = 150;
const listMinimum = 180;
const detailMinimum = 320;
const step = 16;
const narrow = matchMedia('(max-width: 800px)');
type Panel = 'sidebar' | 'list';

export function panelSplitter(panel: Panel) {
  const label = panel === 'sidebar' ? 'Application sidebar width' : 'Item list width';
  return `<div class="panel-splitter" data-resize-panel="${panel}" role="separator" tabindex="0" aria-label="${label}" aria-orientation="vertical" aria-controls="${panel === 'sidebar' ? 'app-sidebar' : 'item-list-pane'}"></div>`;
}

export function setupPanelSizing(shell: HTMLElement, onCollapseChange: () => void) {
  const storageKey = (panel: Panel) => `office-panel-width-${panel}`;
  const preferred: Partial<Record<Panel, number>> = {};
  for (const panel of ['sidebar', 'list'] as const) {
    try {
      const width = Number(localStorage.getItem(storageKey(panel)));
      if (Number.isFinite(width) && width > 0) preferred[panel] = width;
    } catch { /* Use the default when storage is unavailable. */ }
  }

  const widths = {sidebar: railWidth, list: listMinimum};
  const bounds = (panel: Panel) => panel === 'sidebar'
    ? {min: railWidth, max: Math.min(440, shell.clientWidth - listMinimum - detailMinimum)}
    : {min: listMinimum, max: shell.clientWidth - widths.sidebar - detailMinimum};

  function refresh() {
    if (!shell.isConnected) return;
    const medium = shell.clientWidth <= 1100;
    const defaultSidebar = shell.classList.contains('mail-active') ? 260 : medium ? 180 : 210;
    const sidebar = preferred.sidebar ?? defaultSidebar;
    const collapsed = narrow.matches || sidebar < collapseThreshold;
    const changed = shell.classList.contains('sidebar-collapsed') !== collapsed;
    shell.classList.toggle('sidebar-collapsed', collapsed);
    widths.sidebar = collapsed ? railWidth : Math.min(sidebar, bounds('sidebar').max);
    widths.list = Math.max(listMinimum, Math.min(preferred.list ?? (medium ? 250 : 300), bounds('list').max));
    for (const panel of ['sidebar', 'list'] as const) {
      shell.style.setProperty(`--${panel}-width`, `${widths[panel]}px`);
      const handle = shell.querySelector(`[data-resize-panel="${panel}"]`);
      if (!handle || narrow.matches) continue;
      const {min, max} = bounds(panel);
      handle.setAttribute('aria-valuemin', String(min));
      handle.setAttribute('aria-valuemax', String(max));
      handle.setAttribute('aria-valuenow', String(widths[panel]));
      handle.setAttribute('aria-valuetext', panel === 'sidebar' && collapsed ? 'Collapsed' : `${widths[panel]} pixels`);
    }
    if (changed) onCollapseChange();
  }

  function bind(handle: HTMLElement) {
    const panel = handle.dataset.resizePanel as Panel;
    const setWidth = (target: number) => {
      const {min, max} = bounds(panel);
      preferred[panel] = panel === 'sidebar' && target < collapseThreshold ? railWidth : Math.round(Math.max(min, Math.min(max, target)));
      refresh();
    };
    const save = () => {
      try { localStorage.setItem(storageKey(panel), String(preferred[panel])); } catch { /* Keep the width for this session. */ }
    };

    let drag: {id: number; startX: number; width: number} | undefined;
    handle.onpointerdown = event => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      drag = {id: event.pointerId, startX: event.clientX, width: widths[panel]};
      handle.setPointerCapture(event.pointerId);
      handle.dataset.dragging = '';
    };
    handle.onpointermove = event => {
      if (drag?.id === event.pointerId && !narrow.matches) setWidth(drag.width + event.clientX - drag.startX);
    };
    handle.onlostpointercapture = event => {
      if (drag?.id !== event.pointerId) return;
      drag = undefined;
      delete handle.dataset.dragging;
      if (preferred[panel] !== undefined) save();
    };
    handle.onkeydown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const {min, max} = bounds(panel);
      const current = widths[panel];
      let target: number;
      switch (event.key) {
        case 'ArrowLeft': target = current - step; break;
        case 'ArrowRight': target = panel === 'sidebar' ? Math.max(collapseThreshold, current + step) : current + step; break;
        case 'Home': target = min; break;
        case 'End': target = max; break;
        default: return;
      }
      event.preventDefault();
      setWidth(target);
      save();
    };
  }

  bind(shell.querySelector<HTMLElement>('[data-resize-panel="sidebar"]')!);
  refresh();
  return {refresh, bindList: (handle: HTMLElement) => { bind(handle); refresh(); }};
}
