import { escapeHtml } from './format';
import type { Origin } from './types';

const normalize = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function setupOriginSearch(input: HTMLInputElement, suggestions: HTMLElement, origins: readonly Origin[],
  initial: Origin, onSelect: (origin: Origin) => void): void {
  let selected = initial;
  let matches: Origin[] = [];
  let active = -1;

  function close(): void {
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    matches = [];
  }

  function select(origin: Origin): void {
    input.value = origin.name;
    close();
    if (origin === selected) return;
    selected = origin;
    onSelect(origin);
  }

  function move(index: number): void {
    suggestions.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    active = index;
    const option = suggestions.children[index];
    option.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }

  input.value = initial.name;
  input.addEventListener('input', () => {
    close();
    const query = normalize(input.value);
    if (!query) return;
    matches = origins.filter(origin => normalize(origin.name).includes(query));
    suggestions.innerHTML = matches.length
      ? matches.map((origin, index) => `<li id="origin-option-${index}" role="option" aria-selected="false" data-origin-index="${index}">${escapeHtml(origin.name)}</li>`).join('')
      : '<li role="option" aria-disabled="true">No matching cities</li>';
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => { input.value = selected.name; close(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !suggestions.hidden) {
      event.preventDefault();
      input.value = selected.name;
      close();
    } else if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? (active + 1) % matches.length : (active <= 0 ? matches.length - 1 : active - 1));
    } else if (event.key === 'Enter' && matches.length) {
      const exact = matches.find(origin => normalize(origin.name) === normalize(input.value));
      const choice = matches[active] ?? exact ?? (matches.length === 1 ? matches[0] : undefined);
      if (choice) { event.preventDefault(); select(choice); }
    }
  });
  // Keep focus on the combobox so selecting a suggestion cannot trigger blur first.
  suggestions.addEventListener('mousedown', event => event.preventDefault());
  suggestions.addEventListener('click', event => {
    const option = (event.target as HTMLElement).closest<HTMLElement>('[data-origin-index]');
    if (!option) return;
    const choice = matches[Number(option.dataset.originIndex)];
    if (choice) select(choice);
  });
}
