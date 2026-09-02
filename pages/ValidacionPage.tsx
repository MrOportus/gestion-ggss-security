/**
 * ValidacionPage.tsx
 * Página pública de validación de documentos firmados.
 * Accesible en /validar/{validationId} sin requerir autenticación.
 * Llama a la Cloud Function validateSignedDocument para recalcular el SHA-256
 * del archivo almacenado y compararlo con el hash registrado al momento de la firma.
 * El cliente NO determina el resultado — solo muestra lo que retorna el backend.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    ShieldCheck,
    ShieldX,
    Loader2,
    Clock,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Hash,
    CalendarDays,
    User,
    FileText,
    RefreshCw,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ValidationResult {
    valid: boolean;
    status: 'VALID' | 'ALTERED' | 'PENDING_INTEGRITY' | 'ERROR';
    algorithm?: string;
    validationId?: string;
    documentTitle?: string;
    signerName?: string;
    signerRut?: string;
    signedAt?: string;
    integrityStatus?: string;
    reason?: string;
    message?: string;
    downloadUrl?: string;
}

interface ValidacionPageProps {
    initialValidationId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(isoString: string): string {
    if (!isoString) return '—';
    try {
        return new Date(isoString).toLocaleString('es-CL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return isoString;
    }
}

// ── Componente ────────────────────────────────────────────────────────────────

const ValidacionPage: React.FC<ValidacionPageProps> = ({ initialValidationId = '' }) => {
    const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(initialValidationId ? 'loading' : 'idle');
    const [result, setResult] = useState<ValidationResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [searchInput, setSearchInput] = useState(initialValidationId);
    const [validationId, setValidationId] = useState(initialValidationId);

    const validate = useCallback(async (idToValidate: string) => {
        if (!idToValidate) return;
        setState('loading');
        setErrorMsg('');
        setValidationId(idToValidate);
        try {
            // Obtener la app de Firebase ya inicializada (o inicializar si no existe)
            const existingApp = getApps().find(a => a.name === '[DEFAULT]');
            const firebaseConfig = {
                apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
                authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
                projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
                storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
                messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
                appId:             import.meta.env.VITE_FIREBASE_APP_ID,
            };
            const app = existingApp ?? initializeApp(firebaseConfig);
            const functions = getFunctions(app, 'us-central1');

            const validateFn = httpsCallable<{ validationId: string }, ValidationResult>(
                functions,
                'validateSignedDocument'
            );
            const response = await validateFn({ validationId: idToValidate });
            setResult(response.data);
            setState('done');
        } catch (err: any) {
            console.error('[ValidacionPage] Error:', err);
            const code = err?.code || '';
            if (code === 'functions/not-found') {
                setErrorMsg('No se encontró ningún documento con ese ID de validación. Verifica que el código sea correcto.');
            } else if (code === 'functions/invalid-argument') {
                setErrorMsg('El ID de validación no es válido.');
            } else {
                setErrorMsg('Ocurrió un error al validar el documento. Intente nuevamente en unos momentos.');
            }
            setState('error');
        }
    }, []);

    useEffect(() => {
        if (initialValidationId) {
            validate(initialValidationId);
        }
    }, [initialValidationId, validate]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const cleaned = searchInput.trim().toUpperCase();
        if (cleaned) {
            window.history.pushState({}, '', `/validar/${cleaned}`);
            validate(cleaned);
        }
    };

    const handleReset = () => {
        setState('idle');
        setSearchInput('');
        setValidationId('');
        setResult(null);
        window.history.pushState({}, '', `/validar`);
    };

    // ── Estado: ingreso manual (idle) ─────────────────────────────────────────
    if (state === 'idle') {
        return (
            <div style={styles.page}>
                <div style={styles.card}>
                    <div style={styles.logoRow}>
                        <img src="/logo-transparencia.png" alt="ASPRO" style={styles.logo} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        <span style={styles.logoText}>ASPRO</span>
                    </div>
                    <p style={styles.subtitle}>Validación de Documentos Firmados</p>
                    <div style={styles.divider} />
                    
                    <div style={{ padding: '16px 0', textAlign: 'center' }}>
                        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
                            Ingresa el código de validación impreso en el documento para comprobar su integridad y ver la copia original.
                        </p>
                        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <input
                                type="text"
                                placeholder="Ej: SIG-ABCD123"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                                style={styles.inputField}
                                required
                            />
                            <button type="submit" style={styles.submitButton} disabled={!searchInput.trim()}>
                                <ShieldCheck size={18} />
                                Validar Documento
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    // ── Estado: cargando ──────────────────────────────────────────────────────
    if (state === 'loading') {
        return (
            <div style={styles.page}>
                <div style={styles.card}>
                    <div style={styles.logoRow}>
                        <img src="/logo-transparencia.png" alt="ASPRO" style={styles.logo} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        <span style={styles.logoText}>ASPRO</span>
                    </div>
                    <div style={styles.divider} />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
                        <Loader2 size={40} style={{ color: '#1e3a5f', animation: 'spin 1s linear infinite' }} />
                        <p style={{ color: '#64748b', fontSize: 14, fontWeight: 600 }}>Verificando integridad del documento…</p>
                        <p style={{ color: '#94a3b8', fontSize: 12 }}>Esto puede tomar unos segundos</p>
                    </div>
                    <div style={styles.validationIdRow}>
                        <Hash size={12} style={{ color: '#94a3b8' }} />
                        <span style={styles.validationIdText}>{validationId}</span>
                    </div>
                </div>
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    // ── Estado: error de red / no encontrado ──────────────────────────────────
    if (state === 'error') {
        return (
            <div style={styles.page}>
                <div style={styles.card}>
                    <div style={styles.logoRow}>
                        <img src="/logo-transparencia.png" alt="ASPRO" style={styles.logo} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        <span style={styles.logoText}>ASPRO</span>
                    </div>
                    <div style={styles.divider} />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '28px 0' }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <AlertTriangle size={32} style={{ color: '#d97706' }} />
                        </div>
                        <p style={{ color: '#374151', fontSize: 15, fontWeight: 700, textAlign: 'center' }}>No se pudo validar</p>
                        <p style={{ color: '#64748b', fontSize: 13, textAlign: 'center', lineHeight: 1.5, maxWidth: 300 }}>{errorMsg}</p>
                        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                            <button onClick={handleReset} style={styles.secondaryButton}>
                                Volver
                            </button>
                            <button onClick={() => validate(validationId)} style={styles.retryButton}>
                                <RefreshCw size={14} /> Reintentar
                            </button>
                        </div>
                    </div>
                    <div style={styles.validationIdRow}>
                        <Hash size={12} style={{ color: '#94a3b8' }} />
                        <span style={styles.validationIdText}>{validationId}</span>
                    </div>
                </div>
            </div>
        );
    }

    // ── Estado: resultado recibido ────────────────────────────────────────────
    const isValid   = result?.valid === true;
    const isPending = result?.status === 'PENDING_INTEGRITY';

    const statusColor   = isPending ? '#d97706' : isValid ? '#16a34a' : '#dc2626';
    const statusBgColor = isPending ? '#fef3c7' : isValid ? '#dcfce7' : '#fee2e2';
    const StatusIcon    = isPending ? Clock : isValid ? ShieldCheck : ShieldX;

    return (
        <div style={styles.page}>
            <div style={styles.card}>
                {/* Logo */}
                <div style={styles.logoRow}>
                    <img src="/logo-transparencia.png" alt="ASPRO" style={styles.logo} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span style={styles.logoText}>ASPRO</span>
                </div>
                <p style={styles.subtitle}>Validación de Documento</p>

                <div style={styles.divider} />

                {/* Banner de resultado principal */}
                <div style={{ ...styles.statusBanner, background: statusBgColor, borderColor: statusColor + '40' }}>
                    <StatusIcon size={36} style={{ color: statusColor, flexShrink: 0 }} />
                    <div>
                        <p style={{ ...styles.statusTitle, color: statusColor }}>
                            {isPending
                                ? 'PROCESANDO'
                                : isValid
                                ? '✓ DOCUMENTO ÍNTEGRO'
                                : '✕ POSIBLE ALTERACIÓN'}
                        </p>
                        <p style={{ ...styles.statusDesc, color: statusColor + 'cc' }}>
                            {isPending
                                ? (result?.message || 'El registro de integridad está siendo procesado. Intente nuevamente en unos segundos.')
                                : isValid
                                ? 'El documento corresponde al registro almacenado en ASPRO y no presenta alteraciones respecto de la versión registrada al momento de la firma.'
                                : 'La huella digital actual del archivo no coincide con la huella registrada al momento de la firma. El documento puede haber sido modificado.'}
                        </p>
                    </div>
                </div>

                <div style={styles.divider} />

                {/* Detalles del documento */}
                {!isPending && result && (
                    <div style={styles.detailsGrid}>
                        {result.documentTitle && (
                            <DetailRow icon={<FileText size={15} style={{ color: '#64748b' }} />} label="Documento" value={result.documentTitle} />
                        )}
                        {result.signerName && (
                            <DetailRow icon={<User size={15} style={{ color: '#64748b' }} />} label="Firmante" value={result.signerName} />
                        )}
                        {result.signerRut && (
                            <DetailRow icon={<User size={15} style={{ color: '#64748b' }} />} label="RUT" value={result.signerRut} />
                        )}
                        {result.signedAt && (
                            <DetailRow icon={<CalendarDays size={15} style={{ color: '#64748b' }} />} label="Fecha de firma" value={formatDate(result.signedAt)} />
                        )}
                        <DetailRow icon={<Hash size={15} style={{ color: '#64748b' }} />} label="Método" value="Firma electrónica" />
                        {result.algorithm && (
                            <DetailRow icon={<ShieldCheck size={15} style={{ color: '#64748b' }} />} label="Integridad" value={result.algorithm} />
                        )}
                        <DetailRow
                            icon={isValid
                                ? <CheckCircle2 size={15} style={{ color: '#16a34a' }} />
                                : <XCircle size={15} style={{ color: '#dc2626' }} />}
                            label="Estado"
                            value={isValid ? '✓ VÁLIDO' : '✕ NO VÁLIDO'}
                            valueStyle={{ color: isValid ? '#16a34a' : '#dc2626', fontWeight: 700 }}
                        />
                    </div>
                )}

                {/* Botón Ver Original */}
                {!isPending && isValid && result?.downloadUrl && (
                    <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
                        <a
                            href={result.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={styles.downloadButton}
                        >
                            <FileText size={16} />
                            Ver Documento Original
                        </a>
                    </div>
                )}

                <div style={styles.divider} />

                {/* ID de validación */}
                <div style={styles.validationIdRow}>
                    <Hash size={12} style={{ color: '#94a3b8' }} />
                    <span style={styles.validationIdLabel}>ID de validación:</span>
                    <span style={{ ...styles.validationIdText, userSelect: 'all' as const }}>{validationId}</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                    <button onClick={handleReset} style={{ ...styles.secondaryButton, fontSize: 13 }}>
                        Validar otro documento
                    </button>
                </div>

                {/* Aviso legal */}
                <p style={styles.disclaimer}>
                    Esta verificación acredita la integridad del archivo digital mediante huella SHA-256.
                    No constituye una Firma Electrónica Avanzada conforme a la Ley 19.799.
                </p>
            </div>
        </div>
    );
};

// ── Sub-componente ────────────────────────────────────────────────────────────

interface DetailRowProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    valueStyle?: React.CSSProperties;
}

const DetailRow: React.FC<DetailRowProps> = ({ icon, label, value, valueStyle }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ paddingTop: 2, flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{label}</p>
            <p style={{ fontSize: 14, color: '#1e293b', fontWeight: 600, margin: '2px 0 0', ...valueStyle }}>{value}</p>
        </div>
    </div>
);

// ── Estilos en objeto ─────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
    page: {
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        fontFamily: "'Inter', system-ui, sans-serif",
    },
    card: {
        background: '#ffffff',
        borderRadius: 24,
        padding: '32px 28px',
        width: '100%',
        maxWidth: 460,
        boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
    },
    logoRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 4,
    },
    logo: {
        height: 36,
        width: 36,
        objectFit: 'contain',
    },
    logoText: {
        fontSize: 20,
        fontWeight: 900,
        color: '#0f172a',
        letterSpacing: '-0.02em',
    },
    subtitle: {
        fontSize: 12,
        color: '#64748b',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        margin: '4px 0 0',
    },
    divider: {
        height: 1,
        background: '#f1f5f9',
        margin: '20px 0',
    },
    statusBanner: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '18px 16px',
        borderRadius: 14,
        border: '2px solid transparent',
    },
    statusTitle: {
        fontSize: 15,
        fontWeight: 900,
        letterSpacing: '-0.01em',
        margin: 0,
    },
    statusDesc: {
        fontSize: 12,
        lineHeight: 1.55,
        margin: '6px 0 0',
    },
    detailsGrid: {
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
    },
    validationIdRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap' as const,
    },
    validationIdLabel: {
        fontSize: 11,
        color: '#94a3b8',
        fontWeight: 600,
    },
    validationIdText: {
        fontSize: 11,
        color: '#475569',
        fontWeight: 700,
        wordBreak: 'break-all' as const,
        fontFamily: 'monospace',
    },
    disclaimer: {
        fontSize: 10,
        color: '#94a3b8',
        lineHeight: 1.5,
        marginTop: 16,
        textAlign: 'center' as const,
    },
    retryButton: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 20px',
        background: '#1e3a5f',
        color: '#ffffff',
        border: 'none',
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        marginTop: 8,
    },
};

export default ValidacionPage;
