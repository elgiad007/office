// Generated from frontend/utils.ts by pnpm build. Do not edit.
/** Match Array.filter(Boolean), with nullable values removed from its result type. */
export function isPresent(value) {
    return Boolean(value);
}
/** Keep API conflict details on Error objects and handle non-Error rejections. */
export function asError(value) {
    return value instanceof Error ? value : new Error(String(value));
}
export function showProgressDialog(id, title, message) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'connection-opening-dialog';
    dialog.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-message`);
    dialog.innerHTML = '<div class="connection-opening-card"><span class="connection-opening-spinner" aria-hidden="true"></span><h2></h2><p role="status"></p></div>';
    const heading = dialog.querySelector('h2');
    heading.id = `${id}-title`;
    heading.textContent = title;
    const status = dialog.querySelector('p');
    status.id = `${id}-message`;
    status.textContent = message;
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.addEventListener('keydown', event => {
        event.preventDefault();
        event.stopPropagation();
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => {
        dialog.close();
        dialog.remove();
    };
}
