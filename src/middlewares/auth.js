import { authService } from '../services/authService.js';
import { AppError } from '../utils/AppError.js';

export async function requireAuth(req, _res, next) {
  try {
    req.user = await authService.authenticate(req.cookies?.ls_access);
    next();
  } catch (error) { next(error); }
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (req.user?.nivel === 'admin' || req.user?.permissoes?.includes(permission)) return next();
    next(new AppError('Permissao insuficiente.', 403, 'FORBIDDEN'));
  };
}
