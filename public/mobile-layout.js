// Generated from frontend/mobile-layout.ts by pnpm build. Do not edit.
export const phoneLayout = matchMedia('(max-width: 800px), (max-width: 950px) and (max-height: 550px) and (pointer: coarse)');
export function mobileDisclosure(id, label, buttonId = id + '-toggle') {
    return `<button type="button" id="${buttonId}" class="mobile-only mobile-disclosure" data-action="mobile-disclosure" aria-controls="${id}" aria-expanded="false">${label}</button>`;
}
export function setDisclosure(button, open) {
    const panel = document.getElementById(button?.getAttribute('aria-controls') || '');
    button?.setAttribute('aria-expanded', String(open));
    panel?.classList.toggle('mobile-expanded', open);
}
