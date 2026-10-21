/**
 * Utility to normalize text for search filters.
 * It converts the string to lowercase and removes accents/diacritics.
 */
export const normalizeText = (text: string | null | undefined): string => {
  if (!text) return '';
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
};

/**
 * Smart employee search: checks if ALL words of the search term
 * appear anywhere in the employee's full name or RUT.
 * e.g. "luis hidalgo" matches "Luis Arturo Hidalgo Cayo"
 */
export const matchesEmployeeSearch = (
  searchTerm: string,
  employee: { firstName?: string; lastNamePaterno?: string; lastNameMaterno?: string; rut?: string }
): boolean => {
  if (!searchTerm) return true;
  const fullText = normalizeText(
    `${employee.firstName || ''} ${employee.lastNamePaterno || ''} ${employee.lastNameMaterno || ''} ${employee.rut || ''}`
  );
  const words = normalizeText(searchTerm).split(/\s+/).filter(Boolean);
  return words.every(word => fullText.includes(word));
};

/**
 * Formatea fechas a formato estándar chileno / RR.HH.: DD-MM-YYYY (con 2 dígitos en día y mes).
 * Evita desajustes por zona horaria procesando los componentes numéricos directamente.
 */
export const formatDateDDMMYYYY = (dateInput?: string | number | Date | null): string => {
  if (!dateInput && dateInput !== 0) return '';

  if (typeof dateInput === 'number') {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '';
    const day = String(dateInput.getDate()).padStart(2, '0');
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const year = dateInput.getFullYear();
    return `${day}-${month}-${year}`;
  }

  const trimmed = String(dateInput).trim();
  if (
    !trimmed ||
    trimmed === '---' ||
    trimmed.toLowerCase() === 'indefinido' ||
    trimmed.toLowerCase() === 'n/a' ||
    trimmed.toLowerCase() === 'no registrada' ||
    trimmed.toLowerCase() === 'pendiente'
  ) {
    return trimmed;
  }

  // Ya está en formato DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  // Formato DD/MM/YYYY o D/M/YYYY -> DD-MM-YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const [d, m, y] = trimmed.split('/');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
  }

  // Formato YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const datePart = trimmed.split('T')[0];
    const [year, month, day] = datePart.split('-');
    // Si es solo fecha o medianoche UTC, mantenemos exactamente día-mes-año original
    if (!trimmed.includes('T') || trimmed.endsWith('T00:00:00') || trimmed.endsWith('T00:00:00.000Z')) {
      return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
    }
    // Si contiene hora local/UTC con desplazamiento
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const ld = String(d.getDate()).padStart(2, '0');
      const lm = String(d.getMonth() + 1).padStart(2, '0');
      const ly = d.getFullYear();
      return `${ld}-${lm}-${ly}`;
    }
    return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
  }

  try {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return trimmed;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return trimmed;
  }
};
