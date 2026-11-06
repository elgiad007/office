// Generated from frontend/mail-reader.ts by pnpm build. Do not edit.
import { escapeHtml as e } from './formats.js';
const modes = new Map(), imageConsent = new Set(), originalColors = new Set();
const imageConsentPrefix = 'office:mail-images:';
function hasImageConsent(id) {
    if (imageConsent.has(id))
        return true;
    try {
        return localStorage.getItem(imageConsentPrefix + id) === '1';
    }
    catch {
        return false;
    }
}
let readerSize;
let moreOpening;
let moreCleanup;
function displayMode(record, prefs) { return modes.get(record.id) || (prefs.mailDisplay === 'text' ? 'text' : 'html'); }
export function mailDisplayControls(record, prefs) {
    if (record.meta.headerOnly || !record.meta.hasHtml)
        return '';
    const mode = displayMode(record, prefs);
    return `<div class="mail-view-controls" role="group" aria-label="Email display"><button data-mail-mode="html" aria-pressed="${mode === 'html'}">HTML</button><button data-mail-mode="text" aria-pressed="${mode === 'text'}">Text only</button>${mode === 'html' ? `<button data-mail-colors aria-pressed="${originalColors.has(record.id)}">Original colors</button><button data-mail-images ${hasImageConsent(record.id) ? 'disabled' : ''}>${hasImageConsent(record.id) ? 'External images enabled' : 'Load images'}</button><small>External images may report that you opened this email.</small>` : ''}</div>`;
}
export function mailBody(record, prefs) {
    if (record.meta.headerOnly === true) {
        if (Number(record.meta.messageSize || 0) <= 1400000)
            return '<div class="mail-body"><p class="recurrence-note">Message headers are available offline. The message body downloads when opened while connected.</p><button data-download-body>Download message body</button><span data-body-status role="status"></span></div>';
        const size = Number(record.meta.messageSize), label = Number.isFinite(size) ? (size / 1000000).toFixed(1) + ' MB' : 'larger than the download limit';
        return `<div class="mail-body"><p class="recurrence-note">This message is ${e(label)}. Office downloaded its headers. Download its text separately; files are available through Attachments.</p><button data-download-body>Download message body</button><span data-body-status role="status"></span></div>`;
    }
    const hasHtml = record.meta.hasHtml === true;
    const mode = hasHtml ? displayMode(record, prefs) : 'text';
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const accent = ['green', 'blue', 'plum'].includes(document.documentElement.dataset.accent) ? document.documentElement.dataset.accent : 'green';
    return mode === 'html' ? `<iframe class="mail-html" title="HTML email" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="mail-view.php?id=${encodeURIComponent(record.id)}&theme=${theme}&accent=${accent}${originalColors.has(record.id) ? '&colors=original' : ''}${hasImageConsent(record.id) ? '&images=1' : ''}"></iframe>` : `<div class="mail-body">${e(record.body)}</div>`;
}
let bridgeCleanup;
export function bindMailReader(panel, record, render, navigation = {}) {
    bridgeCleanup?.();
    readerSize?.disconnect();
    moreOpening?.disconnect();
    moreCleanup?.();
    const more = panel.querySelector('[data-mail-disclosure="more"]');
    const frame = panel.querySelector('.mail-html');
    if (frame) {
        const allowed = new Set(['g', 'G', 'n', 'N', 'Tab', 'Escape', ':', 'ContextMenu', 'F10', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ...'1234567', ...Object.values(navigation).filter(Boolean)]);
        const configure = () => frame.contentWindow?.postMessage({ type: 'office-mail-config', keys: [...allowed] }, '*');
        const receive = (event) => {
            if (!frame.isConnected || event.source !== frame.contentWindow || event.origin !== 'null')
                return;
            const data = event.data;
            if (!data || typeof data !== 'object' || Array.isArray(data))
                return;
            if (data.type === 'office-mail-ready' && Object.keys(data).length === 1) {
                configure();
                return;
            }
            if (data.type === 'office-mail-pointer' && Object.keys(data).length === 1) {
                more.open = false;
                return;
            }
            if (data.type === 'office-mail-context' && Object.keys(data).length === 3 && Number.isFinite(data.x) && Number.isFinite(data.y) && data.x >= 0 && data.y >= 0 && data.x <= frame.clientWidth && data.y <= frame.clientHeight) {
                const rect = frame.getBoundingClientRect();
                frame.dispatchEvent(new MouseEvent('contextmenu', { clientX: rect.left + data.x, clientY: rect.top + data.y, bubbles: true, cancelable: true }));
                return;
            }
            if (data.type === 'office-mail-save' && Object.keys(data).length === 4 && typeof data.ctrlKey === 'boolean' && typeof data.metaKey === 'boolean' && (data.ctrlKey || data.metaKey) && typeof data.repeat === 'boolean') {
                frame.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: data.ctrlKey, metaKey: data.metaKey, repeat: data.repeat, bubbles: true, cancelable: true }));
                return;
            }
            if (data.type === 'office-mail-vim-scroll' && Object.keys(data).length === 3 && typeof data.key === 'string' && ['f', 'b', 'd', 'u'].includes(data.key) && typeof data.repeat === 'boolean') {
                frame.dispatchEvent(new KeyboardEvent('keydown', { key: data.key, ctrlKey: true, repeat: data.repeat, bubbles: true, cancelable: true }));
                return;
            }
            if (data.type !== 'office-mail-key' || Object.keys(data).length !== 4 || typeof data.key !== 'string' || !allowed.has(data.key) || typeof data.shiftKey !== 'boolean' || typeof data.repeat !== 'boolean')
                return;
            frame.dispatchEvent(new KeyboardEvent('keydown', { key: data.key, shiftKey: data.shiftKey, repeat: data.repeat, bubbles: true, cancelable: true }));
        };
        window.addEventListener('message', receive);
        frame.addEventListener('load', configure);
        bridgeCleanup = () => { window.removeEventListener('message', receive); frame.removeEventListener('load', configure); };
    }
    const header = panel.querySelector('.mail-reader-header');
    const dismissOutside = (event) => { if (more.isConnected && !more.contains(event.target))
        more.open = false; };
    const dismissSelection = (event) => {
        dismissOutside(event);
        if (!more.open || !more.isConnected || !event.target.closest('.mail-more-popover button:not(:disabled)'))
            return;
        // Close before a button's handler captures reader state or rerenders it.
        more.open = false;
        more.querySelector('summary').focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('click', dismissSelection, true);
    moreCleanup = () => {
        document.removeEventListener('pointerdown', dismissOutside, true);
        document.removeEventListener('click', dismissSelection, true);
    };
    const fit = () => {
        if (!header.isConnected) {
            readerSize?.disconnect();
            moreOpening?.disconnect();
            return;
        }
        if (frame) {
            const padding = parseFloat(getComputedStyle(panel).paddingBottom);
            const offset = frame.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
            frame.style.height = Math.max(180, panel.clientHeight - offset - padding) + 'px';
        }
        if (more.open) {
            const popup = more.querySelector('.mail-more-popover'), trigger = more.querySelector('summary');
            const bounds = header.getBoundingClientRect(), button = trigger.getBoundingClientRect();
            popup.style.left = Math.max(0, Math.min(button.left - bounds.left, header.clientWidth - popup.offsetWidth)) + 'px';
            popup.style.top = button.bottom - bounds.top + 4 + 'px';
        }
    };
    // Native details toggles the attribute before painting; its toggle event may
    // arrive later. Position in that mutation microtask to avoid an initial flash.
    moreOpening = new MutationObserver(() => { if (more.open)
        fit(); });
    moreOpening.observe(more, { attributes: true, attributeFilter: ['open'] });
    readerSize = new ResizeObserver(fit);
    readerSize.observe(panel);
    readerSize.observe(header);
    fit();
    panel.querySelectorAll('[data-mail-disclosure]').forEach(details => {
        details.ontoggle = () => { if (details.open) {
            panel.querySelectorAll('[data-mail-disclosure]').forEach(other => { if (other !== details)
                other.open = false; });
            fit();
        } };
    });
    panel.onkeydown = event => {
        const details = event.target.closest('[data-mail-disclosure]');
        if (event.key === 'Escape' && details?.open) {
            details.open = false;
            details.querySelector('summary').focus();
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const colors = panel.querySelector('[data-mail-colors]');
    if (colors)
        colors.onclick = () => { if (originalColors.has(record.id))
            originalColors.delete(record.id);
        else
            originalColors.add(record.id); render(); };
    panel.querySelectorAll('[data-mail-mode]').forEach(button => button.onclick = () => { modes.set(record.id, button.dataset.mailMode); render(); });
    const images = panel.querySelector('[data-mail-images]');
    if (images)
        images.onclick = () => {
            imageConsent.add(record.id);
            try {
                localStorage.setItem(imageConsentPrefix + record.id, '1');
            }
            catch { /* Keep the in-page choice. */ }
            render();
        };
}
