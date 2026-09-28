/** Tiny DOM helpers (no framework). */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Sets textContent only when it changed (avoids needless style/layout work). */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export function setClass(e: Element, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS: Record<string, string> = {
  building:
    '<path d="M3 21V8l6-4 6 4v13H3z"/><path d="M15 21V11h6v10h-6z" opacity=".7"/><rect x="6" y="10" width="2" height="2" fill="#000"/><rect x="10" y="10" width="2" height="2" fill="#000"/><rect x="6" y="14" width="2" height="2" fill="#000"/><rect x="10" y="14" width="2" height="2" fill="#000"/>',
  survivor:
    '<circle cx="12" cy="5" r="3"/><path d="M8 10h8l-1 6h-2l-1 6-1-6H9z"/><path d="M8 10 4 7M16 10l4-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  rdu: '<rect x="10" y="10" width="4" height="12"/><circle cx="12" cy="7" r="4"/><circle cx="12" cy="7" r="7" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/>',
  dish: '<path d="M3 5a14 14 0 0 0 16 16L3 5z"/><path d="M11 13l5-5" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="7" r="2"/><path d="M5 23h9l-3-6z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 7v6l4 2" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  check: '<path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
  carrier:
    '<rect x="2" y="9" width="20" height="8" rx="1"/><rect x="3" y="5" width="7" height="5"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><circle cx="15" cy="7" r="2.5" fill="#b9ff3a"/><circle cx="20" cy="7" r="2" fill="#b9ff3a"/>',
  target: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="12" r="4"/>',
};

export function icon(name: string, cls = 'pb-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

/** A medal badge (CSS disc + ribbon) for a tier, or an empty slot. */
export function medalBadge(tier: string | undefined, label: string): HTMLDivElement {
  const m = el('div', `pb-medal ${tier ? `pb-medal-${tier}` : 'pb-medal-none'}`);
  const ribbon = el('div', 'pb-medal-ribbon');
  const disc = el('div', 'pb-medal-disc');
  disc.append(el('span', 'pb-medal-star', tier ? '★' : '–'));
  const t = el('div', 'pb-medal-tier', tier ? tier.toUpperCase() : 'NONE');
  const cap = el('div', 'pb-medal-label', label);
  m.append(ribbon, disc, t, cap);
  return m;
}

/** Button used by all menus (focusable, navigable). */
export function menuButton(label: string, opts: { cls?: string; sub?: string; locked?: boolean; onClick?: () => void } = {}): HTMLButtonElement {
  const b = el('button', `pb-btn pb-nav ${opts.cls ?? ''}`);
  b.type = 'button';
  const main = el('span', 'pb-btn-label', label);
  if (opts.locked) {
    b.classList.add('pb-locked');
    b.prepend(icon('lock', 'pb-icon pb-lock'));
  }
  b.append(main);
  if (opts.sub) b.append(el('span', 'pb-btn-sub', opts.sub));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}
