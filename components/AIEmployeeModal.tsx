import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { GoogleGenAI } from '@google/genai';
import { X, Sparkles, Loader2, Upload, Save, AlertCircle, FileText } from 'lucide-react';
import { Employee } from '../types';

interface AIEmployeeModalProps {
    onClose: () => void;
}

export const AIEmployeeModal: React.FC<AIEmployeeModalProps> = ({ onClose }) => {
    const { addEmployee, showNotification, isLoading: storeLoading } = useAppStore();
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileBase64, setFileBase64] = useState<string | null>(null);
    const [mimeType, setMimeType] = useState<string>('image/png');
    const [fileName, setFileName] = useState<string>('');
    const [extractedData, setExtractedData] = useState<Partial<Employee> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = (file: File) => {
        // Validar tipos soportados por Gemini API para inlineData
        const supportedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

        if (!supportedTypes.includes(file.type)) {
            showNotification("Formato no soportado. Por favor use Imágenes (JPG, PNG) o PDF.", "warning");
            return;
        }

        setFileName(file.name || 'Imagen del portapapeles');
        setMimeType(file.type);
        const reader = new FileReader();
        reader.onload = (evt) => {
            const base64 = evt.target?.result as string;
            setFileBase64(base64.split(',')[1]); // Solo el base64 sin el prefijo
        };
        reader.readAsDataURL(file);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        processFile(file);
        e.target.value = ''; // Limpiar input
    };

    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            if (extractedData) return; // No permitir pegar si ya hay datos extraídos (en vista previa)

            const items = e.clipboardData?.items;
            if (!items) return;

            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    if (blob) {
                        processFile(blob);
                        showNotification("Imagen pegada desde el portapapeles", "success");
                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [extractedData]);

    const processWithAI = async () => {
        if (!fileBase64) {
            showNotification("Seleccione un archivo primero", "warning");
            return;
        }

        setIsProcessing(true);
        try {
            const apiKey = (import.meta as any).env?.VITE_API_KEY;
            if (!apiKey) {
                showNotification("Falta API KEY de Gemini", "error");
                setIsProcessing(false);
                return;
            }

            const ai = new GoogleGenAI({ apiKey });

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [
                    {
                        inlineData: {
                            data: fileBase64,
                            mimeType: mimeType
                        }
                    },
                    {
                        text: `
                Analiza esta ficha de personal y extrae la información en formato JSON.
                Los campos a extraer son:
                - firstName: Nombres
                - lastNamePaterno: Primer apellido
                - lastNameMaterno: Segundo apellido
                - rut: RUT completo
                - fechaNacimiento: Fecha de nacimiento (formato YYYY-MM-DD)
                - direccion: Dirección completa
                - email: Correo electrónico
                - phone: Teléfono
                - salud: Sistema de Salud (Fonasa, Isapre, etc)
                - afp: AFP
                - estadoCivil: Estado civil
                - tallePantalon: Talla Pantalón
                - talleCamisa: Talla Camisa
                - talleChaqueta: Talla Chaqueta
                - tallePolar: Talla Polar
                - talleGeologo: Talla Geólogo/Chaleco
                - talleCalzado: Talla Calzado
                - bancoInfo: Información bancaria (Banco, tipo cuenta, numero)
                - contactoFamiliar: Contacto familiar o de emergencia
                
                Instrucciones importantes:
                1. Devuelve ÚNICAMENTE el objeto JSON.
                2. Si un campo no está presente, déjalo como "".
                3. Separa el nombre completo inteligentemente.
            `
                    }
                ],
                config: { responseMimeType: 'application/json' }
            });

            const data = JSON.parse(response.text || "{}");

            setExtractedData(data);
            showNotification("Información extraída correctamente", "success");
        } catch (error) {
            console.error("AI Error:", error);
            showNotification("Error de IA: Verifique el modelo o API Key.", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleConfirm = async () => {
        if (!extractedData) return;

        // Validaciones mínimas
        if (!extractedData.email || !extractedData.rut) {
            showNotification("Faltan campos críticos (Email o RUT) en la extracción", "error");
            return;
        }

        try {
            // Usamos el RUT como contraseña inicial (limpio sin puntos ni guion)
            const defaultPassword = extractedData.rut.replace(/[^0-9kK]/g, '');

            await addEmployee({
                ...extractedData as Employee,
                isActive: true,
                role: 'worker',
                cargo: 'Guardia', // Valor por defecto
            } as Omit<Employee, 'id'>, defaultPassword);

            showNotification("Empleado creado exitosamente", "success");
            onClose();
        } catch (error) {
            // Manejado por store
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                            <Sparkles size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Alta de Personal con IA</h2>
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Digitalización de Ficha de Registro</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                    {!extractedData ? (
                        <div className="h-full flex flex-col items-center justify-center space-y-6 py-12">
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full max-w-md p-12 border-4 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-orange-300 hover:bg-orange-50 transition-all group"
                            >
                                <Upload size={64} className="text-slate-300 group-hover:text-orange-400 mb-4 transition-colors" />
                                <p className="text-slate-500 font-bold text-center">
                                    Haz clic para subir la Ficha de Personal
                                </p>
                                <p className="text-xs text-slate-400 mt-2 font-medium bg-slate-100 px-3 py-1 rounded-full uppercase tracking-tighter">Formatos: JPG, PNG, WEBP o PDF</p>
                                {fileName && (
                                    <div className="mt-4 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 flex items-center gap-2">
                                        <FileText size={16} className="text-orange-500" /> {fileName}
                                    </div>
                                )}
                            </div>

                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                className="hidden"
                                accept="image/*, application/pdf"
                            />

                            <button
                                onClick={processWithAI}
                                disabled={!fileBase64 || isProcessing}
                                className="w-full max-w-md py-4 bg-slate-900 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl hover:bg-black transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 size={24} className="animate-spin" />
                                        Analizando Documento...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={20} className="text-orange-400" />
                                        Comenzar Escaneo Inteligente
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-5 duration-300">
                            {/* PREVIEW FIELDS */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-4">
                                    <AlertCircle className="text-orange-500" size={18} /> Datos Extraídos
                                </h3>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nombres</label>
                                        <input className="w-full text-sm font-bold text-slate-700 p-2 bg-slate-50 rounded-lg border-none" value={extractedData.firstName || ''} readOnly />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Apellidos</label>
                                        <input className="w-full text-sm font-bold text-slate-700 p-2 bg-slate-50 rounded-lg border-none" value={`${extractedData.lastNamePaterno} ${extractedData.lastNameMaterno}`} readOnly />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">RUT</label>
                                        <input className="w-full text-sm font-bold text-slate-700 p-2 bg-slate-50 rounded-lg border-none" value={extractedData.rut || ''} readOnly />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Correo</label>
                                        <input className="w-full text-sm font-bold text-slate-700 p-2 bg-slate-50 rounded-lg border-none" value={extractedData.email || ''} readOnly />
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-100 grid grid-cols-3 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Salud</label>
                                        <div className="text-xs font-bold text-slate-600 truncate">{extractedData.salud || '-'}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AFP</label>
                                        <div className="text-xs font-bold text-slate-600 truncate">{extractedData.afp || '-'}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Civil</label>
                                        <div className="text-xs font-bold text-slate-600 truncate">{extractedData.estadoCivil || '-'}</div>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Banco</label>
                                    <div className="text-xs font-bold text-slate-600">{extractedData.bancoInfo || '-'}</div>
                                </div>
                            </div>

                            {/* SIZES / EPP */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-4">
                                    <FileText className="text-orange-500" size={18} /> Uniforme y EPP
                                </h3>
                                <div className="grid grid-cols-3 gap-3">
                                    {[
                                        { label: 'Pantalón', val: extractedData.tallePantalon },
                                        { label: 'Camisa', val: extractedData.talleCamisa },
                                        { label: 'Chaqueta', val: extractedData.talleChaqueta },
                                        { label: 'Polar', val: extractedData.tallePolar },
                                        { label: 'Geólogo', val: extractedData.talleGeologo },
                                        { label: 'Calzado', val: extractedData.talleCalzado }
                                    ].map((s, idx) => (
                                        <div key={idx} className="bg-slate-50 p-2 rounded-xl text-center">
                                            <div className="text-[8px] font-bold text-slate-400 uppercase mb-1">{s.label}</div>
                                            <div className="text-sm font-black text-slate-700">{s.val || '-'}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="pt-4 border-t border-slate-100">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Contacto Emergencia</label>
                                    <div className="text-xs font-bold text-slate-600 italic">{extractedData.contactoFamiliar || '-'}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
                    <button
                        onClick={() => setExtractedData(null)}
                        disabled={storeLoading || isProcessing}
                        className="px-6 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-50 transition"
                    >
                        {extractedData ? 'Re-escanear' : 'Cancelar'}
                    </button>
                    {extractedData && (
                        <button
                            onClick={handleConfirm}
                            disabled={storeLoading}
                            className="px-8 py-3 bg-blue-600 text-white font-black uppercase tracking-widest rounded-xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition flex items-center gap-2"
                        >
                            {storeLoading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            {storeLoading ? 'Guardando...' : 'Confirmar Alta'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
