import { useState, useEffect } from 'react';
import { Network, ConnectionStatus } from '@capacitor/network';

export function useNetworkStatus() {
    const [status, setStatus] = useState<ConnectionStatus>({
        connected: true,
        connectionType: 'unknown',
    });

    useEffect(() => {
        let isMounted = true;

        const checkStatus = async () => {
            const currentStatus = await Network.getStatus();
            if (isMounted) setStatus(currentStatus);
        };

        checkStatus();

        const listener = Network.addListener('networkStatusChange', (status) => {
            if (isMounted) setStatus(status);
        });

        return () => {
            isMounted = false;
            listener.then(l => l.remove());
        };
    }, []);

    return status;
}
