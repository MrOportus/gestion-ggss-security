/**
 * Normalizes a RUT by removing spaces, dots, and hyphens, and converting it to uppercase.
 * Example: "12.345.678-9" -> "123456789", " 12345678-k " -> "12345678K"
 */
export function normalizeRut(rut: string | undefined | null): string {
  if (!rut) return "";
  return rut.replace(/[\.\-\s]/g, "").toUpperCase();
}

/**
 * Validates a given RUT.
 * It checks the format and calculates the check digit to ensure it's correct.
 */
export function validateRut(rut: string | undefined | null): boolean {
  if (!rut || typeof rut !== 'string') return false;
  
  const cleaned = normalizeRut(rut);
  
  // A valid RUT without dots and hyphens is between 8 and 9 characters long
  if (cleaned.length < 8 || cleaned.length > 9) return false;
  
  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1);
  
  // The body must contain only digits
  if (!/^\d+$/.test(body)) return false;
  // The check digit must be a digit or 'K'
  if (!/^[0-9K]$/.test(dv)) return false;
  
  // Calculate check digit
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  
  const expectedDv = 11 - (sum % 11);
  const expectedDvStr = expectedDv === 11 ? '0' : expectedDv === 10 ? 'K' : expectedDv.toString();
  
  return dv === expectedDvStr;
}
