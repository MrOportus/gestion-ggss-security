export function getJornadaDateForTimezone(date: Date, timezone: string = 'America/Santiago'): string {
  // We use Intl.DateTimeFormat to extract the correct YYYY-MM-DD in the given timezone.
  // Because typical Shifts change day at 00:00, but actually some shifts are night shifts.
  // The 'jornadaDate' represents the operational date.
  // If the check-in is early morning (e.g., 00:00 - 05:00) and belongs to a night shift,
  // the operational date might actually be the previous calendar day.
  // Since we are writing a pure utility without accessing Firestore, 
  // we default to the calendar day in America/Santiago unless overridden by TurnosProgramados.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  
  return `${map.year}-${map.month}-${map.day}`;
}
