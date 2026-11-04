// Generated from frontend/time-labels.ts by pnpm build. Do not edit.
import { escapeHtml as e } from './formats.js';
let enabled = true;
// Date-only values represent local calendar days, not midnight UTC.
export function timestampTime(value) {
    return +new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00' : value);
}
export function elapsedTime(value, now = Date.now()) {
    const time = timestampTime(value);
    if (!Number.isFinite(time) || !Number.isFinite(now))
        return '';
    const seconds = Math.floor(Math.abs(now - time) / 1000);
    if (seconds < 60)
        return 'now';
    const [size, unit] = seconds < 3600 ? [60, 'minute'] : seconds < 86400 ? [3600, 'hour'] : [86400, 'day'];
    const count = Math.floor(seconds / Number(size)), text = `${count} ${unit}${count === 1 ? '' : 's'}`;
    return time > now && seconds > 0 ? `in ${text}` : `${text} ago`;
}
export function timestampText(value, label, now = Date.now()) {
    const elapsed = enabled ? elapsedTime(value, now) : '';
    return label + (elapsed ? ` (${elapsed})` : '');
}
export function timestampLabel(value, label) {
    if (!Number.isFinite(timestampTime(value)))
        return e(label);
    const elapsed = elapsedTime(value);
    return `${e(label)}<span data-elapsed-time="${e(value)}"${enabled ? '' : ' hidden'}>${elapsed ? ` (${e(elapsed)})` : ''}</span>`;
}
export function refreshTimeLabels(root = document, now = Date.now()) {
    root.querySelectorAll('[data-elapsed-time]').forEach(node => {
        node.hidden = !enabled;
        const elapsed = elapsedTime(node.dataset.elapsedTime || '', now), text = elapsed ? ` (${elapsed})` : '';
        if (node.textContent !== text)
            node.textContent = text;
    });
}
export function configureTimeLabels(value) { enabled = value; refreshTimeLabels(); }
