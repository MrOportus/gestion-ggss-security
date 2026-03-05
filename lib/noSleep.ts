
/**
 * Utility to prevent the screen from turning off and the browser from suspending.
 * Uses Screen Wake Lock API when available.
 */
export class NoSleepHelper {
    private wakeLock: any = null;

    async enable() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await (navigator as any).wakeLock.request('screen');
                console.log('Wake Lock is active');
            } catch (err: any) {
                console.error(`${err.name}, ${err.message}`);
            }
        } else {
            console.warn('Wake Lock API not supported. Falling back to video hack?');
            // Here we could implement the video loop hack if needed.
        }
    }

    async disable() {
        if (this.wakeLock) {
            await this.wakeLock.release();
            this.wakeLock = null;
            console.log('Wake Lock released');
        }
    }
}

export const noSleep = new NoSleepHelper();
