// Generated from frontend/mail-reader.ts by pnpm build. Do not edit.
import { escapeHtml as e } from './formats.js';
const modes = new Map(), imageConsent = new Set(), originalColors = new Set();
export function mailBody(record, prefs) {
    if (record.meta.headerOnly === true) {
        if (Number(record.meta.messageSize || 0) <= 1400000)
            return '<div class="mail-body"><p class="recurrence-note">Message headers are available offline. The message body downloads when opened while connected.</p><button data-download-body>Download message body</button><span data-body-status role="status"></span></div>';
        const size = Number(record.meta.messageSize), label = Number.isFinite(size) ? (size / 1000000).toFixed(1) + ' MB' : 'larger than the download limit';
        return `<div class="mail-body"><p class="recurrence-note">This message is ${e(label)}. Office downloaded its headers; the body and attachments exceed the 1.4 MB download limit. Open the message in your email provider to read the full content.${record.meta.remote && record.meta.gmailMessageId ? ' You can still mark it read, move it, or move it to Trash in Office.' : ''}</p></div>`;
    }
    const hasHtml = record.meta.hasHtml === true;
    const mode = hasHtml ? modes.get(record.id) || (prefs.mailDisplay === 'text' ? 'text' : 'html') : 'text';
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const accent = ['green', 'blue', 'plum'].includes(document.documentElement.dataset.accent) ? document.documentElement.dataset.accent : 'green';
    return `<div class="mail-view-controls" role="group" aria-label="Email display"><button data-mail-mode="html" aria-pressed="${mode === 'html'}" ${hasHtml ? '' : 'disabled'}>HTML</button><button data-mail-mode="text" aria-pressed="${mode === 'text'}">Text only</button>${hasHtml && mode === 'html' ? `<button data-mail-colors aria-pressed="${originalColors.has(record.id)}">Original colors</button><button data-mail-images ${imageConsent.has(record.id) ? 'disabled' : ''}>${imageConsent.has(record.id) ? 'External images enabled' : 'Load images'}</button><small>External images may report that you opened this email.</small>` : hasHtml ? '' : '<small>This email contains only text.</small>'}</div>${mode === 'html' ? `<iframe class="mail-html" title="HTML email" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="mail-view.php?id=${encodeURIComponent(record.id)}&theme=${theme}&accent=${accent}${originalColors.has(record.id) ? '&colors=original' : ''}${imageConsent.has(record.id) ? '&images=1' : ''}"></iframe>` : `<div class="mail-body">${e(record.body)}</div>`}`;
}
export function bindMailReader(panel, record, render) {
    const colors = panel.querySelector('[data-mail-colors]');
    if (colors)
        colors.onclick = () => { if (originalColors.has(record.id))
            originalColors.delete(record.id);
        else
            originalColors.add(record.id); render(); };
    panel.querySelectorAll('[data-mail-mode]').forEach(button => button.onclick = () => { modes.set(record.id, button.dataset.mailMode); render(); });
    const images = panel.querySelector('[data-mail-images]');
    if (images)
        images.onclick = () => { imageConsent.add(record.id); render(); };
}
