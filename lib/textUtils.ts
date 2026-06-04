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
