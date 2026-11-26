import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { asyncHandler } from '../controllers/helpers.js';
import { requireAuth } from '../middlewares/auth.js';
import { loginAccountLimiter, loginLimiter, refreshLimiter, requireAllowedOrigin, requireCsrf } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import { changePasswordSchema, loginSchema } from '../validators/schemas.js';

export const authRoutes = Router();
authRoutes.get('/csrf', authController.csrf);
authRoutes.post('/login', loginLimiter, requireAllowedOrigin, validate(loginSchema), loginAccountLimiter, asyncHandler(authController.login));
authRoutes.post('/refresh', refreshLimiter, requireAllowedOrigin, requireCsrf, asyncHandler(authController.refresh));
authRoutes.post('/logout', requireAllowedOrigin, requireCsrf, requireAuth, asyncHandler(authController.logout));
authRoutes.post('/logout-all', requireAllowedOrigin, requireCsrf, requireAuth, asyncHandler(authController.logoutAll));
authRoutes.post('/alterar-senha', requireAllowedOrigin, requireCsrf, requireAuth, validate(changePasswordSchema), asyncHandler(authController.changePassword));
authRoutes.get('/me', requireAuth, authController.me);
