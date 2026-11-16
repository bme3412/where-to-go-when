type PanelName = 'settings' | 'results';

/** One set of controls, shown as sidebars on desktop and modal drawers on mobile. */
export function setupPanels(workspace: HTMLElement): { closeDrawer: () => void } {
  const compact = window.matchMedia('(max-width: 1100px)');
  const panels = { settings: document.querySelector<HTMLElement>('#settings-panel')!, results: document.querySelector<HTMLElement>('#results-panel')! };
  const toggles = { settings: document.querySelector<HTMLButtonElement>('#toggle-settings')!, results: document.querySelector<HTMLButtonElement>('#toggle-results')! };
  const backdrop = document.querySelector<HTMLButtonElement>('#panel-backdrop')!;
  const background = [document.querySelector<HTMLElement>('.globe-stage')!, document.querySelector<HTMLElement>('.app-header')!, document.querySelector<HTMLElement>('.app-footer')!];
  let open: Record<PanelName, boolean> = { settings: !compact.matches, results: !compact.matches };
  let drawer: PanelName | null = null;

  function sync(): void {
    drawer = compact.matches ? (open.settings ? 'settings' : open.results ? 'results' : null) : null;
    workspace.classList.toggle('settings-closed', !open.settings);
    workspace.classList.toggle('results-closed', !open.results);
    workspace.classList.toggle('drawer-open', drawer !== null);
    backdrop.hidden = drawer === null;
    background.forEach(element => { element.inert = drawer !== null; });
    for (const name of ['settings', 'results'] as const) {
      panels[name].hidden = !open[name];
      panels[name].inert = drawer !== null && drawer !== name;
      toggles[name].setAttribute('aria-expanded', String(open[name]));
      if (drawer === name) { panels[name].setAttribute('role', 'dialog'); panels[name].setAttribute('aria-modal', 'true'); }
      else { panels[name].removeAttribute('role'); panels[name].removeAttribute('aria-modal'); }
    }
  }
  function set(name: PanelName, value: boolean): void {
    if (compact.matches) open = { settings: false, results: false };
    open[name] = value;
    sync();
    if (value) panels[name].querySelector<HTMLButtonElement>('[data-close-panel]')!.focus();
    else toggles[name].focus();
  }
  for (const name of ['settings', 'results'] as const) {
    toggles[name].addEventListener('click', () => set(name, !open[name]));
    panels[name].querySelector('[data-close-panel]')!.addEventListener('click', () => set(name, false));
  }
  const closeDrawer = () => { if (drawer) set(drawer, false); };
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', event => {
    if (!drawer || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
    if (event.key === 'Tab') {
      const focusable = [...panels[drawer].querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter(element => !element.closest('[hidden]'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  compact.addEventListener('change', () => {
    const previous = drawer;
    const focusedPanel = (['settings', 'results'] as const).find(name => panels[name].contains(document.activeElement));
    open = { settings: !compact.matches, results: !compact.matches };
    sync();
    if (compact.matches && focusedPanel) toggles[focusedPanel].focus();
    else if (previous) toggles[previous].focus();
  });
  sync();
  return { closeDrawer };
}
