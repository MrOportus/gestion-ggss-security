import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  ClipboardList, Copy, CheckCircle, FileText, Send,
  Clock, UserPlus, FileSearch, Upload, Loader2, Table as TableIcon,
  History, Calendar, Users as UsersIcon, ChevronRight, X, Sparkles, Search, MapPin,
  Briefcase, DollarSign, Download, Building2, Camera, ArrowLeft, Bell
} from 'lucide-react';
import { UserCheck, UserX, Eye } from 'lucide-react';
import SmartAutofill from '../components/SmartAutofill';
import { GoogleGenAI } from "@google/genai";
import * as XLSX from 'xlsx';
import { ComparisonRecord } from '../types';
import AdvancePayroll from '../components/AdvancePayroll';
import GalileoExtractor from '../components/GalileoExtractor';
import InformarRenuncia from '../components/InformarRenuncia';
import InfoReemplazo from '../components/InfoReemplazo';
import FormalizarServicio from '../components/FormalizarServicio';
import Dia14Falabella from '../components/Dia14Falabella';
import CompararF30 from '../components/CompararF30';
import GenerarContrato from '../components/GenerarContrato';
import { Banknote } from 'lucide-react';
import { auth as firebaseAuth } from '../lib/firebase';

const TasksPage: React.FC = () => {
  const {
    employees, sites, f30History, contractHistory,
    saveF30Comparison, saveContractRecord, showNotification,
    currentUser, supervisorTasks, updateSupervisorTask
  } = useAppStore();
  const [activeTask, setActiveTask] = useState<'info_reemplazo' | 'comparar_f30' | 'smart_autofill' | 'generar_contrato' | 'plataforma_falabella' | 'nomina_anticipos' | 'formalizar_servicio' | 'informar_renuncia' | 'extractor_galileo' | null>(null);

  const tasks = [
    { id: 'info_reemplazo', title: 'Info Reemplazo', icon: <UserPlus className="text-blue-500" />, desc: 'Generar solicitud formal de reemplazo para Banco Falabella.' },
    { id: 'generar_contrato', title: 'Generar Contrato', icon: <FileText className="text-violet-500" />, desc: 'Generar contrato de trabajo con envío automático a n8n.' },
    { id: 'comparar_f30', title: 'Comparar F30-1', icon: <FileSearch className="text-emerald-500" />, desc: 'Cruce masivo de RUTs entre F30 y planilla Excel.' },
    { id: 'plataforma_falabella', title: 'Dia 14 Falabella', icon: <UsersIcon className="text-green-600" />, desc: 'Cruce de activos en plataforma vs planilla de cobros.' },
    { id: 'smart_autofill', title: 'Auto-llenado Inteligente', icon: <Sparkles className="text-amber-500" />, desc: 'Extracción de datos con IA para formularios web.' },
    { id: 'formalizar_servicio', title: 'Formalizar Servicio', icon: <ClipboardList className="text-rose-500" />, desc: 'Generar tabla de requerimiento de servicio Falabella.' },
    { id: 'extractor_galileo', title: 'Extractor de Turnos Galileo', icon: <TableIcon className="text-blue-600" />, desc: 'Extrae datos de notificaciones Galileo para planilla de cobros.' },
    { id: 'nomina_anticipos', title: 'Nómina Anticipos', icon: <Banknote className="text-amber-600" />, desc: 'Ingreso masivo de anticipos por sucursal para el día 15.', hidden: currentUser && currentUser.role === 'worker' },

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
              return t.id === 'nomina_anticipos' || t.id === 'informar_renuncia';
            }
            return !(t as any).hidden;
          }).map((task) => (
            <button
              key={task.id}
              disabled={task.disabled}
              onClick={() => setActiveTask(task.id as any)}
              className={`p-6 bg-white rounded-xl border border-slate-200 text-left transition-all group ${task.disabled ? 'opacity-60 grayscale cursor-not-allowed' : 'hover:shadow-md hover:border-slate-400 active:scale-[0.98]'}`}
            >
              <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mb-4 transition-colors group-hover:bg-white border border-transparent group-hover:border-slate-100">
                {task.icon}
              </div>
              <h3 className="font-bold text-slate-700 mb-1">{task.title}</h3>
              <p className="text-xs text-slate-400 font-medium leading-relaxed">{task.desc}</p>
            </button>
          ))}
        </div>
      ) : activeTask === 'smart_autofill' ? (
        <SmartAutofill onBack={() => setActiveTask(null)} />
      ) : activeTask === 'nomina_anticipos' ? (
        <AdvancePayroll onBack={() => setActiveTask(null)} />
      ) : activeTask === 'extractor_galileo' ? (
        <GalileoExtractor onBack={() => setActiveTask(null)} />
      ) : activeTask === 'informar_renuncia' ? (
        <InformarRenuncia onBack={() => setActiveTask(null)} />
      ) : activeTask === 'formalizar_servicio' ? (
        <FormalizarServicio onBack={() => setActiveTask(null)} />
      ) : activeTask === 'generar_contrato' ? (
        <GenerarContrato onBack={() => setActiveTask(null)} />
      ) : activeTask === 'plataforma_falabella' ? (
        <Dia14Falabella onBack={() => setActiveTask(null)} />
      ) : activeTask === 'info_reemplazo' ? (
        <InfoReemplazo onBack={() => setActiveTask(null)} />
      ) : activeTask === 'comparar_f30' ? (
        <CompararF30 onBack={() => setActiveTask(null)} />
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

    </div>
  );
};

export default TasksPage;
