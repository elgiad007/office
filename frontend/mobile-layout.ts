export const phoneLayout = matchMedia('(max-width: 800px), (max-width: 950px) and (max-height: 550px) and (pointer: coarse)');

export function mobileDisclosure(id: string, label: string, buttonId=id+'-toggle') {
  return `<button type="button" id="${buttonId}" class="mobile-only mobile-disclosure" data-action="mobile-disclosure" aria-controls="${id}" aria-expanded="false">${label}</button>`;
}

export function setDisclosure(button: HTMLElement | null, open: boolean) {
  const panel = document.getElementById(button?.getAttribute('aria-controls') || '');
  button?.setAttribute('aria-expanded', String(open));
  panel?.classList.toggle('mobile-expanded', open);
}
