import { FeatureFlagConfig, FeatureFlagState } from '../../types/phase1';

export class FeatureFlagService {
  private flags: Map<string, FeatureFlagConfig> = new Map();

  async getFlag(sucursalId: string, mes: string): Promise<FeatureFlagState> {
    const id = `flag_${sucursalId}_${mes}`;
    const flag = this.flags.get(id);
    return flag ? flag.estado : 'legacy'; // Por defecto, todo sucursal-mes opera en modo legacy
  }

  async setFlag(sucursalId: string, mes: string, estado: FeatureFlagState, usuarioId: string): Promise<FeatureFlagConfig> {
    const id = `flag_${sucursalId}_${mes}`;
    const newFlag: FeatureFlagConfig = {
      id,
      sucursalId,
      mes,
      estado,
      creadoEn: new Date().toISOString(),
      creadoPor: usuarioId,
      modificadoEn: new Date().toISOString(),
      modificadoPor: usuarioId
    };
    this.flags.set(id, newFlag);
    return newFlag;
  }
}

export const featureFlagService = new FeatureFlagService();
