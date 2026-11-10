// Generated from frontend/calendar.ts by pnpm build. Do not edit.
import { escapeHtml as e } from './formats.js';
import { timestampLabel } from './time-labels.js';
export const calendarDisplayFields = [
    { name: 'month', label: 'Events per day in Month view', fallback: 3, max: 30 },
    { name: 'agenda', label: 'Events per batch in Calendar Agenda', fallback: 25, max: 100 },
    { name: 'header', label: 'Events per batch in the header agenda', fallback: 10, max: 100 },
];
export function calendarDisplayLimit(name, display) {
    const field = calendarDisplayFields.find(field => field.name === name);
    const value = display?.[name];
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= field.max ? value : field.fallback;
}
export const dateOnly = (value = '') => /^\d{4}-\d{2}-\d{2}$/.test(value);
export function calendarDate(value) { return dateOnly(value) ? new Date(value + 'T00:00:00') : new Date(value); }
export function dayKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function addDays(date, count) { const next = new Date(date); next.setDate(next.getDate() + count); return next; }
export function eventBounds(record) {
    const start = calendarDate(record.meta.start || '');
    let end = calendarDate(record.meta.end || '');
    if (!Number.isFinite(+start))
        return null;
    if (!Number.isFinite(+end) || end <= start)
        end = dateOnly(record.meta.start) ? addDays(start, 1) : new Date(+start + 3600000);
    return { start, end, allDay: dateOnly(record.meta.start) };
}
export function eventsOn(rows, day) { const end = addDays(day, 1); return rows.filter(r => { const b = eventBounds(r); return b && b.start < end && b.end > day; }).sort((a, b) => +(eventBounds(b).allDay) - +(eventBounds(a).allDay) || +eventBounds(a).start - +eventBounds(b).start); }
export function upcomingEvents(rows, now) {
    const until = addDays(now, 7);
    return rows.flatMap(record => {
        const bounds = eventBounds(record);
        return bounds && bounds.end > now && bounds.start < until ? [{ record, ...bounds }] : [];
    }).sort((a, b) => +a.start - +b.start);
}
export function agendaEventLabel({ start, end, allDay }, locale) {
    const date = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' });
    const duration = (value, unit) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 2 }).format(value);
    if (allDay) {
        const lastDay = new Date(+end - 1);
        const dates = dayKey(start) === dayKey(lastDay) ? date.format(start) : `${date.format(start)}–${date.format(lastDay)}`;
        // Count calendar dates so daylight-saving transitions do not affect the duration.
        const days = (Date.parse(dayKey(lastDay)) - Date.parse(dayKey(start))) / 86400000 + 1;
        return `${dates} · All day (${duration(days, 'day')})`;
    }
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const range = dayKey(start) === dayKey(end)
        ? `${date.format(start)} · ${time.format(start)}–${time.format(end)}`
        : `${date.format(start)}, ${time.format(start)}–${date.format(end)}, ${time.format(end)}`;
    const minutes = (+end - +start) / 60000;
    return `${range} (${minutes < 60 ? duration(minutes, 'minute') : duration(minutes / 60, 'hour')})`;
}
/** Assign overlapping intervals stable columns; touching endpoints can share a column. */
export function timedLayout(rows, day) {
    const entries = eventsOn(rows, day).filter(r => !eventBounds(r).allDay).map(record => { const b = eventBounds(record); const start = b.start < day ? 0 : b.start.getHours() * 60 + b.start.getMinutes(); const end = b.end >= addDays(day, 1) ? 1440 : b.end.getHours() * 60 + b.end.getMinutes(); return { record, start, end: Math.max(start + 15, end), column: 0, columns: 1 }; });
    let group = [], ends = [];
    const finish = () => { for (const entry of group)
        entry.columns = ends.length; group = []; ends = []; };
    for (const entry of entries) {
        if (group.length && entry.start >= Math.max(...ends))
            finish();
        let column = ends.findIndex(end => end <= entry.start);
        if (column < 0)
            column = ends.length;
        entry.column = column;
        ends[column] = entry.end;
        group.push(entry);
    }
    finish();
    return entries;
}
const colors = ['#3a8c72', '#5579c6', '#b56c96', '#bb8436', '#7d70b4', '#43959e'];
const calendarSourceId = (record) => record.meta.account ? record.meta.calendarSource || record.meta.account : 'local';
export function calendarSources(rows, accounts, aliases = {}) {
    const sources = new Map([['local', 'Local calendar']]);
    for (const account of accounts) {
        if (account.type === 'google' || account.type === 'caldav')
            sources.set(account.id, account.label);
        const calendars = account.calendar?.calendars ?? [];
        for (const calendar of calendars) {
            const label = calendars.length === 1 ? account.label : `${account.label} — ${calendar.label}`;
            sources.set(calendar.id, label);
        }
    }
    for (const row of rows) {
        const id = calendarSourceId(row);
        if (!sources.has(id))
            sources.set(id, id);
    }
    return Array.from(sources, ([id, originalLabel], index) => ({
        id, originalLabel, label: aliases && Object.hasOwn(aliases, id) && typeof aliases[id] === 'string' && aliases[id].trim() ? aliases[id] : originalLabel,
        color: colors[index % colors.length],
    }));
}
export function connectedCalendarSources(accounts, sources) {
    return accounts.flatMap(account => {
        const ids = account.type === 'imap' ? account.calendar?.calendars.map(calendar => calendar.id) ?? []
            : account.type === 'google' && account.googleCalendarEnabled === false ? [] : [account.id];
        return ids.map(source => ({ account: account.id, source, label: sources.find(calendar => calendar.id === source)?.label ?? account.label }));
    });
}
export function createCalendar(env) {
    let anchor = calendarDate(dayKey(new Date()));
    let chosenView;
    let compactSourcesOpen = false;
    let agendaDate = '', agendaVisible = 0, agendaEarlier = 0;
    const hidden = new Set();
    function render() {
        const host = document.querySelector('#calendar-surface');
        if (!host)
            return;
        const focused = document.activeElement;
        const focusAttribute = focused && host.contains(focused) ? Array.from(focused.attributes).find(a => ['data-period', 'data-view', 'data-source', 'data-rename-calendar', 'data-jump'].includes(a.name)) : undefined;
        let selectedRendered = false;
        const compact = env.compact();
        const query = env.query().trim();
        const view = query ? 'agenda' : chosenView || (compact ? 'agenda' : 'month');
        const sources = calendarSources(env.allRows(), env.accounts(), env.aliases()), rows = env.rows();
        const display = env.display();
        const sourceRows = sources.map(s => `<div class="calendar-source"><label><input type="checkbox" data-source="${e(s.id)}" ${hidden.has(s.id) ? '' : 'checked'} data-calendar-style="accent-color:${s.color}"><span aria-hidden="true" data-calendar-style="color:${s.color}">●</span><span class="calendar-source-name">${e(s.label)}</span></label><button type="button" class="quiet calendar-source-rename" data-rename-calendar="${e(s.id)}" aria-label="Rename calendar ${e(s.label)}" title="Rename calendar">${env.renameIcon}</button></div>`).join('');
        const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1), monthStart = addDays(first, -first.getDay());
        if (view !== 'agenda' || query || agendaDate !== dayKey(anchor)) {
            agendaDate = dayKey(anchor);
            agendaVisible = 0;
            agendaEarlier = 0;
        }
        const start = view === 'month' ? monthStart : view === 'week' ? addDays(anchor, -anchor.getDay()) : anchor;
        const days = Array.from({ length: view === 'month' ? 42 : view === 'week' ? 7 : 1 }, (_, i) => addDays(start, i));
        const color = (r) => sources.find(s => s.id === calendarSourceId(r))?.color || colors[0];
        const event = (r, day, style = '') => {
            const selected = env.current() === r.id, id = selected && !selectedRendered ? 'id="selected-item"' : '';
            if (selected)
                selectedRendered = true;
            const bounds = eventBounds(r);
            const time = bounds && !bounds.allDay && (!day || bounds.start >= day)
                ? `<time>${e(bounds.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time> ` : '';
            return `<button class="calendar-event item ${selected ? 'selected' : ''}" data-id="${e(r.id)}" ${id} data-calendar-style="--event-color:${color(r)};${style}" title="${e(r.title)}" aria-pressed="${selected}">${time}${e(r.title)}</button>`;
        };
        const dayButton = (d) => `<button class="calendar-date ${dayKey(d) === dayKey(new Date()) ? 'today' : ''}" data-day="${dayKey(d)}" aria-label="New event on ${e(d.toLocaleDateString())}">${d.getDate()}</button>`;
        const title = query ? 'Search results' : view === 'day' ? anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : view === 'week' ? `${start.toLocaleDateString()} – ${days[6].toLocaleDateString()}` : anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const mini = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<span>${d[0]}</span>`).join('') + Array.from({ length: 42 }, (_, i) => { const d = addDays(monthStart, i); return `<button data-jump="${dayKey(d)}" class="${d.getMonth() !== anchor.getMonth() ? 'muted' : ''} ${dayKey(d) === dayKey(anchor) ? 'primary' : ''}" aria-label="${e(d.toLocaleDateString())}">${d.getDate()}</button>`; }).join('');
        let content = '';
        if (view === 'month') {
            const multiDay = new Set(rows.filter(r => {
                const bounds = eventBounds(r);
                return bounds && dayKey(bounds.start) !== dayKey(new Date(+bounds.end - 1));
            }));
            const cells = days.map(d => {
                const list = eventsOn(rows, d);
                const monthLimit = calendarDisplayLimit('month', display);
                const spanning = list.filter(r => multiDay.has(r));
                const limit = display?.month === undefined ? Math.max(monthLimit, spanning.length) : monthLimit;
                const shown = new Set([...spanning, ...list.filter(r => !multiDay.has(r))].slice(0, limit));
                const visible = list.filter(r => shown.has(r));
                const more = list.length - visible.length;
                return `<section class="calendar-day ${d.getMonth() !== anchor.getMonth() ? 'outside' : ''}">${dayButton(d)}${visible.map(r => event(r, d)).join('')}${more ? `<button class="calendar-more" data-jump="${dayKey(d)}">+${more} more</button>` : ''}</section>`;
            }).join('');
            content = `<div class="calendar-month">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="calendar-weekday">${d}</div>`).join('')}${cells}</div>`;
        }
        else if (view === 'agenda') {
            const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
            const entries = rows.map(record => ({ record, bounds: eventBounds(record) }))
                .filter(({ bounds }) => query || !bounds || (bounds.start < nextMonth && bounds.end > first))
                .sort((a, b) => (a.bounds ? +a.bounds.start : Infinity) - (b.bounds ? +b.bounds.start : Infinity));
            const limit = calendarDisplayLimit('agenda', display);
            const selectedIndex = entries.findIndex(({ record }) => record.id === env.current());
            const firstAtAnchor = entries.findIndex(({ bounds }) => bounds && bounds.end > anchor);
            const pivot = Math.max(0, firstAtAnchor);
            const begin = query ? 0 : Math.max(0, Math.min(pivot - agendaEarlier, selectedIndex < 0 ? pivot : selectedIndex));
            const end = query ? entries.length : Math.min(entries.length, Math.max(pivot + limit, pivot + agendaVisible, selectedIndex + 1));
            const shown = entries.slice(begin, end);
            const dateMarker = query ? '' : `<h3 data-agenda-date="${dayKey(anchor)}">${e(anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</h3>`;
            const entriesHtml = shown.map(({ record, bounds }, index) => {
                const date = bounds ? timestampLabel(record.meta.start || '', bounds.start.toLocaleDateString()) : 'No date';
                const source = sources.find(s => s.id === calendarSourceId(record))?.label;
                return `${index + begin === firstAtAnchor ? dateMarker : ''}<div><span>${date}${query && source ? ` · ${e(source)}` : ''}</span>${event(record)}</div>`;
            }).join('');
            const earlier = begin ? `<button type="button" data-agenda-earlier>Show earlier (${begin} remaining)</button>` : '';
            const more = end < entries.length ? `<button type="button" data-agenda-more>Show more (${entries.length - end} remaining)</button>` : '';
            const searchProvider = query && connectedCalendarSources(env.accounts(), sources).length
                ? '<button type="button" data-action="calendar-search">Search connected calendars</button>' : '';
            content = `${searchProvider}<div class="calendar-agenda">${earlier}${entriesHtml}${firstAtAnchor < 0 ? dateMarker : ''}${more}${entries.length ? '' : `<p>${query ? 'No matching events stored in Office.' : 'No events for this period.'}</p>`}</div>`;
            if (!query) {
                agendaVisible = end - pivot;
                agendaEarlier = pivot - begin;
            }
        }
        else
            content = `<div class="calendar-time-scroll"><div class="calendar-time-grid" data-calendar-style="--day-count:${days.length}"><div class="calendar-time-label">All day</div>${days.map(d => `<section class="calendar-all-day"><strong>${e(d.toLocaleDateString(undefined, { weekday: 'short' }))}</strong>${dayButton(d)}${eventsOn(rows, d).filter(r => dateOnly(r.meta.start)).map(r => event(r, d)).join('')}</section>`).join('')}<div class="calendar-hours">${Array.from({ length: 24 }, (_, h) => `<span>${String(h).padStart(2, '0')}:00</span>`).join('')}</div>${days.map(d => `<div class="calendar-time-day">${Array.from({ length: 24 }, (_, h) => `<button class="calendar-slot" data-slot="${dayKey(d)}T${String(h).padStart(2, '0')}:00" aria-label="New event ${dayKey(d)} ${h}:00"></button>`).join('')}${timedLayout(rows, d).map(x => event(x.record, d, `position:absolute;top:${x.start / 60 * 48}px;height:${Math.max(20, (x.end - x.start) / 60 * 48)}px;left:${x.column / x.columns * 100}%;width:${100 / x.columns}%`)).join('')}</div>`).join('')}</div></div>`;
        const undated = rows.filter(r => !eventBounds(r));
        host.innerHTML = `<div class="calendar-toolbar"><div><button data-period="today">Today</button><button data-period="prev" ${env.query() ? 'disabled' : ''} aria-label="Previous period">‹</button><button data-period="next" ${env.query() ? 'disabled' : ''} aria-label="Next period">›</button></div><h2 aria-live="polite">${e(title)}</h2><div role="group" aria-label="Calendar view">${['month', 'week', 'day', 'agenda'].map(v => `<button data-view="${v}" aria-pressed="${view === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div><div class="calendar-layout"><aside class="calendar-sidebar"><strong>${e(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</strong><div class="calendar-mini">${mini}</div><details class="calendar-sources" ${!compact || compactSourcesOpen ? 'open' : ''}><summary>Calendars</summary>${sourceRows}<p class="muted">Cached events only. Connected calendars are read only.</p></details></aside><div id="items" class="calendar-board list-pane" role="region" aria-label="Calendar events">${content}${view !== 'agenda' && undated.length ? `<section class="calendar-undated"><h3>Unscheduled</h3>${undated.map(r => event(r)).join('')}</section>` : ''}</div></div>`;
        const sourceMenu = host.querySelector('details');
        sourceMenu.ontoggle = () => { if (compact)
            compactSourcesOpen = sourceMenu.open; };
        host.querySelectorAll('[data-calendar-style]').forEach(node => { node.style.cssText = node.dataset.calendarStyle; node.removeAttribute('data-calendar-style'); });
        host.querySelectorAll('[data-view]').forEach(b => b.onclick = () => env.error(async () => { await env.before(); chosenView = b.dataset.view; render(); showAgendaDate(); }));
        host.querySelectorAll('[data-agenda-more],[data-agenda-earlier]').forEach(button => {
            button.onclick = () => {
                const earlier = button.hasAttribute('data-agenda-earlier');
                const firstNew = earlier ? 0 : agendaVisible + agendaEarlier;
                const scrolled = host.scrollTop;
                if (earlier)
                    agendaEarlier += calendarDisplayLimit('agenda', display);
                else
                    agendaVisible += calendarDisplayLimit('agenda', display);
                render();
                host.scrollTop = scrolled;
                host.querySelectorAll('.calendar-agenda [data-id]')[firstNew]?.focus();
            };
        });
        host.querySelectorAll('[data-period]').forEach(b => b.onclick = () => env.error(async () => { await env.before(); if (b.dataset.period === 'today')
            anchor = calendarDate(dayKey(new Date()));
        else {
            const n = b.dataset.period === 'prev' ? -1 : 1;
            if (view === 'month' || view === 'agenda')
                anchor = new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
            else
                anchor = addDays(anchor, n * (view === 'week' ? 7 : 1));
        } render(); if (b.dataset.period === 'today')
            showAgendaDate(); }));
        host.querySelectorAll('[data-source]').forEach(b => b.onchange = () => { if (b.checked)
            hidden.delete(b.dataset.source);
        else
            hidden.add(b.dataset.source); render(); });
        host.querySelectorAll('[data-rename-calendar]').forEach((button, index) => {
            button.onclick = () => env.error(async () => { await env.before(); env.rename(sources[index]); });
        });
        host.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => env.error(async () => { await env.before(); anchor = calendarDate(b.dataset.jump); chosenView = 'day'; render(); }));
        host.querySelectorAll('[data-day],[data-slot]').forEach(b => b.onclick = () => { const start = b.dataset.slot || b.dataset.day; env.error(() => env.create(start, dateOnly(start) ? dayKey(addDays(calendarDate(start), 1)) : new Date(+calendarDate(start) + 3600000).toISOString())); });
        if (focusAttribute)
            host.querySelector(`[${focusAttribute.name}="${CSS.escape(focusAttribute.value)}"]`)?.focus({ preventScroll: true });
    }
    function showAgendaDate() { document.querySelector('[data-agenda-date]')?.scrollIntoView({ block: 'nearest' }); }
    function ensureVisible(id, reveal = false) { if (reveal) {
        const item = env.allRows().find(r => r.id === id);
        if (item)
            hidden.delete(calendarSourceId(item));
    } const row = env.rows().find(r => r.id === id); if (!row)
        return; if (!env.query().trim() && !isVisible(row))
        return; if (!document.querySelector(`#items [data-id="${CSS.escape(id)}"]`)) {
        const bounds = eventBounds(row);
        if (bounds) {
            anchor = calendarDate(dayKey(bounds.start));
            chosenView = 'day';
        }
        else
            chosenView = 'agenda';
        render();
    } }
    function isVisible(record) { return !hidden.has(calendarSourceId(record)); }
    const position = () => ({ anchor, chosenView, hidden: [...hidden], compactSourcesOpen });
    function restorePosition(view) {
        ({ anchor, chosenView, compactSourcesOpen } = view);
        hidden.clear();
        view.hidden.forEach(source => hidden.add(source));
    }
    return { render, showAgendaDate, ensureVisible, isVisible, position, restorePosition };
}
