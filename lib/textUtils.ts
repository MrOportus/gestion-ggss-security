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
