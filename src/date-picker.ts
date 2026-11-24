import { DAY, parseDate } from './scoring';
import type { Trip } from './types';

const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' });
const dateLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const dateFields = { start: 'Departure', end: 'Return' } as const;
const fields = ['start', 'end'] as const;
type DateField = typeof fields[number];

export const datePickerMarkup = `
  ${fields.map(field => `<button type="button" class="date-field" data-date-field="${field}" aria-expanded="false" aria-controls="trip-calendar">
    <span class="date-field-copy"><span class="date-field-label">${dateFields[field]}</span><span class="date-field-value"></span></span>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg>
  </button>`).join('')}
  <div id="trip-calendar" class="trip-calendar" hidden>
    <div class="calendar-nav"><button type="button" class="icon-button" data-calendar-month="-1" aria-label="Previous calendar month">‹</button><strong id="calendar-month" aria-live="polite"></strong><button type="button" class="icon-button" data-calendar-month="1" aria-label="Next calendar month">›</button></div>
    <p class="calendar-prompt" aria-live="polite"></p>
    <div class="calendar-days" role="group" aria-labelledby="calendar-month"></div>
  </div>`;

export function setupDatePicker(section: HTMLElement, initial: Trip, onChange: (trip: Trip) => void): void {
  const triggers = {
    start: section.querySelector<HTMLButtonElement>('[data-date-field="start"]')!,
    end: section.querySelector<HTMLButtonElement>('[data-date-field="end"]')!,
  };
  const panel = section.querySelector<HTMLElement>('#trip-calendar')!;
  const days = section.querySelector<HTMLElement>('.calendar-days')!;
  const monthHeading = section.querySelector<HTMLElement>('#calendar-month')!;
  const prompt = section.querySelector<HTMLElement>('.calendar-prompt')!;
  let trip = initial;
  let pendingDeparture: string | null = null;
  let activeField: DateField = 'start';
  let visibleMonth = new Date(parseDate(trip.start)!);

  function renderFields(): void {
    for (const field of fields) {
      const date = field === 'start' ? pendingDeparture ?? trip.start : trip.end;
      const choosingReturn = field === 'end' && pendingDeparture !== null;
      const trigger = triggers[field];
      trigger.querySelector('.date-field-value')!.textContent = choosingReturn ? 'Choose date' : dateLabel.format(new Date(date));
      trigger.setAttribute('aria-label', `${dateFields[field]} date, ${choosingReturn ? 'choose date' : dayLabel.format(new Date(date))}`);
      trigger.setAttribute('aria-expanded', String(!panel.hidden && activeField === field));
    }
  }

  function earliestDay(): number {
    return activeField === 'end' ? parseDate(pendingDeparture ?? trip.start)! : -Infinity;
  }

  function renderMonth(): void {
    const first = new Date(visibleMonth);
    first.setUTCDate(1);
    const next = new Date(first);
    next.setUTCMonth(first.getUTCMonth() + 1);
    const count = (next.getTime() - first.getTime()) / DAY;
    const start = parseDate(pendingDeparture ?? trip.start)!;
    const end = pendingDeparture ? start : parseDate(trip.end)!;
    const earliest = earliestDay();
    monthHeading.textContent = monthLabel.format(first);
    prompt.textContent = activeField === 'start' ? 'Choose departure' : `Return on or after ${dateLabel.format(start)}`;
    const fieldDate = activeField === 'start' ? start : end;
    const focusDate = fieldDate >= +first && fieldDate < +next ? fieldDate : Math.max(+first, earliest);
    days.innerHTML = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(label => `<span aria-hidden="true">${label}</span>`).join('')
      + '<span aria-hidden="true"></span>'.repeat(first.getUTCDay())
      + Array.from({ length: count }, (_, index) => {
        const date = first.getTime() + index * DAY;
        const selected = date >= start && date <= end;
        return `<button type="button" data-calendar-day="${date}" tabindex="${date === focusDate ? 0 : -1}" aria-label="${dayLabel.format(date)}" aria-pressed="${selected}"${date === start || date === end ? ' class="range-endpoint"' : ''}${date < earliest ? ' disabled' : ''}>${index + 1}</button>`;
      }).join('');
    for (const control of panel.querySelectorAll<HTMLButtonElement>('[data-calendar-month]')) {
      const target = new Date(first);
      target.setUTCMonth(first.getUTCMonth() + Number(control.dataset.calendarMonth));
      control.disabled = target.getUTCFullYear() < 1 || target.getUTCFullYear() > 9999 ||
        (target < first && +first <= earliest);
    }
  }

  function focusDay(date: number): void {
    const button = days.querySelector<HTMLButtonElement>(`[data-calendar-day="${date}"]`);
    if (!button || button.disabled) return;
    days.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1');
    button.tabIndex = 0;
    button.focus();
  }

  function close(restoreFocus: boolean): void {
    panel.hidden = true;
    pendingDeparture = null;
    renderFields();
    if (restoreFocus) triggers[activeField].focus();
  }

  function open(field: DateField, date: number): void {
    activeField = field;
    visibleMonth = new Date(date);
    panel.hidden = false;
    renderFields();
    renderMonth();
    focusDay(date);
  }

  renderFields();
  for (const field of fields) {
    triggers[field].addEventListener('click', () => {
      if (!panel.hidden && activeField === field) { close(true); return; }
      pendingDeparture = null;
      open(field, parseDate(trip[field])!);
    });
  }
  panel.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.dataset.calendarMonth) {
      visibleMonth.setUTCDate(1);
      visibleMonth.setUTCMonth(visibleMonth.getUTCMonth() + Number(target.dataset.calendarMonth));
      renderMonth();
      if (target.disabled) days.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
      return;
    }
    const date = Number(target.dataset.calendarDay);
    if (!Number.isFinite(date) || date < earliestDay()) return;
    const value = new Date(date).toISOString().slice(0, 10);
    if (activeField === 'start' && date > parseDate(trip.end)!) {
      pendingDeparture = value;
      open('end', date);
      return;
    }
    trip = activeField === 'start' ? { ...trip, start: value } : { start: pendingDeparture ?? trip.start, end: value };
    close(true);
    onChange(trip);
  });
  days.addEventListener('keydown', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-calendar-day]');
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!button || offset === undefined) return;
    event.preventDefault();
    const date = Number(button.dataset.calendarDay) + offset * DAY;
    const next = new Date(date);
    if (date < earliestDay() || next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
    if (next.getUTCMonth() !== visibleMonth.getUTCMonth() || next.getUTCFullYear() !== visibleMonth.getUTCFullYear()) {
      visibleMonth = next;
      renderMonth();
    }
    focusDay(date);
  });
  section.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  section.addEventListener('focusout', event => {
    if (!panel.hidden && event.relatedTarget instanceof Node && !section.contains(event.relatedTarget)) close(false);
  });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && event.target instanceof Node && !section.contains(event.target)) close(false);
  });
}
