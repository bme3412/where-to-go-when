import { DAY, parseDate } from './scoring';
import type { Trip } from './types';

const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' });
const rangeLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const datePickerMarkup = `
  <button type="button" class="date-range-button" aria-expanded="false" aria-controls="trip-calendar"><span></span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg></button>
  <div id="trip-calendar" class="trip-calendar" hidden>
    <div class="calendar-nav"><button type="button" class="icon-button" data-calendar-month="-1" aria-label="Previous calendar month">‹</button><strong id="calendar-month" aria-live="polite"></strong><button type="button" class="icon-button" data-calendar-month="1" aria-label="Next calendar month">›</button></div>
    <p class="calendar-prompt" aria-live="polite"></p>
    <div class="calendar-days" role="group" aria-labelledby="calendar-month"></div>
  </div>`;

export function setupDatePicker(section: HTMLElement, initial: Trip, onChange: (trip: Trip) => void): void {
  const trigger = section.querySelector<HTMLButtonElement>('.date-range-button')!;
  const panel = section.querySelector<HTMLElement>('#trip-calendar')!;
  const days = section.querySelector<HTMLElement>('.calendar-days')!;
  const monthHeading = section.querySelector<HTMLElement>('#calendar-month')!;
  const prompt = section.querySelector<HTMLElement>('.calendar-prompt')!;
  let trip = initial;
  let departure: number | null = null;
  let visibleMonth = new Date(parseDate(trip.start)!);

  function renderRange(): void {
    const label = rangeLabel.formatRange(new Date(trip.start), new Date(trip.end));
    trigger.querySelector('span')!.textContent = label;
    trigger.setAttribute('aria-label', `Travel dates, ${label}`);
  }

  function renderMonth(): void {
    const first = new Date(visibleMonth);
    first.setUTCDate(1);
    const next = new Date(first);
    next.setUTCMonth(first.getUTCMonth() + 1);
    const count = (next.getTime() - first.getTime()) / DAY;
    const start = departure ?? parseDate(trip.start)!;
    const end = departure ?? parseDate(trip.end)!;
    monthHeading.textContent = monthLabel.format(first);
    prompt.textContent = departure === null ? 'Choose departure' : `Choose return · Departing ${dayLabel.format(departure)}`;
    const focusDate = start >= first.getTime() && start < next.getTime() ? start : first.getTime();
    days.innerHTML = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(label => `<span aria-hidden="true">${label}</span>`).join('')
      + '<span aria-hidden="true"></span>'.repeat(first.getUTCDay())
      + Array.from({ length: count }, (_, index) => {
        const date = first.getTime() + index * DAY;
        const selected = date >= start && date <= end;
        return `<button type="button" data-calendar-day="${date}" tabindex="${date === focusDate ? 0 : -1}" aria-label="${dayLabel.format(date)}" aria-pressed="${selected}"${date === start || date === end ? ' class="range-endpoint"' : ''}>${index + 1}</button>`;
      }).join('');
    for (const control of panel.querySelectorAll<HTMLButtonElement>('[data-calendar-month]')) {
      const target = new Date(first);
      target.setUTCMonth(first.getUTCMonth() + Number(control.dataset.calendarMonth));
      control.disabled = target.getUTCFullYear() < 1 || target.getUTCFullYear() > 9999;
    }
  }

  function focusDay(date: number): void {
    const button = days.querySelector<HTMLButtonElement>(`[data-calendar-day="${date}"]`);
    if (!button) return;
    days.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1');
    button.tabIndex = 0;
    button.focus();
  }

  function close(): void {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }

  renderRange();
  trigger.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    departure = null;
    visibleMonth = new Date(trip.start);
    renderMonth();
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    focusDay(parseDate(trip.start)!);
  });
  panel.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.dataset.calendarMonth) {
      visibleMonth.setUTCDate(1);
      visibleMonth.setUTCMonth(visibleMonth.getUTCMonth() + Number(target.dataset.calendarMonth));
      renderMonth();
      return;
    }
    const date = Number(target.dataset.calendarDay);
    if (!Number.isFinite(date)) return;
    if (departure === null || date < departure) {
      departure = date;
      renderMonth();
      focusDay(date);
      return;
    }
    trip = { start: new Date(departure).toISOString().slice(0, 10), end: new Date(date).toISOString().slice(0, 10) };
    renderRange();
    close();
    onChange(trip);
  });
  days.addEventListener('keydown', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-calendar-day]');
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!button || offset === undefined) return;
    event.preventDefault();
    const date = Number(button.dataset.calendarDay) + offset * DAY;
    const next = new Date(date);
    if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
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
      close();
    }
  });
}
