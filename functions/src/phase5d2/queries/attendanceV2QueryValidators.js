const { HttpsError } = require('firebase-functions/v2/https');

const MAX_PAGE_SIZE = 100;
const MAX_RANGE_DAYS = 31;
const DEFAULT_PAGE_SIZE = 50;
const ALLOWED_QUERY_TYPES = ['employee_day', 'employee_range', 'branch_day', 'branch_range', 'checkin_id', 'scheduled_shift'];

function validateQueryType(queryType) {
  if (!ALLOWED_QUERY_TYPES.includes(queryType)) {
    throw new HttpsError('invalid-argument', `Query type desconocido o no autorizado: ${queryType}`);
  }
}

function validateLimit(limit) {
  const parsed = parseInt(limit, 10);
  if (isNaN(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  if (parsed > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return parsed;
}

function validateDateOnly(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new HttpsError('invalid-argument', `Formato de fecha inválido. Se espera YYYY-MM-DD, recibido: ${dateStr}`);
  }
}

function validateDateRange(fromDate, toDate) {
  validateDateOnly(fromDate);
  validateDateOnly(toDate);

  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new HttpsError('invalid-argument', 'Fechas proporcionadas son inválidas.');
  }

  if (end < start) {
    throw new HttpsError('invalid-argument', 'El rango de fechas está invertido (toDate es menor que fromDate).');
  }

  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

  if (diffDays > MAX_RANGE_DAYS) {
    throw new HttpsError('out-of-range', `El rango máximo permitido es de ${MAX_RANGE_DAYS} días. Se solicitaron ${diffDays} días.`);
  }
}

function validateRequiredParam(paramName, value) {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new HttpsError('invalid-argument', `Parámetro obligatorio faltante o vacío: ${paramName}`);
  }
}

module.exports = {
  validateQueryType,
  validateLimit,
  validateDateOnly,
  validateDateRange,
  validateRequiredParam
};
