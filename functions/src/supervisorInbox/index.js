/**
 * supervisorInbox — Notificaciones internas + push para Supervisores.
 *
 * - Crea documentos en `notificaciones_supervisor` (Admin SDK; el cliente NO puede crearlos).
 * - Push FCM (con sonido) SOLO a supervisores. Administración/Jefatura reciben únicamente
 *   registro en el Centro de Mensajes (sin push).
 *
 * Disparadores:
 *  1. novedades/{id}                          (creada con prioridad crítica/alta)
 *  2. novedades/{id}/seguimientos/{sid}
 *  3. Rondas|novedades/{id}/historialGestion/{gid}   (consulta de Jefatura / respuesta de supervisor)
 *  4. visitasSupervisor/{id}/seguimientos/{sid}      (solo registro; el push ya lo envía notificarSeguimientoVisita)
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

if (!admin.apps.length) {
    admin.initializeApp();
}

const COL = 'notificaciones_supervisor';
const REGION = 'us-central1';

const clip = (text, max = 220) => {
    const t = String(text || '').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

async function findSupervisorsForSite(siteId) {
    const raw = String(siteId === undefined || siteId === null ? '' : siteId).trim();
    if (!raw) return [];
    const variants = [raw];
    if (/^\d+$/.test(raw)) variants.push(Number(raw));
    const snap = await admin.firestore()
        .collection('Colaboradores')
        .where('assignedSites', 'array-contains-any', variants)
        .get();
    return snap.docs.filter((d) => d.data().role === 'supervisor');
}

async function findAdmins() {
    const snap = await admin.firestore()
        .collection('Colaboradores')
        .where('role', 'in', ['admin', 'jefe_operaciones'])
        .get();
    return snap.docs;
}

async function getColaborador(uid) {
    if (!uid) return null;
    const d = await admin.firestore().collection('Colaboradores').doc(uid).get();
    return d.exists ? d : null;
}

/**
 * Crea el registro de notificación para cada destinatario y, opcionalmente, envía push.
 * IDs deterministas (`${eventId}_${uid}`) => idempotente ante reintentos.
 */
async function deliver({ eventId, recipients, excludeUid, push, payload }) {
    const unique = new Map();
    recipients.forEach((d) => {
        if (d && d.id !== excludeUid) unique.set(d.id, d);
    });
    if (unique.size === 0) return;

    const db = admin.firestore();
    const batch = db.batch();
    unique.forEach((_, uid) => {
        const id = `${eventId}_${uid}`;
        batch.set(db.collection(COL).doc(id), {
            id,
            destinatarioUid: uid,
            tipo: payload.tipo,
            titulo: payload.titulo,
            mensaje: payload.mensaje,
            siteId: payload.siteId ? String(payload.siteId) : '',
            siteName: payload.siteName || '',
            origenTipo: payload.origenTipo || '',
            origenId: payload.origenId || '',
            vista: payload.vista || 'dashboard',
            creadaPorUid: payload.creadaPorUid || '',
            creadaPorNombre: payload.creadaPorNombre || '',
            leida: false,
            leidaEn: null,
            creadoEn: FieldValue.serverTimestamp(),
        });
    });
    await batch.commit();

    if (!push) return;

    const tokenOwners = new Map(); // token -> uid
    unique.forEach((d, uid) => {
        (d.data().fcmTokens || []).forEach((t) => {
            if (t) tokenOwners.set(t, uid);
        });
    });
    const tokens = Array.from(tokenOwners.keys());
    if (tokens.length === 0) {
        console.log('[SUPERVISOR-INBOX] Sin tokens FCM para push.');
        return;
    }

    const message = {
        notification: { title: payload.titulo, body: clip(payload.mensaje, 160) },
        android: {
            priority: 'high',
            notification: { channelId: 'ggss_notifications', sound: 'notificacion_ggss.mp3' },
        },
        apns: { payload: { aps: { sound: 'notificacion_ggss.mp3' } } },
        data: {
            type: 'supervisor_inbox',
            tipoNotificacion: payload.tipo,
            vista: payload.vista || 'dashboard',
            origenTipo: payload.origenTipo || '',
            origenId: payload.origenId || '',
        },
        tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[SUPERVISOR-INBOX] Push: ${response.successCount} ok, ${response.failureCount} error.`);

    const bad = [];
    response.responses.forEach((r, idx) => {
        const code = r.error && r.error.code;
        if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument')) {
            bad.push(tokens[idx]);
        }
    });
    for (const token of bad) {
        const uid = tokenOwners.get(token);
        if (uid) {
            await db.collection('Colaboradores').doc(uid).update({
                fcmTokens: FieldValue.arrayRemove(token),
            }).catch(() => undefined);
        }
    }
}

// 1) Novedad urgente creada → push + registro a supervisores; registro a administración
exports.notificarNovedadUrgenteSupervisor = onDocumentCreated(
    { document: 'novedades/{novedadId}', region: REGION },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const nov = snap.data();
        const prioridad = String(nov.prioridad || '').toLowerCase();
        if (prioridad !== 'critica' && prioridad !== 'alta') return;

        try {
            const siteId = nov.sucursalId !== undefined ? nov.sucursalId : nov.siteId;
            const siteName = nov.sucursalNombre || nov.siteName || 'Instalación';
            const etiqueta = prioridad === 'critica' ? 'NOVEDAD CRÍTICA' : 'Novedad prioridad alta';
            const base = {
                tipo: 'novedad_urgente',
                titulo: `${etiqueta} · ${siteName}`,
                mensaje: `${nov.autorNombre || 'Guardia'}: ${clip(nov.descripcion || nov.titulo || 'Sin descripción')}`,
                siteId,
                siteName,
                origenTipo: 'novedad',
                origenId: event.params.novedadId,
                vista: 'dashboard',
                creadaPorUid: nov.autorUid || '',
                creadaPorNombre: nov.autorNombre || 'Guardia',
            };
            const supervisors = await findSupervisorsForSite(siteId);
            await deliver({
                eventId: `nu_${event.params.novedadId}`,
                recipients: supervisors,
                excludeUid: nov.autorUid,
                push: true,
                payload: base,
            });
            await deliver({
                eventId: `nua_${event.params.novedadId}`,
                recipients: await findAdmins(),
                excludeUid: nov.autorUid,
                push: false,
                payload: base,
            });
        } catch (err) {
            console.error('[SUPERVISOR-INBOX] notificarNovedadUrgenteSupervisor:', err);
        }
    },
);

// 2) Seguimiento de novedad → push + registro a supervisores de la instalación
exports.notificarSeguimientoNovedadSupervisor = onDocumentCreated(
    { document: 'novedades/{novedadId}/seguimientos/{seguimientoId}', region: REGION },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const seg = snap.data();
        try {
            const novSnap = await admin.firestore().collection('novedades').doc(event.params.novedadId).get();
            if (!novSnap.exists) return;
            const nov = novSnap.data();
            const siteId = nov.sucursalId !== undefined ? nov.sucursalId : nov.siteId;
            const siteName = nov.sucursalNombre || nov.siteName || 'Instalación';
            const urgente = ['critica', 'alta'].includes(String(nov.prioridad || '').toLowerCase());
            const etiqueta = seg.tipo === 'resolucion' ? 'Novedad resuelta' : 'Seguimiento de novedad';
            const payload = {
                tipo: 'seguimiento_novedad',
                titulo: `${etiqueta} · ${siteName}`,
                mensaje: `${seg.usuarioNombre || 'Usuario'}: ${clip(seg.mensaje)}`,
                siteId,
                siteName,
                origenTipo: 'novedad',
                origenId: event.params.novedadId,
                vista: urgente ? 'dashboard' : 'libro_novedades',
                creadaPorUid: seg.usuarioId || '',
                creadaPorNombre: seg.usuarioNombre || '',
            };
            await deliver({
                eventId: `sn_${event.params.seguimientoId}`,
                recipients: await findSupervisorsForSite(siteId),
                excludeUid: seg.usuarioId,
                push: true,
                payload,
            });
            // Administración: solo registro, y únicamente si el mensaje NO lo escribió administración
            if (!['admin', 'jefe_operaciones'].includes(seg.rol)) {
                await deliver({
                    eventId: `sna_${event.params.seguimientoId}`,
                    recipients: await findAdmins(),
                    excludeUid: seg.usuarioId,
                    push: false,
                    payload,
                });
            }
        } catch (err) {
            console.error('[SUPERVISOR-INBOX] notificarSeguimientoNovedadSupervisor:', err);
        }
    },
);

// 3) Consulta de Jefatura / respuesta del supervisor (historialGestion inmutable)
async function handleHistorialGestion(event, parentCollection) {
    const snap = event.data;
    if (!snap) return;
    const entry = snap.data();
    const { parentId, gestionId } = event.params;
    try {
        const siteId = entry.siteId;
        const siteName = entry.siteName || 'Instalación';
        const origenTipo = parentCollection === 'Rondas' ? 'ronda' : 'novedad';

        if (entry.tipoRegistro === 'consulta_admin') {
            await deliver({
                eventId: `cg_${gestionId}`,
                recipients: await findSupervisorsForSite(siteId),
                excludeUid: entry.supervisorUid,
                push: true,
                payload: {
                    tipo: 'consulta_admin',
                    titulo: `Consulta de Jefatura · ${siteName}`,
                    mensaje: `${entry.supervisorNombre || 'Administración'}: ${clip(entry.medidasTomadas)}`,
                    siteId,
                    siteName,
                    origenTipo,
                    origenId: parentId,
                    vista: 'dashboard',
                    creadaPorUid: entry.supervisorUid || '',
                    creadaPorNombre: entry.supervisorNombre || 'Administración',
                },
            });
            return;
        }

        // Respuesta/gestión del supervisor → registro para administración (sin push)
        let recipients = [];
        const parent = await admin.firestore().collection(parentCollection).doc(parentId).get();
        const consultaAdminUid = parent.exists
            && parent.data().gestionSupervisor
            && parent.data().gestionSupervisor.consultaAdmin
            && parent.data().gestionSupervisor.consultaAdmin.adminUid;
        if (consultaAdminUid) {
            const adminDoc = await getColaborador(consultaAdminUid);
            if (adminDoc) recipients = [adminDoc];
        }
        if (recipients.length === 0) recipients = await findAdmins();

        const estado = entry.fueSolucionado === 'si' ? 'Solucionado'
            : entry.fueSolucionado === 'no' ? 'NO solucionado' : 'Pendiente';
        await deliver({
            eventId: `rg_${gestionId}`,
            recipients,
            excludeUid: entry.supervisorUid,
            push: false,
            payload: {
                tipo: 'respuesta_supervisor',
                titulo: `Respuesta de ${entry.supervisorNombre || 'Supervisor'} · ${siteName}`,
                mensaje: `${estado}. ${clip(entry.medidasTomadas)}`,
                siteId,
                siteName,
                origenTipo,
                origenId: parentId,
                vista: 'dashboard',
                creadaPorUid: entry.supervisorUid || '',
                creadaPorNombre: entry.supervisorNombre || 'Supervisor',
            },
        });
    } catch (err) {
        console.error('[SUPERVISOR-INBOX] handleHistorialGestion:', err);
    }
}

exports.notificarGestionNovedad = onDocumentCreated(
    { document: 'novedades/{parentId}/historialGestion/{gestionId}', region: REGION },
    (event) => handleHistorialGestion(event, 'novedades'),
);

exports.notificarGestionRonda = onDocumentCreated(
    { document: 'Rondas/{parentId}/historialGestion/{gestionId}', region: REGION },
    (event) => handleHistorialGestion(event, 'Rondas'),
);

// 4) Seguimiento de visita → solo registro (el push al supervisor ya lo hace notificarSeguimientoVisita)
exports.registrarSeguimientoVisitaInbox = onDocumentCreated(
    { document: 'visitasSupervisor/{visitaId}/seguimientos/{seguimientoId}', region: REGION },
    async (event) => {
        const snap = event.data;
        if (!snap) return;
        const seg = snap.data();
        try {
            const visitaSnap = await admin.firestore().collection('visitasSupervisor').doc(event.params.visitaId).get();
            if (!visitaSnap.exists) return;
            const visita = visitaSnap.data();
            const siteName = visita.sucursalNombre || 'Sucursal';
            const autorEsSupervisor = seg.autorUid === visita.supervisorUid;
            const texto = clip((seg.mensaje || '').trim() || (seg.fotoUrl ? '📷 Envió una fotografía' : 'Nuevo mensaje'));

            const payload = {
                tipo: 'visita_seguimiento',
                titulo: autorEsSupervisor
                    ? `Respuesta en visita · ${siteName}`
                    : `Seguimiento de Visita · ${siteName}`,
                mensaje: `${seg.autorNombre || 'Usuario'}: ${texto}`,
                siteId: visita.sucursalId || '',
                siteName,
                origenTipo: 'visita',
                origenId: event.params.visitaId,
                vista: 'visitas_supervisor',
                creadaPorUid: seg.autorUid || '',
                creadaPorNombre: seg.autorNombre || '',
            };

            const recipients = autorEsSupervisor
                ? await findAdmins()
                : [await getColaborador(visita.supervisorUid)].filter(Boolean);

            await deliver({
                eventId: `sv_${event.params.seguimientoId}`,
                recipients,
                excludeUid: seg.autorUid,
                push: false,
                payload,
            });
        } catch (err) {
            console.error('[SUPERVISOR-INBOX] registrarSeguimientoVisitaInbox:', err);
        }
    },
);

