export interface LatLng {
    lat: number;
    lng: number;
}

/**
 * Calculates the Haversine distance between two points in meters.
 */
export function getHaversineDistance(p1: LatLng, p2: LatLng): number {
    const R = 6371000; // Radius of the Earth in meters
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculates the perpendicular distance from a point to a line segment.
 */
function getDistance(p: LatLng, p1: LatLng, p2: LatLng): number {
    const { lat: y, lng: x } = p;
    const { lat: y1, lng: x1 } = p1;
    const { lat: y2, lng: x2 } = p2;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Simplifies a polyline using the Douglas-Peucker algorithm.
 * @param points Array of LatLng objects
 * @param epsilon Tolerance value (higher = more simplification)
 */
export function douglasPeucker(points: LatLng[], epsilon: number): LatLng[] {
    if (points.length <= 2) return points;

    let dmax = 0;
    let index = 0;
    const last = points.length - 1;

    for (let i = 1; i < last; i++) {
        const d = getDistance(points[i], points[0], points[last]);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    if (dmax > epsilon) {
        const res1 = douglasPeucker(points.slice(0, index + 1), epsilon);
        const res2 = douglasPeucker(points.slice(index), epsilon);
        return [...res1.slice(0, -1), ...res2];
    } else {
        return [points[0], points[last]];
    }
}

/**
 * Smoothes a path using a Moving Average filter.
 * @param points Array of LatLng objects
 * @param windowSize Number of points to include in the average
 */
export function movingAverage(points: LatLng[], windowSize: number): LatLng[] {
    if (points.length < 3) return points;
    const smoothed: LatLng[] = [];
    const half = Math.floor(windowSize / 2);

    for (let i = 0; i < points.length; i++) {
        let sumLat = 0;
        let sumLng = 0;
        let count = 0;

        const start = Math.max(0, i - half);
        const end = Math.min(points.length, i + half + 1);

        for (let j = start; j < end; j++) {
            sumLat += points[j].lat;
            sumLng += points[j].lng;
            count++;
        }

        smoothed.push({
            lat: sumLat / count,
            lng: sumLng / count
        });
    }

    return smoothed;
}

/**
 * Combines Douglas-Peucker simplification and Moving Average smoothing.
 * @param points Original GPS path
 * @param epsilon Douglas-Peucker tolerance (default ~5-10m in degrees)
 * @param windowSize Moving average window size
 */
export function cleanGpsPath(
    points: LatLng[],
    epsilon: number = 0.00005,
    windowSize: number = 3
): LatLng[] {
    if (points.length < 3) return points;

    // 1. Simplificar (Douglas-Peucker) - reduce puntos redundantes
    const simplified = douglasPeucker(points, epsilon);

    // 2. Suavizar (Moving Average) - quita picos y ángulos bruscos
    const smoothed = movingAverage(simplified, windowSize);

    return smoothed;
}
