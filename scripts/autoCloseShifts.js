
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
    const thirteenHoursAgo = new Date(now.getTime() - 13 * 60 * 60 * 1000);

    try {
        const snapshot = await db.collection('Asistencia')
            .where('status', '==', 'active')
            .where('timestamp', '<', thirteenHoursAgo.toISOString())
            .get();

        if (snapshot.empty) {
            console.log('No se encontraron turnos activos con más de 13 horas (12h + 60m).');
            return;
        }

        console.log(`Encontrados ${snapshot.size} turnos para cerrar.`);

        const batch = db.batch();
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`Cerrando turno ID: ${doc.id} - Empleado: ${data.employeeName}`);

            batch.update(doc.ref, {
                status: 'completed',
                estado: 'CERRADO',
                tipoCierre: 'AUTOMATICO',
                endTime: now.toISOString(),
                horaSalidaReal: now.toISOString(),
                detalle: 'cierre forzado',
                systemNote: 'Cierre automático por exceder límite de tiempo (12h + 60m de gracia)'
            });
        });

        await batch.commit();
        console.log('--- Proceso Finalizado Exitosamente ---');
    } catch (error) {
        console.error('Error en el proceso de cierre automático:', error);
    }
}

autoCloseShifts();
