
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/**
 * Automáticamente cierra turnos que llevan activos más de 12 horas.
 */
async function autoCloseShifts() {
    console.log('--- Iniciando Proceso de Cierre Automático ---');

    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    try {
        const snapshot = await db.collection('Asistencia')
            .where('status', '==', 'active')
            .where('timestamp', '<', twelveHoursAgo.toISOString())
            .get();

        if (snapshot.empty) {
            console.log('No se encontraron turnos activos con más de 12 horas.');
            return;
        }

        console.log(`Encontrados ${snapshot.size} turnos para cerrar.`);

        const batch = db.batch();
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`Cerrando turno ID: ${doc.id} - Empleado: ${data.employeeName}`);

            batch.update(doc.ref, {
                status: 'completed',
                endTime: now.toISOString(),
                type: 'check_out',
                systemNote: 'Cierre automático por exceder límite de tiempo (12h)'
            });
        });

        await batch.commit();
        console.log('--- Proceso Finalizado Exitosamente ---');
    } catch (error) {
        console.error('Error en el proceso de cierre automático:', error);
    }
}

autoCloseShifts();
