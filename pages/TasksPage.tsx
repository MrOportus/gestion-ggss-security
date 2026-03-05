import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  ClipboardList, Copy, CheckCircle, FileText, Send,
  Clock, UserPlus, FileSearch, Upload, Loader2, Table as TableIcon,
  History, Calendar, Users as UsersIcon, ChevronRight, X, Sparkles, Search, MapPin,
  Briefcase, DollarSign, Download, Building2, Camera, ArrowLeft
} from 'lucide-react';
import SmartAutofill from '../components/SmartAutofill';
import { GoogleGenAI } from "@google/genai";
import * as XLSX from 'xlsx';
import { ComparisonRecord } from '../types';
import AdvancePayroll from '../components/AdvancePayroll';
import GalileoExtractor from '../components/GalileoExtractor';
import { Banknote } from 'lucide-react';
import { getToken, onMessage } from "firebase/messaging";
import { messaging } from '../lib/firebase';

const TasksPage: React.FC = () => {
  const {
    employees, sites, f30History, contractHistory,
    saveF30Comparison, saveContractRecord, showNotification,
    currentUser, supervisorTasks, updateSupervisorTask,
    registerFCMToken
  } = useAppStore();
  const [activeTask, setActiveTask] = useState<'info_reemplazo' | 'comparar_f30' | 'smart_autofill' | 'generar_contrato' | 'plataforma_falabella' | 'nomina_anticipos' | 'formalizar_servicio' | 'supervision_sucursal' | 'informar_renuncia' | 'extractor_galileo' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<ComparisonRecord | null>(null);

  // --- ESTADOS INFO REEMPLAZO ---
  const [reemplazoData, setReemplazoData] = useState({
    empleadoActualId: '',
    empleadoReemplazoId: '',
    diaReemplazo: '',
    motivo: '',
    sucursalId: ''
  });
  const [siteSearch, setSiteSearch] = useState('');
  const [actualSearch, setActualSearch] = useState('');
  const [replacementSearch, setReplacementSearch] = useState('');
  const [showSiteList, setShowSiteList] = useState(false);
  const [showActualList, setShowActualList] = useState(false);
  const [showReplacementList, setShowReplacementList] = useState(false);
  const [showInactive, setShowInactive] = useState(true);
  const [copied, setCopied] = useState(false);

  // --- ESTADOS GENERAR CONTRATO ---
  const [contratoData, setContratoData] = useState({
    empleadoId: '',
    sucursalId: '',
    fechaInicio: '',
    fechaTermino: '',
    horarioA: '08:30 AM a 18:30 PM',
    horarioB: '18:00 PM a 09:00 AM',
    tipoContrato: 'Falabella Part-Time',
    sueldo: '529000'
  });
  const [contratoEmpSearch, setContratoEmpSearch] = useState('');
  const [contratoSiteSearch, setContratoSiteSearch] = useState('');
  const [showContratoEmpList, setShowContratoEmpList] = useState(false);
  const [showContratoSiteList, setShowContratoSiteList] = useState(false);
  const [showInactiveContrato, setShowInactiveContrato] = useState(true);

  // Refs para cierre al hacer click fuera
  const siteRef = useRef<HTMLDivElement>(null);
  const actualRef = useRef<HTMLDivElement>(null);
  const replacementRef = useRef<HTMLDivElement>(null);
  const contratoEmpRef = useRef<HTMLDivElement>(null);
  const contratoSiteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (siteRef.current && !siteRef.current.contains(event.target as Node)) setShowSiteList(false);
      if (actualRef.current && !actualRef.current.contains(event.target as Node)) setShowActualList(false);
      if (replacementRef.current && !replacementRef.current.contains(event.target as Node)) setShowReplacementList(false);
      if (contratoEmpRef.current && !contratoEmpRef.current.contains(event.target as Node)) setShowContratoEmpList(false);
      if (contratoSiteRef.current && !contratoSiteRef.current.contains(event.target as Node)) setShowContratoSiteList(false);
      if (formalizarSiteRef.current && !formalizarSiteRef.current.contains(event.target as Node)) setShowFormalizarSiteList(false);
      if (formalizarEmpRef.current && !formalizarEmpRef.current.contains(event.target as Node)) setShowFormalizarEmpList(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- NOTIFICACIONES PUSH ---
  useEffect(() => {
    const setupNotifications = async () => {
      if (currentUser && (currentUser.role === 'supervisor' || currentUser.role === 'admin')) {
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            const token = await getToken(messaging, {
              vapidKey: 'BD6p9B2G2_YOUR_VAPID_KEY_PLACEHOLDER' // Reemplazar con clave real de Firebase Console
            });

            if (token) {
              await registerFCMToken(currentUser.uid, token);
              console.log("FCM Token registrado");
            }
          }
        } catch (error) {
          console.error("Error setting up notifications:", error);
        }
      }
    };

    setupNotifications();

    const unsubscribe = onMessage(messaging, (payload) => {
      console.log('Message received in foreground: ', payload);
      if (payload.notification) {
        showNotification(`${payload.notification.title}: ${payload.notification.body}`, 'info');
      }
    });

    return () => unsubscribe();
  }, [currentUser, registerFCMToken, showNotification]);

  // --- ESTADOS COMPARAR F30 ---
  const [f30FileBase64, setF30FileBase64] = useState<string | null>(null);
  const [f30FileName, setF30FileName] = useState<string>('');
  const [rawPlanillaText, setRawPlanillaText] = useState('');
  const [finalComparison, setFinalComparison] = useState<{ rut: string, name: string, inF30: boolean }[]>([]);
  const [periodo, setPeriodo] = useState('');

  // --- ESTADOS PLATAFORMA FALABELLA ---
  const [falabellaFiles, setFalabellaFiles] = useState<{ active?: File, platform?: File }>({});
  const [falabellaResults, setFalabellaResults] = useState<{
    matches: { rut: string, name: string, matchType: string }[],
    onlyActive: { rut: string, name: string }[],
    onlyPlatform: { rut: string, name: string }[],
    manualReview: { active: { rut: string, name: string }, platform: { rut: string, name: string }, reason: string }[]
  } | null>(null);

  // --- ESTADOS FORMALIZAR SERVICIO ---
  const [formalizarData, setFormalizarData] = useState({
    supervisor: 'Andres Castro',
    proveedor: 'Aspro',
    sucursalId: '',
    motivo: '',
    fechaInicio: '',
    fechaTermino: '',
    horaInicio: '08:00',
    horaTermino: '20:00',
    empleadoId: ''
  });
  const [formalizarSiteSearch, setFormalizarSiteSearch] = useState('');
  const [formalizarEmpSearch, setFormalizarEmpSearch] = useState('');
  const [showFormalizarSiteList, setShowFormalizarSiteList] = useState(false);
  const [showFormalizarEmpList, setShowFormalizarEmpList] = useState(false);
  const formalizarSiteRef = useRef<HTMLDivElement>(null);
  const formalizarEmpRef = useRef<HTMLDivElement>(null);
  const [formalizarRows, setFormalizarRows] = useState<any[]>([]);

  // --- ESTADOS SUPERVISION SUCURSAL ---
  const [selectedSupervisionId, setSelectedSupervisionId] = useState<string | null>(null);
  const currentSupervisionTask = supervisorTasks.find(t => t.id === selectedSupervisionId);

  // --- ESTADOS INFORMAR RENUNCIA ---
  const { addResignationRequest } = useAppStore();
  const [resignationData, setResignationData] = useState({
    workerId: '',
    resignationDate: new Date().toISOString().slice(0, 10),
    effectiveDate: new Date().toISOString().slice(0, 10),
    reason: '',
    observations: ''
  });
  const [resignationWorkerSearch, setResignationWorkerSearch] = useState('');
  const [showResignationWorkerList, setShowResignationWorkerList] = useState(false);
  const resignationWorkerRef = useRef<HTMLDivElement>(null);
  const [resignationAttachments, setResignationAttachments] = useState<string[]>([]);

  // --- LOGICA INFO REEMPLAZO ---
  const currentEmp = employees.find(e => String(e.id) === reemplazoData.empleadoActualId);
  const replacementEmp = employees.find(e => String(e.id) === reemplazoData.empleadoReemplazoId);
  const sucursal = sites.find(s => String(s.id) === reemplazoData.sucursalId);

  const filteredSitesTasks = useMemo(() => {
    const lower = siteSearch.toLowerCase();
    return sites.filter(s => s.name.toLowerCase().includes(lower));
  }, [sites, siteSearch]);

  const filteredActual = useMemo(() => {
    const lower = actualSearch.toLowerCase();
    return employees.filter(e =>
      e.isActive && (e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower))
    );
  }, [employees, actualSearch]);

  const filteredReplacement = useMemo(() => {
    const lower = replacementSearch.toLowerCase();
    return employees.filter(e => {
      const matchesSearch = e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower);
      const matchesStatus = showInactive ? true : e.isActive;
      return matchesSearch && matchesStatus;
    });
  }, [employees, replacementSearch, showInactive]);

  // --- LOGICA GENERAR CONTRATO ---
  const filteredContratoEmp = useMemo(() => {
    const lower = contratoEmpSearch.toLowerCase();
    return employees.filter(e => {
      const matchesSearch = e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower);
      const matchesStatus = showInactiveContrato ? true : e.isActive;
      return matchesSearch && matchesStatus;
    });
  }, [employees, contratoEmpSearch, showInactiveContrato]);

  const filteredContratoSites = useMemo(() => {
    const lower = contratoSiteSearch.toLowerCase();
    return sites.filter(s => s.name.toLowerCase().includes(lower));
  }, [sites, contratoSiteSearch]);

  const contratoEmp = employees.find(e => String(e.id) === contratoData.empleadoId);
  const contratoSite = sites.find(s => String(s.id) === contratoData.sucursalId);

  // --- LOGICA FORMALIZAR SERVICIO ---
  const filteredFormalizarSites = useMemo(() => {
    const lower = formalizarSiteSearch.toLowerCase();
    return sites.filter(s =>
      s.empresa?.toLowerCase().includes('falabella') &&
      s.name.toLowerCase().includes(lower)
    );
  }, [sites, formalizarSiteSearch]);

  const filteredFormalizarEmp = useMemo(() => {
    const lower = formalizarEmpSearch.toLowerCase();
    return employees.filter(e =>
      e.isActive && (e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower))
    );
  }, [employees, formalizarEmpSearch]);

  const formalizarEmp = employees.find(e => String(e.id) === formalizarData.empleadoId);
  const formalizarSite = sites.find(s => String(s.id) === formalizarData.sucursalId);

  const handleGenerateContract = async () => {
    if (!contratoEmp || !contratoSite || !contratoData.fechaInicio) {
      showNotification("Por favor seleccione un colaborador, una sucursal y la fecha de inicio.", "warning");
      return;
    }

    setIsProcessing(true);
    try {
      const payload = {
        tipo_contrato: contratoData.tipoContrato,
        Nombre: `${contratoEmp.firstName} ${contratoEmp.lastNamePaterno} ${contratoEmp.lastNameMaterno || ''}`.trim(),
        rut: contratoEmp.rut,
        fecha_nacimiento: contratoEmp.fechaNacimiento || '',
        nacionalidad: contratoEmp.nacionalidad || '',
        estado_civil: contratoEmp.estadoCivil || '',
        telefono: contratoEmp.phone || '',
        salud: contratoEmp.salud || '',
        afp: contratoEmp.afp || '',
        sucursal: contratoSite.name,
        direccion_sucursal: contratoSite.address,
        Horario_A: contratoData.horarioA,
        Horario_B: contratoData.horarioB,
        Sueldo: contratoData.sueldo || contratoEmp.sueldoLiquido || 0,
        Fecha_inicio: contratoData.fechaInicio,
        Fecha_inicio2: formatLongDate(contratoData.fechaInicio),
        Fecha_termino: contratoData.fechaTermino
      };

      // Nota: URL del webhook de n8n. Debería configurarse en .env
      const webhookUrl = (import.meta as any).env?.VITE_N8N_CONTRACT_WEBHOOK_URL || 'https://n8n.webhook.com/generar-contrato';

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Error al enviar al webhook');

      const result = await response.json();
      const downloadUrl = result.url || result.download_url || result.link || '';

      if (downloadUrl) {
        saveContractRecord({
          workerName: `${contratoEmp.firstName} ${contratoEmp.lastNamePaterno}`,
          siteName: contratoSite.name,
          downloadUrl: downloadUrl
        });
        showNotification("¡Contrato generado exitosamente! Iniciando descarga...", "success");
        window.open(downloadUrl, '_blank');
      } else {
        showNotification("Contrato generado, pero no se recibió link de descarga.", "warning");
      }
    } catch (error) {
      console.error("Error generating contract:", error);
      showNotification("Error de conexión con el servidor de automatización.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDateForText = (dateStr: string) => {
    if (!dateStr) return '[Día ingresado]';
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  };

  const formatLongDate = (dateStr: string) => {
    if (!dateStr) return '';
    const months = [
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ];
    const [year, month, day] = dateStr.split('-');
    return `${day} de ${months[parseInt(month) - 1]} del ${year}`;
  };

  const generatedReemplazoText = `Estimados.
Banco Falabella
PRESENTE

Junto con saludar y según requerimiento, solicito autorización para reemplazar al gg.ss el ${formatDateForText(reemplazoData.diaReemplazo)}, motivo: ${reemplazoData.motivo || '[Motivo Ingresado]'}.

Sucursal ${sucursal?.name || '[Sucursal Ingresada]'}

Actualmente:  
${currentEmp ? `${currentEmp.firstName} ${currentEmp.lastNamePaterno}` : '[Nombre colaborador 1]'}
Rut: ${currentEmp?.rut || '[Rut_colaborador 1]'}

Concurre en su reemplazo: 
${replacementEmp ? `${replacementEmp.firstName} ${replacementEmp.lastNamePaterno}` : '[Nombre colaborador 2]'}  
Rut: ${replacementEmp?.rut || '[Rut_colaborador 2]'}

Documentos que se adjuntan.

1.- Contrato de Trabajo.
2.- Sol. Credencial.
3.- Seguro de Vida.
4.- Cédula de identidad.`;

  // --- LOGICA COMPARAR F30 ---
  const handleF30Upload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setF30FileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setF30FileBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const normalizeRut = (rut: string) => rut.replace(/\./g, '').toLowerCase().trim();

  const processF30Comparison = async () => {
    if (!f30FileBase64 || !rawPlanillaText) {
      showNotification("Por favor suba el archivo F30 y pegue el listado de la planilla.", "warning");
      return;
    }

    setIsProcessing(true);
    try {
      // FIX: Usar import.meta.env para Vite en lugar de process.env
      const apiKey = (import.meta as any).env?.VITE_API_KEY;

      if (!apiKey) {
        showNotification("Falta la API KEY de Gemini.", "error");
        setIsProcessing(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey: apiKey });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: {
              data: f30FileBase64,
              mimeType: 'application/pdf'
            }
          },
          {
            text: "Extrae de este documento F30-1 todos los RUTs y Nombres de los trabajadores listados. Devuelve únicamente un array JSON con objetos {rut: string, name: string}. Ignora encabezados o datos de la empresa, solo la lista de empleados."
          }
        ],
        config: { responseMimeType: 'application/json' }
      });

      const f30Workers = JSON.parse(response.text || "[]") as { rut: string, name: string }[];

      const lines = rawPlanillaText.split('\n').filter(l => l.trim() !== '');
      const uniquePlanilla: { rut: string, name: string }[] = [];
      const seenRuts = new Set();

      lines.forEach(line => {
        const parts = line.split('\t').length > 1 ? line.split('\t') : line.split(/ {2,}/);
        if (parts.length >= 2) {
          const rawRut = parts[0].trim();
          const name = parts[1].trim();
          const normRut = normalizeRut(rawRut);

          if (!seenRuts.has(normRut)) {
            uniquePlanilla.push({ rut: rawRut, name: name });
            seenRuts.add(normRut);
          }
        }
      });

      const comparison = uniquePlanilla.map(p => {
        const normPRut = normalizeRut(p.rut);
        const found = f30Workers.some(f => normalizeRut(f.rut) === normPRut || normalizeRut(f.name).toLowerCase().includes(normalizeRut(p.name).split(' ')[0]));
        return {
          rut: p.rut,
          name: p.name,
          inF30: found
        };
      });

      setFinalComparison(comparison);

      // Guardar en el historial automáticamente
      saveF30Comparison({
        periodo: periodo || 'Sin Periodo',
        data: comparison
      });

    } catch (error) {
      console.error("Error procesando comparación:", error);
      showNotification("Error al procesar el documento.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const copyAsExcelTable = async (dataToCopy: ComparisonRecord['data'], customPeriodo?: string) => {
    const title = `REMITE ANT. COLABORADORES PERIODO ${(customPeriodo || periodo).toUpperCase() || '__________'}`;

    const tableHtml = `
      <table border="1" style="border-collapse: collapse; font-family: sans-serif; width: 100%;">
        <thead>
          <tr>
            <th colspan="4" style="background-color: #1e293b; color: white; padding: 10px; text-align: left;">${title}</th>
          </tr>
          <tr style="background-color: #f1f5f9;">
            <th style="padding: 8px; border: 1px solid #cbd5e1;">RUT</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">NOMBRE</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">CONTRATO</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">F-30 1</th>
          </tr>
        </thead>
        <tbody>
          ${dataToCopy.map(item => `
            <tr>
              <td style="padding: 8px; border: 1px solid #cbd5e1;">${item.rut}</td>
              <td style="padding: 8px; border: 1px solid #cbd5e1;">${item.name}</td>
              <td style="padding: 8px; border: 1px solid #cbd5e1;"></td>
              <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: ${item.inF30 ? '#059669' : '#dc2626'}">${item.inF30 ? 'SÍ' : 'NO'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    const plainText = `${title}\n\nRUT\tNOMBRE\tCONTRATO\tF-30 1\n` +
      dataToCopy.map(i => `${i.rut}\t${i.name}\t\t${i.inF30 ? 'SÍ' : 'NO'}`).join('\n');

    try {
      const blobHtml = new Blob([tableHtml], { type: 'text/html' });
      const blobText = new Blob([plainText], { type: 'text/plain' });

      const data = [new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
      })];

      await navigator.clipboard.write(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Error copying to clipboard:", err);
      navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // --- LOGICA PLATAFORMA FALABELLA ---
  const handleFalabellaFileChange = (type: 'active' | 'platform', e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFalabellaFiles(prev => ({ ...prev, [type]: e.target.files![0] }));
    }
  };

  const cleanRut = (rut: any) => {
    if (!rut) return '';
    // Solo números y K, todo a minúsculas
    return String(rut).toLowerCase().replace(/[^0-9k]/g, '');
  };

  const cleanName = (name: any) => {
    if (!name) return '';
    // MAYÚSCULAS, eliminar tildes, solo alfanumérico básico y un solo espacio
    return String(name).toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Sin tildes
      .replace(/[^A-Z0-9\s]/g, '') // Solo letras, números y espacios
      .trim().replace(/\s+/g, ' ');
  };

  const processFalabellaComparison = async () => {
    if (!falabellaFiles.active || !falabellaFiles.platform) {
      showNotification("Por favor suba ambos archivos Excel.", "warning");
      return;
    }

    setIsProcessing(true);
    try {
      const readExcel = (file: File): Promise<any[]> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data = e.target?.result;
              const workbook = XLSX.read(data, { type: 'binary' });
              const sheetName = workbook.SheetNames[0];
              const sheet = workbook.Sheets[sheetName];
              const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
              resolve(json as any[]);
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = reject;
          reader.readAsBinaryString(file);
        });
      };

      const [activeData, platformData] = await Promise.all([
        readExcel(falabellaFiles.active!),
        readExcel(falabellaFiles.platform!)
      ]);

      // --- Helper to parse RUT consistently ---
      const formatDisplayRut = (body: string, dv: string) => {
        const b = body.trim();
        const d = dv.trim();
        if (!d) return b;
        if (b.includes('-')) return b;
        return `${b}-${d}`;
      };

      // --- Process RAW lists ---
      const rawActive = activeData.slice(1).map(row => {
        if (!row[0]) return null;
        const pBody = String(row[0]).trim();
        const pDv = String(row[1] || '').trim();
        const pName = String(row[2] || '').trim();
        if (pBody.toLowerCase().includes('rut')) return null;

        const displayRut = formatDisplayRut(pBody, pDv);
        return {
          rut: displayRut,
          cleanRut: cleanRut(displayRut),
          name: pName,
          cleanName: cleanName(pName),
          raw: row
        };
      }).filter((item): item is any => item !== null && item.cleanRut.length > 4);

      const rawPlatform = platformData.slice(1).map((row, idx) => {
        if (!row[0]) return null;
        const pRut = String(row[0]).trim();
        const pName = String(row[1] || '').trim();
        if (pRut.toLowerCase().includes('rut')) return null;

        return {
          id: `plat-${idx}`,
          rut: pRut,
          cleanRut: cleanRut(pRut),
          name: pName,
          cleanName: cleanName(pName),
          raw: row
        };
      }).filter((item): item is any => item !== null && item.cleanRut.length > 4);

      // --- DEDUPLICATE lists by cleanRut to satisfy "NO DUPLICADOS" requirement ---
      const activeList: any[] = [];
      const activeSeen = new Set();
      rawActive.forEach(item => {
        if (!activeSeen.has(item.cleanRut)) {
          activeList.push(item);
          activeSeen.add(item.cleanRut);
        }
      });

      const platformList: any[] = [];
      const platformSeen = new Set();
      rawPlatform.forEach(item => {
        if (!platformSeen.has(item.cleanRut)) {
          platformList.push(item);
          platformSeen.add(item.cleanRut);
        }
      });

      const matches: any[] = [];
      const pendingActive: any[] = [];
      const matchedPlatformIds = new Set<string>();
      const matchedActiveRuts = new Set<string>();

      // Logic:
      // 1. Exact RUT matches
      activeList.forEach(activeItem => {
        const matchIndex = platformList.findIndex(p => !matchedPlatformIds.has(p.id) && p.cleanRut === activeItem.cleanRut);
        if (matchIndex !== -1) {
          const match = platformList[matchIndex];
          matches.push({ rut: activeItem.rut, name: activeItem.name, matchType: 'RUT' });
          matchedPlatformIds.add(match.id);
          matchedActiveRuts.add(activeItem.cleanRut);
        }
      });

      // 2. Exact Name matches
      activeList.forEach(activeItem => {
        if (matchedActiveRuts.has(activeItem.cleanRut)) return;
        const matchIndex = platformList.findIndex(p => !matchedPlatformIds.has(p.id) && p.cleanName === activeItem.cleanName);
        if (matchIndex !== -1) {
          const match = platformList[matchIndex];
          matches.push({ rut: activeItem.rut, name: activeItem.name, matchType: 'NOMBRE' });
          matchedPlatformIds.add(match.id);
          matchedActiveRuts.add(activeItem.cleanRut);
        } else {
          pendingActive.push(activeItem);
        }
      });

      // 3. Similarity Check (Manual Review)
      const manualReview: any[] = [];
      const onlyActive: any[] = [];
      const getRutBase = (r: string) => r.replace(/[^0-9]/g, '');
      const getWords = (n: string) => n.split(' ').filter(w => w.length > 2);

      pendingActive.forEach(a => {
        const aBase = getRutBase(a.cleanRut);
        const aWords = getWords(a.cleanName);

        const simIndex = platformList.findIndex(p => {
          if (matchedPlatformIds.has(p.id)) return false;

          const pBase = getRutBase(p.cleanRut);
          const pWords = getWords(p.cleanName);

          // Checks: Same RUT Base OR similar names (2+ words in common)
          if (aBase === pBase && aBase.length > 5) return true;
          const commonWords = aWords.filter(w => pWords.includes(w));
          if (commonWords.length >= 2) return true;

          return false;
        });

        if (simIndex !== -1) {
          const p = platformList[simIndex];
          manualReview.push({
            active: { rut: a.rut, name: a.name },
            platform: { rut: p.rut, name: p.name },
            reason: getRutBase(a.cleanRut) === getRutBase(p.cleanRut) ? 'RUT Similar' : 'Nombre Similar'
          });
          matchedPlatformIds.add(p.id);
        } else {
          onlyActive.push({ rut: a.rut, name: a.name });
        }
      });

      const onlyPlatform = platformList
        .filter(p => !matchedPlatformIds.has(p.id))
        .map(p => ({ rut: p.rut, name: p.name }));

      setFalabellaResults({ matches, onlyActive, onlyPlatform, manualReview });
      showNotification("Cruce completado. Revise 'Revisión Manual' para posibles aciertos.", "success");
    } catch (error) {
      console.error("Error processing Falabella comparison:", error);
      showNotification("Error al procesar los archivos. Verifique formato.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const exportFalabellaToExcel = () => {
    if (!falabellaResults) return;

    const wb = XLSX.utils.book_new();

    const matchesWS = XLSX.utils.json_to_sheet(falabellaResults.matches.map(m => ({
      'RUT': m.rut,
      'Nombre': m.name,
      'Tipo Match': m.matchType
    })));
    XLSX.utils.book_append_sheet(wb, matchesWS, "COINCIDENCIAS");

    const onlyActiveWS = XLSX.utils.json_to_sheet(falabellaResults.onlyActive.map(m => ({
      'RUT': m.rut,
      'Nombre': m.name
    })));
    XLSX.utils.book_append_sheet(wb, onlyActiveWS, "SOLO EN ACTIVOS PLATAFORMA");

    const onlyPlatformWS = XLSX.utils.json_to_sheet(falabellaResults.onlyPlatform.map(m => ({
      'RUT': m.rut,
      'Nombre': m.name
    })));
    XLSX.utils.book_append_sheet(wb, onlyPlatformWS, "SOLO EN PLANILLA COBROS");

    if (falabellaResults.manualReview.length > 0) {
      const manualWS = XLSX.utils.json_to_sheet(falabellaResults.manualReview.map(m => ({
        'Nombre Activos': m.active.name,
        'RUT Activos': m.active.rut,
        'Nombre Planilla': m.platform.name,
        'RUT Planilla': m.platform.rut,
        'Motivo Duda': m.reason
      })));
      XLSX.utils.book_append_sheet(wb, manualWS, "REVISION MANUAL");
    }

    XLSX.writeFile(wb, `Dia14_Falabella_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportF30ComparisonToExcel = (data: any[], periodoTitle: string) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data.map(item => ({
      'RUT': item.rut,
      'Nombre': item.name,
      'En F30': item.inF30 ? 'SÍ' : 'NO'
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Resultado Cruce");
    XLSX.writeFile(wb, `Cruce_F30_${periodoTitle || 'SinPeríodo'}.xlsx`);
  };

  const tasks = [
    { id: 'info_reemplazo', title: 'Info Reemplazo', icon: <UserPlus className="text-blue-500" />, desc: 'Generar solicitud formal de reemplazo para Banco Falabella.' },
    { id: 'generar_contrato', title: 'Generar Contrato', icon: <FileText className="text-violet-500" />, desc: 'Generar contrato de trabajo con envío automático a n8n.' },
    { id: 'comparar_f30', title: 'Comparar F30-1', icon: <FileSearch className="text-emerald-500" />, desc: 'Cruce masivo de RUTs entre F30 y planilla Excel.' },
    { id: 'plataforma_falabella', title: 'Dia 14 Falabella', icon: <UsersIcon className="text-green-600" />, desc: 'Cruce de activos en plataforma vs planilla de cobros.' },
    { id: 'smart_autofill', title: 'Auto-llenado Inteligente', icon: <Sparkles className="text-amber-500" />, desc: 'Extracción de datos con IA para formularios web.' },
    { id: 'formalizar_servicio', title: 'Formalizar Servicio', icon: <ClipboardList className="text-rose-500" />, desc: 'Generar tabla de requerimiento de servicio Falabella.' },
    { id: 'extractor_galileo', title: 'Extractor de Turnos Galileo', icon: <TableIcon className="text-blue-600" />, desc: 'Extrae datos de notificaciones Galileo para planilla de cobros.' },
    { id: 'nomina_anticipos', title: 'Nómina Anticipos', icon: <Banknote className="text-amber-600" />, desc: 'Ingreso masivo de anticipos por sucursal para el día 15.', hidden: currentUser && currentUser.role === 'worker' },
    { id: 'supervision_sucursal', title: 'Supervisión de Sucursal', icon: <Building2 className="text-indigo-600" />, desc: 'Checklists de supervisión asignados por administración.', hidden: currentUser && currentUser.role === 'worker' },
    { id: 'informar_renuncia', title: 'Informar Renuncia', icon: <X className="text-rose-600" />, desc: 'Reportar renuncia de un trabajador con documentos adjuntos.', hidden: currentUser && currentUser.role === 'worker' },
    { id: 'responder_solicitud', title: 'Responder Solicitud', icon: <Send className="text-slate-300" />, desc: 'Próximamente...', disabled: true },
    { id: 'tarea_4', title: 'Bitácora Diaria', icon: <Clock className="text-slate-300" />, desc: 'Próximamente...', disabled: true },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tareas Recurrentes</h1>
        <p className="text-slate-500">Automatización de procesos administrativos críticos</p>
      </div>

      {!activeTask ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {tasks.filter(t => {
            if (currentUser?.role === 'supervisor') {
              return t.id === 'nomina_anticipos' || t.id === 'supervision_sucursal' || t.id === 'informar_renuncia';
            }
            return !(t as any).hidden;
          }).map((task) => (
            <button
              key={task.id}
              disabled={task.disabled}
              onClick={() => setActiveTask(task.id as any)}
              className={`p-6 bg-white rounded-xl border border-slate-100 shadow-sm text-left transition-all group ${task.disabled ? 'opacity-60 grayscale cursor-not-allowed' : 'hover:shadow-md hover:border-blue-200 active:scale-[0.98]'}`}
            >
              <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mb-4 group-hover:bg-blue-50 transition-colors">
                {task.icon}
              </div>
              <h3 className="font-bold text-slate-800 mb-1">{task.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{task.desc}</p>
            </button>
          ))}
        </div>
      ) : activeTask === 'smart_autofill' ? (
        <SmartAutofill onBack={() => setActiveTask(null)} />
      ) : activeTask === 'nomina_anticipos' ? (
        <AdvancePayroll onBack={() => setActiveTask(null)} />
      ) : activeTask === 'extractor_galileo' ? (
        <GalileoExtractor onBack={() => setActiveTask(null)} />
      ) : activeTask === 'supervision_sucursal' ? (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6 pb-24">
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setActiveTask(null); setSelectedSupervisionId(null); }}
              className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl font-bold text-slate-800">Supervisión de Sucursal</h2>
          </div>

          {!selectedSupervisionId ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {supervisorTasks
                .filter(t => t.supervisorId === currentUser?.uid && t.status === 'PENDING')
                .map(task => (
                  <button
                    key={task.id}
                    onClick={() => setSelectedSupervisionId(task.id)}
                    className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-left hover:border-blue-300 transition group flex flex-col"
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center mb-4 group-hover:bg-indigo-100 transition-colors">
                      <Building2 className="text-indigo-600" size={20} />
                    </div>
                    <h3 className="font-bold text-slate-800 mb-1">{task.checklistType}</h3>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
                      <MapPin size={12} /> {task.siteName}
                    </div>
                    <div className="mt-auto pt-3 border-t border-slate-50 flex items-center justify-between text-indigo-600 font-bold text-xs uppercase tracking-widest">
                      Comenzar Revisión <ChevronRight size={14} />
                    </div>
                  </button>
                ))
              }
              {supervisorTasks.filter(t => t.supervisorId === currentUser?.uid && t.status === 'PENDING').length === 0 && (
                <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl">
                  <CheckCircle size={48} className="mb-2" />
                  <p className="text-sm font-bold uppercase">No tienes revisiones pendientes</p>
                </div>
              )}
            </div>
          ) : currentSupervisionTask && (
            <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
              <div className="p-8 border-b border-slate-100 bg-slate-50 flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">{currentSupervisionTask.checklistType}</h3>
                  <p className="text-slate-500 font-medium flex items-center gap-2 mt-1">
                    <MapPin size={14} className="text-blue-500" /> {currentSupervisionTask.siteName}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedSupervisionId(null)}
                  className="p-2 hover:bg-white rounded-xl transition"
                >
                  <X size={20} className="text-slate-400" />
                </button>
              </div>

              <div className="p-8 space-y-8">
                {currentSupervisionTask.items.map((item, idx) => (
                  <div key={item.id} className="space-y-4">
                    <div className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-400">
                        {idx + 1}
                      </span>
                      <p className="text-slate-700 font-semibold pt-1">{item.question}</p>
                    </div>

                    <div className="ml-12 flex gap-3">
                      <button
                        onClick={() => {
                          const newItems = [...currentSupervisionTask.items];
                          newItems[idx].value = true;
                          updateSupervisorTask(currentSupervisionTask.id, { items: newItems });
                        }}
                        className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${item.value === true ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-100' : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-200 hover:text-emerald-500'}`}
                      >
                        SÍ
                      </button>
                      <button
                        onClick={() => {
                          const newItems = [...currentSupervisionTask.items];
                          newItems[idx].value = false;
                          updateSupervisorTask(currentSupervisionTask.id, { items: newItems });
                        }}
                        className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${item.value === false ? 'bg-rose-600 text-white border-rose-600 shadow-lg shadow-rose-100' : 'bg-white text-slate-400 border-slate-200 hover:border-rose-200 hover:text-rose-500'}`}
                      >
                        NO
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-8 border-t border-slate-100 space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Observaciones Generales (Opcional)</label>
                  <textarea
                    placeholder="Escriba detalles relevantes observados en la supervisión..."
                    className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-50 transition-all text-sm"
                    value={currentSupervisionTask.observations || ''}
                    onChange={(e) => updateSupervisorTask(currentSupervisionTask.id, { observations: e.target.value })}
                  />
                </div>

                <div className="pt-4">
                  <button
                    disabled={currentSupervisionTask.items.some(i => i.value === null)}
                    onClick={async () => {
                      await updateSupervisorTask(currentSupervisionTask.id, {
                        status: 'COMPLETED',
                        completedAt: new Date().toISOString()
                      });
                      showNotification("Supervisión finalizada correctamente", "success");
                      setSelectedSupervisionId(null);
                    }}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:grayscale text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-100 transition-all active:scale-[0.98]"
                  >
                    Finalizar Supervisión
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : activeTask === 'informar_renuncia' ? (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6 pb-24 max-w-2xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveTask(null)}
              className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl font-bold text-slate-800">Informar Renuncia</h2>
          </div>

          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
            <div className="space-y-4">
              {/* Buscador de Colaborador */}
              <div className="relative" ref={resignationWorkerRef}>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Colaborador</label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 text-slate-400" size={18} />
                  <input
                    type="text"
                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Buscar por nombre o RUT..."
                    value={resignationWorkerSearch}
                    onChange={(e) => {
                      setResignationWorkerSearch(e.target.value);
                      setShowResignationWorkerList(true);
                      setResignationData(prev => ({ ...prev, workerId: '' }));
                    }}
                    onFocus={() => setShowResignationWorkerList(true)}
                  />
                </div>
                {showResignationWorkerList && resignationWorkerSearch && (
                  <div className="absolute z-10 w-full bg-white border border-slate-200 mt-1 rounded-xl shadow-2xl max-h-60 overflow-auto">
                    {employees.filter(e => e.isActive && (e.firstName.toLowerCase().includes(resignationWorkerSearch.toLowerCase()) || e.rut.includes(resignationWorkerSearch))).map(emp => (
                      <div
                        key={emp.id}
                        className="p-3 hover:bg-blue-50 cursor-pointer border-b border-slate-50 transition"
                        onClick={() => {
                          setResignationData(prev => ({ ...prev, workerId: emp.id }));
                          setResignationWorkerSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                          setShowResignationWorkerList(false);
                        }}
                      >
                        <div className="font-bold text-slate-800">{emp.firstName} {emp.lastNamePaterno}</div>
                        <div className="text-xs text-slate-400">{emp.rut}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Fecha de Renuncia</label>
                  <input
                    type="date"
                    className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    value={resignationData.resignationDate}
                    onChange={(e) => setResignationData(prev => ({ ...prev, resignationDate: e.target.value }))}
                  />
                  <p className="text-[10px] text-slate-400 italic">Fecha en que presenta el documento</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Último Día / Fecha Motivo</label>
                  <input
                    type="date"
                    className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    value={resignationData.effectiveDate}
                    onChange={(e) => setResignationData(prev => ({ ...prev, effectiveDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Motivo</label>
                <select
                  className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  value={resignationData.reason}
                  onChange={(e) => setResignationData(prev => ({ ...prev, reason: e.target.value }))}
                >
                  <option value="">Seleccionar motivo...</option>
                  <option value="Voluntaria">Voluntaria</option>
                  <option value="Falta de Probidad">Falta de Probidad</option>
                  <option value="Abandono de Trabajo">Abandono de Trabajo</option>
                  <option value="Termino de Contrato">Término de Contrato</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Observaciones (Opcional)</label>
                <textarea
                  className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                  placeholder="Detalles adicionales sobre la renuncia..."
                  value={resignationData.observations}
                  onChange={(e) => setResignationData(prev => ({ ...prev, observations: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Documentos / Fotos Capta</label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition cursor-pointer">
                    <Camera className="text-slate-400 mb-2" size={24} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Subir Foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files) {
                          Array.from(files).forEach(file => {
                            const reader = new FileReader();
                            reader.onload = () => {
                              setResignationAttachments(prev => [...prev, reader.result as string]);
                            };
                            reader.readAsDataURL(file);
                          });
                        }
                      }}
                    />
                  </label>
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition cursor-pointer">
                    <FileText className="text-slate-400 mb-2" size={24} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Subir Documento</span>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files) {
                          Array.from(files).forEach(file => {
                            const reader = new FileReader();
                            reader.onload = () => {
                              setResignationAttachments(prev => [...prev, reader.result as string]);
                            };
                            reader.readAsDataURL(file);
                          });
                        }
                      }}
                    />
                  </label>
                </div>

                {resignationAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {resignationAttachments.map((att, idx) => (
                      <div key={idx} className="relative group">
                        {att.startsWith('data:image') ? (
                          <img src={att} className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center border border-slate-200">
                            <FileText size={20} className="text-slate-400" />
                          </div>
                        )}
                        <button
                          onClick={() => setResignationAttachments(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={async () => {
                if (!resignationData.workerId || !resignationData.reason) {
                  showNotification("Complete colaborador y motivo", "warning");
                  return;
                }
                const worker = employees.find(e => e.id === resignationData.workerId);
                await addResignationRequest({
                  ...resignationData,
                  workerName: worker ? `${worker.firstName} ${worker.lastNamePaterno}` : 'Desconocido',
                  attachments: resignationAttachments,
                  supervisorId: currentUser?.uid || 'unknown',
                  supervisorName: currentUser?.email?.split('@')[0] || 'Supervisor'
                });
                showNotification("Aviso de renuncia enviado correctamente", "success");
                setActiveTask(null);
                setResignationData({
                  workerId: '',
                  resignationDate: new Date().toISOString().slice(0, 10),
                  effectiveDate: new Date().toISOString().slice(0, 10),
                  reason: '',
                  observations: ''
                });
                setResignationAttachments([]);
                setResignationWorkerSearch('');
              }}
              className="w-full py-4 bg-slate-900 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl hover:bg-black transition-transform active:scale-95 flex items-center justify-center gap-2"
            >
              <Send size={18} /> Enviar Aviso de Renuncia
            </button>
          </div>
        </div>
      ) : activeTask === 'formalizar_servicio' ? (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setActiveTask(null)}
                className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-xl font-bold text-slate-800">Formalizar Servicio Falabella</h2>
            </div>
            {formalizarRows.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFormalizarRows([])}
                  className="px-4 py-2 border border-slate-200 text-slate-500 rounded-lg font-bold text-sm hover:bg-slate-50 transition"
                >
                  Limpiar Lista
                </button>
                <button
                  onClick={async () => {
                    const header = ["Supervisor", "Fecha de solicitud de servicio", "Proveedor", "Motivo Solicitud", "Sucursal", "Dirección Sucursal", "Cant. Días", "Fecha Inicio servicio", "Fecha Termino Servicio", "Hora Inicio servicio", "Hora Termino Servicio", "Rut Guardia Seguridad", "Nombre de Guardia", "Fecha de Nacimiento", "Sexo", "Teléfono"];

                    const rowsHtml = formalizarRows.map(row => `
                      <tr style="height: auto;">
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; white-space: nowrap;">${row.supervisor}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaSolicitud}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; white-space: nowrap;">${row.proveedor}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle;">${row.motivo}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; white-space: nowrap;">${row.sucursal}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; line-height: 1.1;">${row.direccion}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle;"></td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaInicio}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaTermino}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.horaInicio}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.horaTermino}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.rut}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; font-weight: bold; white-space: nowrap;">${row.nombre}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaNacimiento}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.sexo}</td>
                        <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.telefono}</td>
                      </tr>
                    `).join('');

                    const tableHtml = `
                      <table border="1" style="border-collapse: collapse; font-family: Calibri, sans-serif; font-size: 10pt; width: max-content; line-height: 1.1;">
                        <tr style="background-color: #92d050; text-align: left;">
                          ${header.map(h => {
                      let style = "padding: 2px 4px; border: 1px solid #000; font-weight: bold; text-decoration: underline; vertical-align: middle; white-space: nowrap;";
                      if (h === "Dirección Sucursal") style = style.replace('white-space: nowrap;', '') + " width: 250pt;";
                      else if (h === "Nombre de Guardia") style += " width: 110pt;";
                      return `<th style="${style}">${h}</th>`;
                    }).join('')}
                        </tr>
                        ${rowsHtml}
                      </table>
                    `;

                    const plainText = header.join('\t') + '\n' +
                      formalizarRows.map(row => [
                        row.supervisor, row.fechaSolicitud, row.proveedor, row.motivo, row.sucursal, row.direccion, "",
                        row.fechaInicio, row.fechaTermino, row.horaInicio, row.horaTermino, row.rut, row.nombre,
                        row.fechaNacimiento, row.sexo, row.telefono
                      ].join('\t')).join('\n');

                    try {
                      const blobHtml = new Blob([tableHtml], { type: 'text/html' });
                      const blobText = new Blob([plainText], { type: 'text/plain' });
                      const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
                      await navigator.clipboard.write(data);
                      showNotification(`¡Copiadas ${formalizarRows.length} filas al portapapeles!`, "success");
                    } catch (err) {
                      navigator.clipboard.writeText(plainText);
                      showNotification("Copiado como texto plano.", "info");
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 transition shadow-lg shadow-blue-100"
                >
                  <Copy size={16} /> Copiar {formalizarRows.length} {formalizarRows.length === 1 ? 'Fila' : 'Filas'} para Excel
                </button>
              </div>
            )}
          </div>

          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">

              {/* Supervisor y Proveedor */}
              <div className="space-y-4">
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Supervisor</label>
                  <select
                    className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={formalizarData.supervisor}
                    onChange={(e) => setFormalizarData({ ...formalizarData, supervisor: e.target.value })}
                  >
                    <option value="Andres Castro">Andres Castro</option>
                    <option value="Patricia Yevenes">Patricia Yevenes</option>
                  </select>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Proveedor</label>
                  <input
                    type="text"
                    readOnly
                    className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 bg-slate-100 text-slate-500 rounded-t-lg outline-none"
                    value={formalizarData.proveedor}
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Motivo Solicitud</label>
                  <input
                    type="text"
                    placeholder="Ej: Refuerzo por evento"
                    className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={formalizarData.motivo}
                    onChange={(e) => setFormalizarData({ ...formalizarData, motivo: e.target.value })}
                  />
                </div>
              </div>

              {/* Sucursal y Horarios */}
              <div className="space-y-4">
                <div className="flex flex-col space-y-1 relative" ref={formalizarSiteRef}>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sucursal (Falabella)</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Buscar sucursal..."
                      className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                      value={formalizarSiteSearch}
                      onFocus={() => {
                        setFormalizarSiteSearch('');
                        setShowFormalizarSiteList(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          if (!formalizarSiteSearch && formalizarData.sucursalId) {
                            const s = sites.find(site => String(site.id) === formalizarData.sucursalId);
                            if (s) setFormalizarSiteSearch(s.name);
                          }
                          setShowFormalizarSiteList(false);
                        }, 200);
                      }}
                      onChange={(e) => { setFormalizarSiteSearch(e.target.value); setShowFormalizarSiteList(true); }}
                    />
                  </div>
                  {showFormalizarSiteList && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                      {filteredFormalizarSites.map(s => (
                        <div
                          key={s.id}
                          className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                          onClick={() => {
                            setFormalizarData({ ...formalizarData, sucursalId: String(s.id) });
                            setFormalizarSiteSearch(s.name);
                            setShowFormalizarSiteList(false);
                          }}
                        >
                          <div className="text-sm font-bold text-slate-700">{s.name}</div>
                          <div className="text-[10px] text-slate-400">{s.address}</div>
                        </div>
                      ))}
                      {filteredFormalizarSites.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No hay sucursales Falabella</div>}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hora Inicio</label>
                    <input
                      type="time"
                      className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                      value={formalizarData.horaInicio}
                      onChange={(e) => setFormalizarData({ ...formalizarData, horaInicio: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hora Término</label>
                    <input
                      type="time"
                      className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                      value={formalizarData.horaTermino}
                      onChange={(e) => setFormalizarData({ ...formalizarData, horaTermino: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Inicio</label>
                    <input
                      type="date"
                      className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                      value={formalizarData.fechaInicio}
                      onChange={(e) => setFormalizarData({ ...formalizarData, fechaInicio: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Término</label>
                    <input
                      type="date"
                      className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                      value={formalizarData.fechaTermino}
                      onChange={(e) => setFormalizarData({ ...formalizarData, fechaTermino: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Colaborador */}
              <div className="space-y-4">
                <div className="flex flex-col space-y-1 relative" ref={formalizarEmpRef}>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nombre Guardia</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Filtrar por nombre o RUT..."
                      className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                      value={formalizarEmpSearch}
                      onFocus={() => {
                        setFormalizarEmpSearch('');
                        setShowFormalizarEmpList(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          if (!formalizarEmpSearch && formalizarData.empleadoId) {
                            const emp = employees.find(e => String(e.id) === formalizarData.empleadoId);
                            if (emp) setFormalizarEmpSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                          }
                          setShowFormalizarEmpList(false);
                        }, 200);
                      }}
                      onChange={(e) => { setFormalizarEmpSearch(e.target.value); setShowFormalizarEmpList(true); }}
                    />
                  </div>
                  {showFormalizarEmpList && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                      {filteredFormalizarEmp.map(e => (
                        <div
                          key={e.id}
                          className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                          onClick={() => {
                            setFormalizarData({ ...formalizarData, empleadoId: String(e.id) });
                            setFormalizarEmpSearch(`${e.firstName} ${e.lastNamePaterno}`);
                            setShowFormalizarEmpList(false);
                          }}
                        >
                          <div className="text-sm font-bold text-slate-700">{e.firstName} {e.lastNamePaterno}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {formalizarEmp && (
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-2">
                    <p className="text-[10px] font-black text-blue-800 uppercase tracking-widest border-b border-blue-100 pb-1 mb-2">Datos Automáticos</p>
                    <div className="grid grid-cols-2 gap-y-2 text-[11px]">
                      <div><span className="text-slate-500">RUT:</span> <span className="font-bold">{formalizarEmp.rut}</span></div>
                      <div><span className="text-slate-500">Sexo:</span> <span className="font-bold">{formalizarEmp.sexo || 'N/R'}</span></div>
                      <div><span className="text-slate-500">Nacimiento:</span> <span className="font-bold">{formalizarEmp.fechaNacimiento || 'N/R'}</span></div>
                      <div><span className="text-slate-500">Teléfono:</span> <span className="font-bold">{formalizarEmp.phone || 'N/R'}</span></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-center pt-4 border-t border-slate-100">
              <button
                disabled={!formalizarEmp || !formalizarSite || !formalizarData.fechaInicio}
                onClick={() => {
                  if (!formalizarEmp || !formalizarSite) return;
                  const newRow = {
                    id: Date.now(),
                    supervisor: formalizarData.supervisor,
                    fechaSolicitud: new Date().toLocaleDateString('es-CL'),
                    proveedor: formalizarData.proveedor,
                    motivo: formalizarData.motivo,
                    sucursal: formalizarSite.name,
                    direccion: formalizarSite.address,
                    fechaInicio: formalizarData.fechaInicio,
                    fechaTermino: formalizarData.fechaTermino,
                    horaInicio: formalizarData.horaInicio,
                    horaTermino: formalizarData.horaTermino,
                    rut: formalizarEmp.rut,
                    nombre: `${formalizarEmp.firstName} ${formalizarEmp.lastNamePaterno} ${formalizarEmp.lastNameMaterno || ''}`.trim(),
                    fechaNacimiento: formalizarEmp.fechaNacimiento || '',
                    sexo: formalizarEmp.sexo || '',
                    telefono: formalizarEmp.phone || ''
                  };
                  setFormalizarRows([...formalizarRows, newRow]);
                  // Limpiar solo los campos variables
                  setFormalizarData({
                    ...formalizarData,
                    motivo: '',
                    empleadoId: ''
                  });
                  setFormalizarEmpSearch('');
                  showNotification("Fila agregada a la lista", "success");
                }}
                className="flex items-center gap-2 px-12 py-3 bg-emerald-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-emerald-700 transition shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:grayscale"
              >
                <TableIcon size={18} /> Agregar Fila a la Lista
              </button>
            </div>

            {/* Vista Previa de la Tabla */}
            {formalizarRows.length > 0 && (
              <div className="space-y-4 pt-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Lista de Servicios a Formalizar ({formalizarRows.length})</h3>
                </div>
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-left text-[10px]">
                    <thead className="bg-slate-50 text-slate-500 font-bold">
                      <tr>
                        <th className="px-3 py-2 border-r border-slate-100">Supervisor</th>
                        <th className="px-3 py-2 border-r border-slate-100">Motivo</th>
                        <th className="px-3 py-2 border-r border-slate-100">Sucursal</th>
                        <th className="px-3 py-2 border-r border-slate-100">Inicio</th>
                        <th className="px-3 py-2 border-r border-slate-100">Fin</th>
                        <th className="px-3 py-2 border-r border-slate-100">Horario</th>
                        <th className="px-3 py-2 border-r border-slate-100">RUT</th>
                        <th className="px-3 py-2 border-r border-slate-100">Nombre</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {formalizarRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2 border-r border-slate-100">{row.supervisor}</td>
                          <td className="px-3 py-2 border-r border-slate-100">{row.motivo}</td>
                          <td className="px-3 py-2 border-r border-slate-100 text-blue-600 font-bold">{row.sucursal}</td>
                          <td className="px-3 py-2 border-r border-slate-100">{row.fechaInicio}</td>
                          <td className="px-3 py-2 border-r border-slate-100">{row.fechaTermino}</td>
                          <td className="px-3 py-2 border-r border-slate-100">{row.horaInicio} - {row.horaTermino}</td>
                          <td className="px-3 py-2 border-r border-slate-100 font-mono">{row.rut}</td>
                          <td className="px-3 py-2 border-r border-slate-100 font-bold">{row.nombre}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => setFormalizarRows(formalizarRows.filter(r => r.id !== row.id))}
                              className="text-red-400 hover:text-red-600 p-1"
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : activeTask === 'generar_contrato' ? (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
            <button
              onClick={() => setActiveTask(null)}
              className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl font-bold text-slate-800">Tarea: Generar Contrato</h2>
          </div>

          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">

              {/* BUSQUEDA COLABORADOR */}
              <div className="flex flex-col space-y-1 relative" ref={contratoEmpRef} style={{ zIndex: showContratoEmpList ? 100 : 1 }}>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex justify-between items-center">
                  Colaborador
                  <button
                    onClick={() => setShowInactiveContrato(!showInactiveContrato)}
                    className={`text-[9px] px-1.5 py-0.5 rounded transition ${showInactiveContrato ? 'bg-violet-100 text-violet-700 font-bold' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {showInactiveContrato ? 'Viendo Todos' : 'Viendo Activos'}
                  </button>
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="text"
                    placeholder="Buscar por nombre o RUT..."
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                    value={contratoEmpSearch}
                    onFocus={() => {
                      setContratoEmpSearch('');
                      setShowContratoEmpList(true);
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        if (!contratoEmpSearch && contratoData.empleadoId) {
                          const emp = employees.find(e => String(e.id) === contratoData.empleadoId);
                          if (emp) setContratoEmpSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                        }
                        setShowContratoEmpList(false);
                      }, 200);
                    }}
                    onClick={() => { setShowContratoEmpList(true); setContratoEmpSearch(''); }}
                    onChange={(e) => { setContratoEmpSearch(e.target.value); setShowContratoEmpList(true); }}
                  />
                </div>
                {showContratoEmpList && (
                  <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                    {filteredContratoEmp.map(e => (
                      <div
                        key={e.id}
                        className="px-4 py-2 hover:bg-violet-50 cursor-pointer border-b border-slate-50"
                        onClick={() => {
                          setContratoData({ ...contratoData, empleadoId: String(e.id), sueldo: String(e.sueldoLiquido || '') });
                          setContratoEmpSearch(`${e.firstName} ${e.lastNamePaterno}`);
                          setShowContratoEmpList(false);
                        }}
                      >
                        <div className="text-sm font-bold text-slate-700">
                          {e.firstName} {e.lastNamePaterno}
                          {!e.isActive && <span className="ml-2 text-[9px] text-rose-500 uppercase font-black">Inactivo</span>}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                      </div>
                    ))}
                    {filteredContratoEmp.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                  </div>
                )}
              </div>

              {/* BUSQUEDA SUCURSAL */}
              <div className="flex flex-col space-y-1 relative" ref={contratoSiteRef} style={{ zIndex: showContratoSiteList ? 100 : 1 }}>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sucursal / Instalación</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="text"
                    placeholder="Buscar sucursal..."
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                    value={contratoSiteSearch}
                    onFocus={() => {
                      setContratoSiteSearch('');
                      setShowContratoSiteList(true);
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        if (!contratoSiteSearch && contratoData.sucursalId) {
                          const s = sites.find(site => String(site.id) === contratoData.sucursalId);
                          if (s) setContratoSiteSearch(s.name);
                        }
                        setShowContratoSiteList(false);
                      }, 200);
                    }}
                    onClick={() => { setShowContratoSiteList(true); setContratoSiteSearch(''); }}
                    onChange={(e) => { setContratoSiteSearch(e.target.value); setShowContratoSiteList(true); }}
                  />
                </div>
                {showContratoSiteList && (
                  <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                    {filteredContratoSites.map(s => (
                      <div
                        key={s.id}
                        className="px-4 py-2 hover:bg-violet-50 cursor-pointer text-sm border-b border-slate-50 font-medium text-slate-700"
                        onClick={() => {
                          setContratoData({ ...contratoData, sucursalId: String(s.id) });
                          setContratoSiteSearch(s.name);
                          setShowContratoSiteList(false);
                        }}
                      >
                        {s.name}
                      </div>
                    ))}
                    {filteredContratoSites.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                  </div>
                )}
              </div>

              {/* TIPO CONTRATO */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Contrato</label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <select
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors appearance-none"
                    value={contratoData.tipoContrato}
                    onChange={(e) => setContratoData({ ...contratoData, tipoContrato: e.target.value })}
                  >
                    <option value="Falabella Part-Time">Falabella Part-Time</option>
                  </select>
                </div>
              </div>

              {/* FECHAS */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Inicio</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="date"
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={contratoData.fechaInicio}
                    onChange={(e) => setContratoData({ ...contratoData, fechaInicio: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Término (Opcional)</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="date"
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={contratoData.fechaTermino}
                    onChange={(e) => setContratoData({ ...contratoData, fechaTermino: e.target.value })}
                  />
                </div>
              </div>

              {/* SUELDO */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sueldo Líquido</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="number"
                    placeholder="Monto líquido..."
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={contratoData.sueldo}
                    onChange={(e) => setContratoData({ ...contratoData, sueldo: e.target.value })}
                  />
                </div>
              </div>

              {/* HORARIOS */}
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Horario A (Diurno)</label>
                <div className="relative">
                  <Clock className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="text"
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={contratoData.horarioA}
                    onChange={(e) => setContratoData({ ...contratoData, horarioA: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Horario B (Nocturno)</label>
                <div className="relative">
                  <Clock className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="text"
                    className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={contratoData.horarioB}
                    onChange={(e) => setContratoData({ ...contratoData, horarioB: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                disabled={isProcessing}
                onClick={handleGenerateContract}
                className="flex items-center gap-3 px-12 py-4 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-black uppercase tracking-widest text-sm transition shadow-xl shadow-violet-100 disabled:opacity-50 active:scale-95"
              >
                {isProcessing ? <Loader2 className="animate-spin" /> : <Send size={18} />}
                {isProcessing ? 'Enviando...' : 'Generar y Enviar Contrato'}
              </button>
            </div>
          </div>

          {/* HISTORIAL DE CONTRATOS */}
          <div className="space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
              <History className="text-slate-400" />
              <h2 className="text-xl font-bold text-slate-800">Últimos Contratos Generados (Máx 15)</h2>
            </div>

            {contractHistory.length === 0 ? (
              <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                <FileText size={48} className="text-slate-200 mx-auto mb-4" />
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Aún no hay contratos registrados</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {contractHistory.map((record) => (
                  <div
                    key={record.id}
                    className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm hover:border-violet-300 transition-all group flex flex-col"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="p-2 bg-violet-50 rounded-lg group-hover:bg-violet-100 transition-colors">
                        <FileText size={20} className="text-violet-600" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full uppercase">ID #{record.id.toString().slice(-4)}</span>
                    </div>

                    <h4 className="font-bold text-slate-800 mb-1 line-clamp-1">{record.workerName}</h4>
                    <p className="text-xs text-slate-500 font-medium mb-4 flex items-center gap-1">
                      <MapPin size={12} className="text-slate-400" /> {record.siteName}
                    </p>

                    <div className="space-y-2 mt-auto">
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                        <Calendar size={12} className="text-slate-400" />
                        {new Date(record.timestamp).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>

                    <a
                      href={record.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-violet-600 font-bold text-xs uppercase tracking-widest hover:text-violet-800 transition-colors"
                    >
                      Descargar PDF <ChevronRight size={14} />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : activeTask === 'plataforma_falabella' ? (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
            <button
              onClick={() => setActiveTask(null)}
              className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl font-bold text-slate-800">Dia 14 Falabella</h2>
          </div>

          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

              {/* DROPZONE ACTIVOS */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-black text-slate-700 uppercase tracking-widest">1. Lista de Activos en plataforma</label>
                  <span className="text-[10px] text-slate-400 font-bold">A, B (RUT) + C (Nombre)</span>
                </div>
                <div
                  className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all group ${falabellaFiles.active ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'}`}
                >
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    onChange={(e) => handleFalabellaFileChange('active', e)}
                  />
                  <div className="flex flex-col items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${falabellaFiles.active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-500'}`}>
                      <Upload size={24} />
                    </div>
                    {falabellaFiles.active ? (
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-emerald-700 line-clamp-1">{falabellaFiles.active.name}</p>
                        <p className="text-[10px] text-emerald-500 font-medium">Archivo listo para procesar</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-slate-600">Suelte la lista de activos en plataforma</p>
                        <p className="text-xs text-slate-400">Formato .xlsx o .xls</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* DROPZONE PLATAFORMA */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-black text-slate-700 uppercase tracking-widest">2. nombres Planilla cobros</label>
                  <span className="text-[10px] text-slate-400 font-bold">A (RUT) + B (Nombre)</span>
                </div>
                <div
                  className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all group ${falabellaFiles.platform ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'}`}
                >
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    onChange={(e) => handleFalabellaFileChange('platform', e)}
                  />
                  <div className="flex flex-col items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${falabellaFiles.platform ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-500'}`}>
                      <Upload size={24} />
                    </div>
                    {falabellaFiles.platform ? (
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-emerald-700 line-clamp-1">{falabellaFiles.platform.name}</p>
                        <p className="text-[10px] text-emerald-500 font-medium">Archivo listo para procesar</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-slate-600">Suelte nombres Planilla cobros</p>
                        <p className="text-xs text-slate-400">Formato .xlsx o .xls</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4 pt-4">
              <button
                onClick={processFalabellaComparison}
                disabled={isProcessing || !falabellaFiles.active || !falabellaFiles.platform}
                className="flex items-center gap-4 px-16 py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-xl disabled:opacity-30 disabled:cursor-not-allowed group"
              >
                {isProcessing ? <Loader2 className="animate-spin" /> : <Sparkles className="group-hover:rotate-12 transition-transform" size={20} />}
                {isProcessing ? 'Procesando Datos...' : 'Iniciar Cruce Inteligente'}
              </button>

              {falabellaResults && (
                <button
                  onClick={exportFalabellaToExcel}
                  className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest hover:text-emerald-700 transition-colors"
                >
                  <FileText size={16} /> Exportar Resultado a Excel
                </button>
              )}
            </div>
          </div>

          {/* RESULTADOS */}
          {falabellaResults && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* 1. COINCIDENCIAS */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px] animate-in fade-in slide-in-from-bottom-2">
                <div className="bg-emerald-500 p-4 border-b border-emerald-600">
                  <div className="flex justify-between items-center text-white">
                    <h3 className="font-black uppercase tracking-widest text-xs flex items-center gap-2">
                      <CheckCircle size={16} /> Coincidencias ({falabellaResults.matches.length})
                    </h3>
                  </div>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0 z-20">
                      <tr>
                        <th className="p-3 text-left text-slate-500 font-bold uppercase tracking-wider">Colaborador</th>
                        <th className="p-3 text-right text-slate-500 font-bold uppercase tracking-wider">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {falabellaResults.matches.map((m, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3">
                            <div className="font-bold text-slate-800">{m.name}</div>
                            <div className="font-mono text-[10px] text-slate-400">{m.rut}</div>
                          </td>
                          <td className="p-3 text-right">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${m.matchType === 'RUT' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                              {m.matchType}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 2. SOLO EN ACTIVOS */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px] animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-rose-500 p-4 border-b border-rose-600">
                  <h3 className="text-white font-black uppercase tracking-widest text-xs flex items-center gap-2">
                    <UserPlus size={16} /> Solo en Activos ({falabellaResults.onlyActive.length})
                  </h3>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0 z-20">
                      <tr>
                        <th className="p-3 text-left text-slate-500 font-bold uppercase tracking-wider">Desactivar de plataforma</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {falabellaResults.onlyActive.map((m, i) => (
                        <tr key={i} className="hover:bg-rose-50/30 transition-colors">
                          <td className="p-3">
                            <div className="font-bold text-slate-800">{m.name}</div>
                            <div className="font-mono text-[10px] text-slate-400">{m.rut}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. SOLO EN FALABELLA */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px] animate-in fade-in slide-in-from-bottom-6">
                <div className="bg-blue-500 p-4 border-b border-blue-600">
                  <h3 className="font-black uppercase tracking-widest text-xs flex items-center gap-2">
                    <FileText size={16} /> Solo en Planilla ({falabellaResults.onlyPlatform.length})
                  </h3>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0 z-20">
                      <tr>
                        <th className="p-3 text-left text-slate-500 font-bold uppercase tracking-wider">Activar o Agregar en Plataforma</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {falabellaResults.onlyPlatform.map((m, i) => (
                        <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                          <td className="p-3">
                            <div className="font-bold text-slate-800">{m.name}</div>
                            <div className="font-mono text-[10px] text-slate-400">{m.rut}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* 4. REVISIÓN MANUAL */}
          {falabellaResults && falabellaResults.manualReview.length > 0 && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl overflow-hidden shadow-xl">
                <div className="bg-amber-500 p-4 flex justify-between items-center text-white">
                  <h3 className="font-black uppercase tracking-widest text-xs flex items-center gap-2">
                    <Sparkles size={16} /> Revisión Manual ({falabellaResults.manualReview.length})
                  </h3>
                  <span className="text-[10px] font-bold bg-amber-600 px-2 py-1 rounded-lg">POSIBLES COINCIDENCIAS</span>
                </div>
                <div className="p-1">
                  <table className="w-full text-xs">
                    <thead className="bg-amber-100/50 text-amber-900 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3 text-left">Datos en Activos</th>
                        <th className="p-3 text-center">→</th>
                        <th className="p-3 text-left">Datos en Planilla</th>
                        <th className="p-3 text-right">Razón</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {falabellaResults.manualReview.map((item, i) => (
                        <tr key={i} className="hover:bg-white/50 transition-colors">
                          <td className="p-3">
                            <div className="font-bold text-slate-800">{item.active.name}</div>
                            <div className="font-mono text-[10px] text-slate-500">{item.active.rut}</div>
                          </td>
                          <td className="p-3 text-center text-amber-400 font-black">
                            <ChevronRight size={14} />
                          </td>
                          <td className="p-3 text-left">
                            <div className="font-bold text-slate-800">{item.platform.name}</div>
                            <div className="font-mono text-[10px] text-slate-500">{item.platform.rut}</div>
                          </td>
                          <td className="p-3 text-right">
                            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-md font-black text-[9px] uppercase">
                              {item.reason}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : activeTask === 'info_reemplazo' ? (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
            <button
              onClick={() => setActiveTask(null)}
              className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl font-bold text-slate-800">Generador: Info Reemplazo</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">Parámetros del Reemplazo</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* SUCURSAL */}
                <div className="flex flex-col space-y-1 relative" ref={siteRef} style={{ zIndex: showSiteList ? 100 : 1 }}>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sucursal / Instalación</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Buscar sucursal..."
                      className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                      value={siteSearch}
                      onFocus={() => {
                        setSiteSearch('');
                        setShowSiteList(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          if (!siteSearch && reemplazoData.sucursalId) {
                            const s = sites.find(site => String(site.id) === reemplazoData.sucursalId);
                            if (s) setSiteSearch(s.name);
                          }
                          setShowSiteList(false);
                        }, 200);
                      }}
                      onClick={() => { setShowSiteList(true); setSiteSearch(''); }}
                      onChange={(e) => { setSiteSearch(e.target.value); setShowSiteList(true); }}
                    />
                  </div>
                  {showSiteList && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                      {filteredSitesTasks.map(s => (
                        <div
                          key={s.id}
                          className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 font-medium text-slate-700"
                          onClick={() => {
                            setReemplazoData({ ...reemplazoData, sucursalId: String(s.id) });
                            setSiteSearch(s.name);
                            setShowSiteList(false);
                          }}
                        >
                          {s.name}
                        </div>
                      ))}
                      {filteredSitesTasks.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                    </div>
                  )}
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Calendar size={12} className="text-blue-500" /> Día del Reemplazo
                  </label>
                  <input
                    type="date"
                    className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2 text-sm outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                    value={reemplazoData.diaReemplazo}
                    onClick={(e) => {
                      try {
                        e.currentTarget.showPicker?.();
                      } catch (err) { }
                    }}
                    onChange={(e) => setReemplazoData({ ...reemplazoData, diaReemplazo: e.target.value })}
                  />
                </div>

                {/* COLABORADOR ACTUAL */}
                <div className="flex flex-col space-y-1 relative" ref={actualRef} style={{ zIndex: showActualList ? 100 : 1 }}>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Colaborador Actual (GG.SS)</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Buscar por nombre o RUT..."
                      className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                      value={actualSearch}
                      onFocus={() => {
                        setActualSearch('');
                        setShowActualList(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          if (!actualSearch && reemplazoData.empleadoActualId) {
                            const emp = employees.find(e => String(e.id) === reemplazoData.empleadoActualId);
                            if (emp) setActualSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                          }
                          setShowActualList(false);
                        }, 200);
                      }}
                      onClick={() => { setShowActualList(true); setActualSearch(''); }}
                      onChange={(e) => { setActualSearch(e.target.value); setShowActualList(true); }}
                    />
                  </div>
                  {showActualList && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                      {filteredActual.map(e => (
                        <div
                          key={e.id}
                          className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                          onClick={() => {
                            setReemplazoData({ ...reemplazoData, empleadoActualId: String(e.id) });
                            setActualSearch(`${e.firstName} ${e.lastNamePaterno}`);
                            setShowActualList(false);
                          }}
                        >
                          <div className="text-sm font-bold text-slate-700">{e.firstName} {e.lastNamePaterno}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                        </div>
                      ))}
                      {filteredActual.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                    </div>
                  )}
                </div>

                {/* COLABORADOR REEMPLAZO */}
                <div className="flex flex-col space-y-1 relative" ref={replacementRef} style={{ zIndex: showReplacementList ? 100 : 1 }}>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex justify-between items-center">
                    Colaborador Reemplazo
                    <button
                      onClick={() => setShowInactive(!showInactive)}
                      className={`text-[9px] px-1.5 py-0.5 rounded transition ${showInactive ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {showInactive ? 'Viendo Todos' : 'Viendo Activos'}
                    </button>
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                    <input
                      type="text"
                      placeholder="Buscar por nombre o RUT..."
                      className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                      value={replacementSearch}
                      onFocus={() => {
                        setReplacementSearch('');
                        setShowReplacementList(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          if (!replacementSearch && reemplazoData.empleadoReemplazoId) {
                            const emp = employees.find(e => String(e.id) === reemplazoData.empleadoReemplazoId);
                            if (emp) setReplacementSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                          }
                          setShowReplacementList(false);
                        }, 200);
                      }}
                      onClick={() => { setShowReplacementList(true); setReplacementSearch(''); }}
                      onChange={(e) => { setReplacementSearch(e.target.value); setShowReplacementList(true); }}
                    />
                  </div>
                  {showReplacementList && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                      {filteredReplacement.map(e => (
                        <div
                          key={e.id}
                          className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                          onClick={() => {
                            setReemplazoData({ ...reemplazoData, empleadoReemplazoId: String(e.id) });
                            setReplacementSearch(`${e.firstName} ${e.lastNamePaterno}`);
                            setShowReplacementList(false);
                          }}
                        >
                          <div className="text-sm font-bold text-slate-700">
                            {e.firstName} {e.lastNamePaterno}
                            {!e.isActive && <span className="ml-2 text-[9px] text-rose-500 uppercase font-black">Inactivo</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                        </div>
                      ))}
                      {filteredReplacement.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                    </div>
                  )}
                </div>

                <div className="flex flex-col space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Motivo del Reemplazo</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {['Mejora Servicio', 'Condiciones de salud', 'Motivos Personales', 'Licencia'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setReemplazoData({ ...reemplazoData, motivo: m })}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold border transition ${reemplazoData.motivo === m ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <input
                    placeholder="O escriba otro motivo..."
                    className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2.5 text-sm outline-none bg-slate-50 rounded-t-lg transition-colors"
                    value={reemplazoData.motivo}
                    onChange={(e) => setReemplazoData({ ...reemplazoData, motivo: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col space-y-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedReemplazoText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000)
                }}
                className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl font-black uppercase tracking-widest text-sm transition shadow-lg ${copied ? 'bg-green-600 text-white shadow-green-100 scale-[0.98]' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100 active:scale-95'}`}
              >
                {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                {copied ? '¡Texto Copiado!' : 'Copiar Texto para Solicitud'}
              </button>

              <div className="flex-1 bg-slate-900 text-blue-400 p-8 rounded-2xl font-mono text-xs whitespace-pre-wrap overflow-y-auto max-h-[500px] border border-slate-800 shadow-inner relative">
                <div className="absolute top-4 right-4 px-2 py-1 bg-slate-800 rounded text-[9px] font-bold text-slate-500 uppercase tracking-widest">Vista Previa</div>
                {generatedReemplazoText}
              </div>
            </div>
          </div>
        </div>
      ) : activeTask === 'comparar_f30' ? (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-12">
          {/* SECCION COMPARACION ACTUAL */}
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setActiveTask(null)}
                  className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
                >
                  <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-bold text-slate-800">Cruce F30-1 vs Planilla</h2>
              </div>
              {finalComparison.length > 0 && (
                <button onClick={() => { setFinalComparison([]); setF30FileBase64(null); setF30FileName(''); setRawPlanillaText(''); }} className="text-xs font-bold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 transition">Reiniciar Comparación</button>
              )}
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">1</div>
                <p className="text-xs text-blue-800 font-medium leading-relaxed">Subir Archivo <span className="font-bold">F30-1 (PDF)</span> para analizar los trabajadores registrados.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
                <p className="text-xs text-blue-800 font-medium leading-relaxed">Pegar <span className="font-bold">Listado de Planilla</span> (RUT y Nombre) desde Excel en el recuadro.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">3</div>
                <p className="text-xs text-blue-800 font-medium leading-relaxed">Generar <span className="font-bold">Entregable</span> para copiar como tabla a Excel.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Upload size={14} /> 1. Carga del F30-1
                  </h3>
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors group">
                    {f30FileName ? (
                      <div className="flex flex-col items-center">
                        <FileText className="text-emerald-500 mb-2" size={32} />
                        <span className="text-xs font-bold text-slate-700">{f30FileName}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <Upload className="text-slate-300 group-hover:text-blue-500 transition-colors mb-2" size={32} />
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Haz clic para subir PDF</span>
                      </div>
                    )}
                    <input type="file" className="hidden" accept=".pdf" onChange={handleF30Upload} />
                  </label>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <TableIcon size={14} /> 2. Pegar Planilla (Excel)
                  </h3>
                  <textarea
                    placeholder="Pegue aquí el listado de RUT y Nombres desde Excel..."
                    className="w-full h-48 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono focus:ring-2 focus:ring-blue-50 outline-none transition"
                    value={rawPlanillaText}
                    onChange={(e) => setRawPlanillaText(e.target.value)}
                  />
                </div>

                <button
                  disabled={isProcessing || !f30FileBase64 || !rawPlanillaText}
                  onClick={processF30Comparison}
                  className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest transition shadow-xl shadow-blue-100 disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {isProcessing ? <><Loader2 className="animate-spin" /> Procesando con IA...</> : "Ejecutar Comparación Masiva"}
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">3. Tabla de Resultados Actual</h3>
                </div>

                <div className="flex-1 overflow-auto max-h-[600px]">
                  {finalComparison.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-center space-y-4">
                      <FileSearch size={48} className="text-slate-200" />
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest max-w-[200px]">Los resultados aparecerán aquí tras ejecutar la comparación</p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 sticky top-0 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">RUT</th>
                          <th className="px-4 py-3">NOMBRE</th>
                          <th className="px-4 py-3 text-center">CONTRATO</th>
                          <th className="px-4 py-3 text-center">F-30 1</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {finalComparison.map((item, idx) => (
                          <tr key={idx} className="hover:bg-blue-50 transition-colors">
                            <td className="px-4 py-3 font-mono text-slate-500">{item.rut}</td>
                            <td className="px-4 py-3 font-bold text-slate-800">{item.name}</td>
                            <td className="px-4 py-3 text-center"></td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${item.inF30 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {item.inF30 ? 'SÍ' : 'NO'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {finalComparison.length > 0 && (
              <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="bg-white p-6 rounded-2xl border-2 border-blue-100 shadow-xl space-y-6">
                  <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex-1 space-y-2">
                      <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                        <ClipboardList className="text-blue-600" /> Entregable Final para Excel
                      </h3>
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block tracking-wider">Período de Informe</label>
                          <input
                            placeholder="Ej: FEBRERO 2025"
                            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-4 focus:ring-blue-50 outline-none transition-all font-bold"
                            value={periodo}
                            onChange={(e) => setPeriodo(e.target.value)}
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={() => copyAsExcelTable(finalComparison)}
                            className={`flex items-center gap-3 px-8 py-3 rounded-xl font-black uppercase text-sm tracking-widest transition transform active:scale-95 shadow-2xl ${copied ? 'bg-green-600 text-white shadow-green-200' : 'bg-slate-900 text-white hover:bg-black shadow-slate-200'}`}
                          >
                            {copied ? <CheckCircle size={20} /> : <Copy size={20} />}
                            {copied ? '¡Copiado como Tabla!' : 'Copiar Formato para Excel'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SECCION HISTORIAL (MAX 12 REGISTROS) */}
          <div className="space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
              <History className="text-slate-400" />
              <h2 className="text-xl font-bold text-slate-800">Historial de Cruces (Últimos 12)</h2>
            </div>

            {f30History.length === 0 ? (
              <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                <Clock size={48} className="text-slate-200 mx-auto mb-4" />
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Aún no hay registros de comparaciones</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {f30History.map((record) => (
                  <button
                    key={record.id}
                    onClick={() => setViewingRecord(record)}
                    className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-left hover:border-blue-300 transition-all hover:shadow-md group flex flex-col"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="p-2 bg-slate-50 rounded-lg group-hover:bg-blue-50 transition-colors">
                        <FileText size={20} className="text-slate-400 group-hover:text-blue-600" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full uppercase">ID #{record.id.toString().slice(-4)}</span>
                    </div>

                    <h4 className="font-bold text-slate-800 mb-1 line-clamp-1">{record.periodo || 'Sin Periodo'}</h4>

                    <div className="space-y-2 mt-auto">
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                        <Calendar size={14} className="text-slate-400" />
                        {new Date(record.timestamp).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                        <UsersIcon size={14} className="text-slate-400" />
                        {record.data.length} Trabajadores Analizados
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-blue-600 font-bold text-xs uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                      Ver Detalle <ChevronRight size={14} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
          <h2 className="text-xl font-bold text-slate-800">Selecciona una tarea para comenzar</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <button
              onClick={() => setActiveTask('plataforma_falabella')}
              className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-left hover:border-blue-300 transition-all hover:shadow-md group flex flex-col"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="p-3 bg-slate-50 rounded-lg group-hover:bg-blue-50 transition-colors">
                  <FileText size={24} className="text-slate-400 group-hover:text-blue-600" />
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full uppercase">Nuevo</span>
              </div>
              <h3 className="font-bold text-slate-800 mb-1">Dia 14 Falabella</h3>
              <p className="text-sm text-slate-500">Cruce de activos en plataforma vs planilla de cobros.</p>
              <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-blue-600 font-bold text-xs uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                Iniciar Tarea <ChevronRight size={14} />
              </div>
            </button>

            <button
              onClick={() => setActiveTask('comparar_f30')}
              className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-left hover:border-blue-300 transition-all hover:shadow-md group flex flex-col"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="p-3 bg-slate-50 rounded-lg group-hover:bg-blue-50 transition-colors">
                  <FileSearch size={24} className="text-slate-400 group-hover:text-blue-600" />
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full uppercase">Nuevo</span>
              </div>
              <h3 className="font-bold text-slate-800 mb-1">Cruce F30-1 vs Planilla</h3>
              <p className="text-sm text-slate-500">Compara trabajadores de un F30-1 con una planilla de Excel.</p>
              <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-blue-600 font-bold text-xs uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                Iniciar Tarea <ChevronRight size={14} />
              </div>
            </button>
          </div>
        </div>
      )}

      {/* MODAL PARA VER REGISTRO HISTÓRICO */}
      {viewingRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header Modal */}
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-100">
                  <History size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Historial: {viewingRecord.periodo}</h3>
                  <p className="text-xs text-slate-500 font-medium">{new Date(viewingRecord.timestamp).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}</p>
                </div>
              </div>
              <button onClick={() => setViewingRecord(null)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition">
                <X size={24} />
              </button>
            </div>

            {/* Body Modal */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Tabla de Resultados */}
              <div className="lg:col-span-2 border border-slate-100 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 font-bold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">RUT</th>
                      <th className="px-4 py-3">NOMBRE</th>
                      <th className="px-4 py-3 text-center">F-30 1</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {viewingRecord.data.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-500">{item.rut}</td>
                        <td className="px-4 py-3 font-bold text-slate-800">{item.name}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${item.inF30 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {item.inF30 ? 'SÍ' : 'NO'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Acciones Modal */}
              <div className="space-y-6">
                <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                  <h4 className="text-xs font-black text-blue-800 uppercase tracking-widest mb-4">Acciones Disponibles</h4>
                  <button
                    onClick={() => copyAsExcelTable(viewingRecord.data, viewingRecord.periodo)}
                    className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl font-black uppercase text-xs tracking-widest transition transform active:scale-95 shadow-xl ${copied ? 'bg-green-600 text-white shadow-green-200' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'}`}
                  >
                    {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                    {copied ? '¡Copiado!' : 'Copiar como Tabla'}
                  </button>
                  <button
                    onClick={() => exportF30ComparisonToExcel(viewingRecord.data, viewingRecord.periodo)}
                    className="w-full flex items-center justify-center gap-3 py-4 mt-3 rounded-xl font-black uppercase text-xs tracking-widest transition transform active:scale-95 shadow-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200"
                  >
                    <Download size={18} /> Exportar a Excel
                  </button>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Resumen de Auditoría</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">Total Trabajadores:</span>
                      <span className="font-bold text-slate-800">{viewingRecord.data.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">En F30 (SÍ):</span>
                      <span className="font-bold text-emerald-600">{viewingRecord.data.filter(i => i.inF30).length}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">Faltantes (NO):</span>
                      <span className="font-bold text-rose-600">{viewingRecord.data.filter(i => !i.inF30).length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Modal */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">Esta vista corresponde a una captura estática realizada el {new Date(viewingRecord.timestamp).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TasksPage;
