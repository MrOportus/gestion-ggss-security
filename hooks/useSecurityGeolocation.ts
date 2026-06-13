
import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';
import { noSleep } from '../lib/noSleep';
import type { GpsPoint } from '../lib/gpsUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Plugin registration
// The @capacitor-community/background-geolocation plugin is registered lazily
// so that it is only resolved on native platforms and does not cause errors
// when running in the browser.
// ─────────────────────────────────────────────────────────────────────────────
interface BackgroundGeolocationPlugin {
    addWatcher(
        options: {
            backgroundMessage: string;
            backgroundTitle: string;
            requestPermissions: boolean;
            stale: boolean;
            distanceFilter: number;
        },
        callback: (location: BackgroundLocation | undefined, error: Error | undefined) => void
    ): Promise<string>;
    removeWatcher(options: { id: string }): Promise<void>;
    openSettings(): Promise<void>;
}

interface BackgroundLocation {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    bearing: number | null;
    speed: number | null;
    time: number; // Unix timestamp in ms
}

let BackgroundGeolocation: BackgroundGeolocationPlugin | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useSecurityGeolocation
 *
 * Starts continuous GPS tracking when `active` is true and stops it when false.
 * Bifurcates between:
 *   - Android native: @capacitor-community/background-geolocation (Foreground Service)
 *   - Web / iOS PWA:  navigator.geolocation.watchPosition + Screen Wake Lock
 *
 * Delivers a normalized GpsPoint to `onLocation` and error details to `onError`.
 * The hook does NOT apply the Bouncer filter — that responsibility belongs to
 * the consumer (RoundsControl) so the filter logic stays in one place.
 */
export function useSecurityGeolocation(
    active: boolean,
    onLocation: (point: GpsPoint) => void,
    onError: (code: number, message: string) => void
): void {
    // Store cleanup references
    const watcherIdRef = useRef<string | null>(null);    // Native watcher ID
    const webWatchIdRef = useRef<number | null>(null);   // Web watchPosition ID
    const onLocationRef = useRef(onLocation);
    const onErrorRef = useRef(onError);

    // Keep callbacks current without re-running the effect
    useEffect(() => { onLocationRef.current = onLocation; }, [onLocation]);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);

    useEffect(() => {
        if (!active) {
            // ── STOP ──────────────────────────────────────────────────────────
            stopAll();
            return;
        }

        // ── START ─────────────────────────────────────────────────────────────
        if (Capacitor.isNativePlatform()) {
            startNative();
        } else {
            startWeb();
        }

        return () => {
            stopAll();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    // ── NATIVE PATH (Android Foreground Service) ───────────────────────────────
    async function startNative() {
        try {
            // Register plugin on first use (avoids import-time errors in the browser)
            if (!BackgroundGeolocation) {
                BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
                    'BackgroundGeolocation'
                );
            }

            const watcherId = await BackgroundGeolocation.addWatcher(
                {
                    // ---- Android Foreground Service notification ----
                    backgroundMessage: 'Toca para volver a la app.',
                    backgroundTitle: '🛡️ Rastreo de ronda activo',
                    // ---- Permissions ----
                    requestPermissions: true,
                    // Ignore stale (cached) positions from before the watcher started
                    stale: false,
                    // Fire every 5m of movement — mejor relación señal/ruido para el Bouncer.
                    // Con 2m el plugin dispara demasiado seguido y el Bouncer lo descarta por velocidad.
                    distanceFilter: 5,
                },
                (location, error) => {
                    if (error) {
                        console.error('[useSecurityGeolocation] Native error:', error);
                        // Map to a numeric code mimicking the Web Geolocation API conventions
                        const code = error.message?.includes('denied') ? 1 : 2;
                        onErrorRef.current(code, error.message ?? 'GPS error');
                        return;
                    }
                    if (!location) return;

                    const point: GpsPoint = {
                        lat: location.latitude,
                        lng: location.longitude,
                        accuracy: location.accuracy,
                        timestamp: new Date(location.time).toISOString(),
                    };
                    onLocationRef.current(point);
                }
            );

            watcherIdRef.current = watcherId;
            console.log('[useSecurityGeolocation] Native watcher started:', watcherId);
        } catch (err: any) {
            console.error('[useSecurityGeolocation] Failed to start native watcher:', err);
            onErrorRef.current(2, err?.message ?? 'Native GPS failed');
        }
    }

    // ── WEB / iOS PWA PATH (navigator.geolocation + noSleep) ──────────────────
    function startWeb() {
        if (!('geolocation' in navigator)) {
            onErrorRef.current(2, 'Geolocalización no soportada en este navegador.');
            return;
        }

        // Prevent screen from sleeping on web (best-effort)
        noSleep.enable().catch(() => {
            console.warn('[useSecurityGeolocation] Wake Lock not available.');
        });

        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const point: GpsPoint = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    timestamp: new Date(pos.timestamp).toISOString(),
                };
                onLocationRef.current(point);
            },
            (err) => {
                console.error('[useSecurityGeolocation] Web GPS error:', err);
                onErrorRef.current(err.code, err.message);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000,
            }
        );

        webWatchIdRef.current = watchId;
        console.log('[useSecurityGeolocation] Web watcher started:', watchId);
    }

    // ── CLEANUP ────────────────────────────────────────────────────────────────
    async function stopAll() {
        // Stop native watcher
        if (watcherIdRef.current !== null) {
            try {
                if (BackgroundGeolocation) {
                    await BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current });
                    console.log('[useSecurityGeolocation] Native watcher removed.');
                }
            } catch (err) {
                console.warn('[useSecurityGeolocation] Error removing native watcher:', err);
            }
            watcherIdRef.current = null;
        }

        // Stop web watcher
        if (webWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(webWatchIdRef.current);
            webWatchIdRef.current = null;
            console.log('[useSecurityGeolocation] Web watcher cleared.');
        }

        // Release Wake Lock (only relevant on web path)
        if (!Capacitor.isNativePlatform()) {
            noSleep.disable().catch(() => {});
        }
    }
}
