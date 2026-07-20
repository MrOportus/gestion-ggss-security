import { PlantillaTurno, HorarioSnapshot } from '../../types/phase1';

export class ShiftTemplateService {
  private plantillas: Map<string, PlantillaTurno[]> = new Map(); // sucursalId -> plantillas

  // Fallbacks globales definidos
  public static readonly FALLBACKS: Record<string, { inicio: string; termino: string }> = {
    'X': { inicio: '07:30', termino: '19:30' },
    'N': { inicio: '19:30', termino: '07:30' } // cruza medianoche
  };

  // Simulación para carga inicial en tests
  seedTemplates(sucursalId: string, plantillas: PlantillaTurno[]) {
    this.plantillas.set(sucursalId, plantillas);
  }

  async resolveHorario(sucursalId: string, codigo: string, fechaVigencia: string): Promise<{ snapshot: HorarioSnapshot, plantillaId?: string }> {
    const plantillasSucursal = this.plantillas.get(sucursalId) || [];
    
    const plantillaActiva = plantillasSucursal.find(p => 
      p.codigo === codigo && 
      p.activo && 
      p.vigenciaDesde <= fechaVigencia && 
      (!p.vigenciaHasta || p.vigenciaHasta >= fechaVigencia)
    );

    if (plantillaActiva) {
      return {
        plantillaId: plantillaActiva.id,
        snapshot: {
          inicio: plantillaActiva.horaInicio,
          termino: plantillaActiva.horaTermino,
          cruzaMedianoche: plantillaActiva.cruzaMedianoche,
          origen: 'plantilla'
        }
      };
    }

    // No hay plantilla para la sucursal, usar fallback si existe
    const fallback = ShiftTemplateService.FALLBACKS[codigo];
    if (fallback) {
      const cruzaMedianoche = this.evaluarCruceMedianoche(fallback.inicio, fallback.termino);
      return {
        snapshot: {
          inicio: fallback.inicio,
          termino: fallback.termino,
          cruzaMedianoche,
          origen: 'fallback'
        }
      };
    }

    throw new Error(`No se encontró plantilla ni fallback para el código ${codigo} en la sucursal ${sucursalId}`);
  }

  private evaluarCruceMedianoche(inicio: string, termino: string): boolean {
    const [hI, mI] = inicio.split(':').map(Number);
    const [hT, mT] = termino.split(':').map(Number);
    
    if (hT < hI) return true;
    if (hT === hI && mT < mI) return true;
    return false;
  }
}

export const shiftTemplateService = new ShiftTemplateService();
