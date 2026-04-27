import React, { useState, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Search, X, ArrowLeft, Camera, FileText, Send } from 'lucide-react';

interface InformarRenunciaProps {
  onBack: () => void;
}

const InformarRenuncia: React.FC<InformarRenunciaProps> = ({ onBack }) => {
  const { employees, showNotification, currentUser, addResignationRequest } = useAppStore();

  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [resignationData, setResignationData] = useState({
    workerId: '',
    resignationDate: getTodayStr(),
    effectiveDate: getTodayStr(),
    reason: '',
    observations: ''
  });
  const [resignationWorkerSearch, setResignationWorkerSearch] = useState('');
  const [showResignationWorkerList, setShowResignationWorkerList] = useState(false);
  const resignationWorkerRef = useRef<HTMLDivElement>(null);
  const [resignationAttachments, setResignationAttachments] = useState<string[]>([]);

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
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
            onBack();
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
  );
};

export default InformarRenuncia;
