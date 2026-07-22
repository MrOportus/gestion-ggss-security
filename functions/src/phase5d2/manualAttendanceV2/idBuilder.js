"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildManualAttendanceV2Id = buildManualAttendanceV2Id;
function buildManualAttendanceV2Id(checkInId) {
    if (!checkInId || typeof checkInId !== 'string') {
        throw new Error('checkInId must be a non-empty string');
    }
    const trimmedId = checkInId.trim();
    if (trimmedId.length === 0) {
        throw new Error('checkInId cannot be empty');
    }
    if (trimmedId.length > 128) {
        throw new Error('checkInId exceeds maximum reasonable length of 128 characters');
    }
    // Allow alphanumeric, dashes, and underscores.
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
        throw new Error('checkInId contains invalid characters. Only alphanumeric, dashes, and underscores are allowed.');
    }
    return `manual_${trimmedId}`;
}
