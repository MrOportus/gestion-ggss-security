import { Role } from '../../types';

export class PermissionService {
  // Matriz de permisos centralizada
  canReadConfig(role: Role): boolean {
    return ['admin', 'supervisor', 'jefe_operaciones', 'rrhh'].includes(role);
  }

  canWriteConfig(role: Role): boolean {
    return ['admin', 'jefe_operaciones'].includes(role);
  }

  canReadContracts(role: Role, esPropio: boolean = false): boolean {
    if (role === 'worker') return esPropio;
    return ['admin', 'supervisor', 'jefe_operaciones', 'rrhh'].includes(role);
  }

  canWriteContracts(role: Role): boolean {
    return ['admin', 'rrhh'].includes(role);
  }

  canWriteShifts(role: Role): boolean {
    return ['admin', 'supervisor', 'jefe_operaciones'].includes(role);
  }
}

export const permissionService = new PermissionService();
