import { Router } from 'express';
import { infinitepayController, paymentResponseHeaders } from '../controllers/infinitepayController.js';
import { infinitepayConfigSchema, infinitepayConfirmSchema, infinitepayAttemptParams, infinitepayListSchema } from '../validators/infinitepaySchemas.js';
import { paymentConfirmLimiter } from '../middlewares/security.js';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middlewares/auth.js';
import { pushLimiter, requireAllowedOrigin, requireCsrf, uploadLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import { asyncHandler } from '../controllers/helpers.js';
import { catalogController, productLifecycleController, productLinksController } from '../controllers/catalogController.js';
import { orderController } from '../controllers/orderController.js';
import { storeController } from '../controllers/storeController.js';
import { logController, reportController, userController } from '../controllers/adminController.js';
import { notificationController } from '../controllers/notificationController.js';
import { printingController } from '../controllers/printingController.js';
import { uploadController } from '../controllers/uploadController.js';
import { invitationAdminController } from '../controllers/invitationController.js';
import { uploadSingleImage } from '../middlewares/upload.js';
import { additionalLinksSchema, additionalSchema, cancelOrderSchema, catalogListQuerySchema, categorySchema, createInvitationSchema, createOrderSchema, createPrintPairingSchema, createUserSchema, deletePushSchema, idParamsSchema, invitationListQuerySchema, logListQuerySchema, orderListQuerySchema, orderStatusSchema, paginationSchema, paymentMethodSchema, paymentStatusSchema, permissionsSchema, printListQuerySchema, productListQuerySchema, productSchema, pushSubscriptionSchema, qzSignSchema, receiptQuerySchema, reportCodeParamsSchema, reportGenerateSchema, reportOptionParamsSchema, resetPasswordSchema, scheduleSchema, storeConfigSchema, storeStatusSchema, updateOrderSchema, updateUserSchema, userListQuerySchema } from '../validators/schemas.js';
import { androidPrintingController } from '../controllers/androidPrintingController.js';

export const adminRoutes = Router();
adminRoutes.use(requireAuth);
adminRoutes.use((req, res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requireAllowedOrigin(req, res, (error) => error ? next(error) : requireCsrf(req, res, next)));
adminRoutes.get('/pagamentos/infinitepay/configuracao', paymentResponseHeaders, requirePermission('infinitepay.visualizar'), asyncHandler(infinitepayController.configuration));
adminRoutes.patch('/pagamentos/infinitepay/configuracao', paymentResponseHeaders, requirePermission('infinitepay.configurar'), validate(infinitepayConfigSchema), asyncHandler(infinitepayController.updateConfiguration));
adminRoutes.get('/pagamentos', paymentResponseHeaders, requirePermission('pagamentos.listar'), validate(infinitepayListSchema, 'query'), asyncHandler(infinitepayController.list));
adminRoutes.post('/pagamentos/:id/conciliar', paymentResponseHeaders, requirePermission('pagamentos.conciliar'), paymentConfirmLimiter, validate(infinitepayAttemptParams, 'params'), validate(infinitepayConfirmSchema), asyncHandler(infinitepayController.reconcile));

const crud = (path, entity, schema, permissions, { detail = true, listSchema = catalogListQuerySchema } = {}) => {
    const controller = catalogController(entity);
    adminRoutes.get(path, requirePermission(permissions.list), validate(listSchema, 'query'), asyncHandler(controller.list));
    adminRoutes.post(path, requirePermission(permissions.manage), validate(schema), asyncHandler(controller.create));
    if (detail) adminRoutes.get(`${path}/:id`, requirePermission(permissions.list), validate(idParamsSchema, 'params'), asyncHandler(controller.get));
    adminRoutes.patch(`${path}/:id`, requirePermission(permissions.manage), validate(idParamsSchema, 'params'), validate(schema.partial()), asyncHandler(controller.update));
    adminRoutes.delete(`${path}/:id`, requirePermission(permissions.manage), validate(idParamsSchema, 'params'), asyncHandler(controller.remove));
};

crud('/categorias', 'categorias', categorySchema, { list: 'categorias.listar', manage: 'categorias.gerenciar' });
crud('/produtos', 'produtos', productSchema, { list: 'produtos.listar', manage: 'produtos.gerenciar' }, { listSchema: productListQuerySchema });
crud('/adicionais', 'adicionais', additionalSchema, { list: 'adicionais.listar', manage: 'adicionais.gerenciar' }, { detail: false });
crud('/metodos-pagamento', 'metodos-pagamento', paymentMethodSchema, { list: 'metodos_pagamento.listar', manage: 'metodos_pagamento.gerenciar' }, { detail: false });

adminRoutes.patch('/produtos/:id/disponibilidade', requirePermission('produtos.disponibilidade'), validate(idParamsSchema, 'params'), validate(z.object({ disponivel_hoje: z.boolean() }).strict()), asyncHandler(catalogController('produtos').update));
adminRoutes.patch('/produtos/:id/desativar', requirePermission('produtos.gerenciar'), validate(idParamsSchema, 'params'), asyncHandler(productLifecycleController.deactivate));
adminRoutes.post('/produtos/:id/reativar', requirePermission('produtos.gerenciar'), validate(idParamsSchema, 'params'), asyncHandler(productLifecycleController.reactivate));
adminRoutes.post('/produtos/:id/restaurar', requirePermission('produtos.gerenciar'), validate(idParamsSchema, 'params'), asyncHandler(productLifecycleController.restore));
adminRoutes.get('/produtos/:id/vinculos', requirePermission('produtos.listar'), validate(idParamsSchema, 'params'), asyncHandler(productLinksController.get));
adminRoutes.put('/produtos/:id/adicionais', requirePermission('produtos.gerenciar'), validate(idParamsSchema, 'params'), validate(additionalLinksSchema), asyncHandler(productLinksController.additionals));
adminRoutes.patch('/adicionais/:id/disponibilidade', requirePermission('adicionais.disponibilidade'), validate(idParamsSchema, 'params'), validate(z.object({ disponivel_hoje: z.boolean() }).strict()), asyncHandler(catalogController('adicionais').update));

adminRoutes.post('/uploads/produtos', requirePermission('produtos.gerenciar'), uploadLimiter, uploadSingleImage, asyncHandler(uploadController.product));
adminRoutes.post('/uploads/logo', requirePermission('loja.configurar'), uploadLimiter, uploadSingleImage, asyncHandler(uploadController.logo));

adminRoutes.get('/pedidos', requirePermission('pedidos.listar'), validate(orderListQuerySchema, 'query'), asyncHandler(orderController.list));
adminRoutes.post('/pedidos', requirePermission('pedidos.criar'), validate(createOrderSchema), asyncHandler(orderController.createAdmin));
adminRoutes.get('/pedidos/:id', requirePermission('pedidos.listar'), validate(idParamsSchema, 'params'), asyncHandler(orderController.detail));
adminRoutes.patch('/pedidos/:id', requirePermission('pedidos.editar'), validate(idParamsSchema, 'params'), validate(updateOrderSchema), asyncHandler(orderController.update));
adminRoutes.patch('/pedidos/:id/status', requirePermission('pedidos.status'), validate(idParamsSchema, 'params'), validate(orderStatusSchema), asyncHandler(orderController.status));
adminRoutes.patch('/pedidos/:id/pagamento', requirePermission('pedidos.pagamento'), validate(idParamsSchema, 'params'), validate(paymentStatusSchema), asyncHandler(orderController.payment));
adminRoutes.post('/pedidos/:id/cancelar', requirePermission('pedidos.cancelar'), validate(idParamsSchema, 'params'), validate(cancelOrderSchema), asyncHandler(orderController.cancel));
adminRoutes.get('/pedidos/:id/historico', requirePermission('pedidos.listar'), validate(idParamsSchema, 'params'), asyncHandler(orderController.history));

adminRoutes.get('/loja/configuracoes', requirePermission('loja.visualizar'), asyncHandler(storeController.config));
adminRoutes.patch('/loja/configuracoes', requirePermission('loja.configurar'), validate(storeConfigSchema), asyncHandler(storeController.updateConfig));
adminRoutes.patch('/loja/status', requirePermission('loja.status'), validate(storeStatusSchema), asyncHandler(storeController.updateStatus));
adminRoutes.get('/loja/horarios', requirePermission('loja.visualizar'), asyncHandler(storeController.schedules));
adminRoutes.put('/loja/horarios', requirePermission('loja.configurar'), validate(scheduleSchema), asyncHandler(storeController.replaceSchedules));

adminRoutes.get('/usuarios', requirePermission('usuarios.listar'), validate(userListQuerySchema, 'query'), asyncHandler(userController.list));
adminRoutes.post('/usuarios', requirePermission('usuarios.criar'), validate(createUserSchema), asyncHandler(userController.create));
adminRoutes.get('/usuarios/:id', requirePermission('usuarios.listar'), validate(idParamsSchema, 'params'), asyncHandler(userController.detail));
adminRoutes.patch('/usuarios/:id', requirePermission('usuarios.editar'), validate(idParamsSchema, 'params'), validate(updateUserSchema), asyncHandler(userController.update));
adminRoutes.delete('/usuarios/:id', requirePermission('usuarios.desativar'), validate(idParamsSchema, 'params'), asyncHandler(userController.remove));
adminRoutes.patch('/usuarios/:id/permissoes', requirePermission('permissoes.editar'), validate(idParamsSchema, 'params'), validate(permissionsSchema), asyncHandler(userController.permissions));
adminRoutes.post('/usuarios/:id/redefinir-senha', requirePermission('usuarios.redefinir_senha'), validate(idParamsSchema, 'params'), validate(resetPasswordSchema), asyncHandler(userController.resetPassword));
adminRoutes.get('/permissoes', requirePermission('permissoes.listar'), asyncHandler(userController.permissionCatalog));
adminRoutes.get('/niveis-acesso', requirePermission('permissoes.listar'), asyncHandler(userController.accessLevels));

adminRoutes.get('/convites', requirePermission('convites.listar'), validate(invitationListQuerySchema, 'query'), asyncHandler(invitationAdminController.list));
adminRoutes.post('/convites', requirePermission('convites.gerenciar'), validate(createInvitationSchema), asyncHandler(invitationAdminController.create));
adminRoutes.get('/convites/niveis-acesso', requirePermission('convites.gerenciar'), asyncHandler(userController.accessLevels));
adminRoutes.post('/convites/:id/reemitir', requirePermission('convites.gerenciar'), validate(idParamsSchema, 'params'), asyncHandler(invitationAdminController.reissue));
adminRoutes.post('/convites/:id/revogar', requirePermission('convites.gerenciar'), validate(idParamsSchema, 'params'), asyncHandler(invitationAdminController.revoke));

const reportQuery = z.object({ data_inicio: z.string().date(), data_fim: z.string().date() });
adminRoutes.get('/dashboard', requirePermission('dashboard.visualizar'), validate(reportQuery, 'query'), asyncHandler(reportController.dashboard));
adminRoutes.get('/relatorios/vendas', requirePermission('relatorios.visualizar'), validate(reportQuery, 'query'), asyncHandler(reportController.sales));
adminRoutes.get('/relatorios/produtos', requirePermission('relatorios.visualizar'), validate(reportQuery, 'query'), asyncHandler(reportController.products));
adminRoutes.get('/relatorios/adicionais', requirePermission('relatorios.visualizar'), validate(reportQuery, 'query'), asyncHandler(reportController.additionals));
adminRoutes.get('/relatorios/pagamentos', requirePermission('relatorios.visualizar'), validate(reportQuery, 'query'), asyncHandler(reportController.payments));
adminRoutes.get('/relatorios/vendas.csv', requirePermission('relatorios.visualizar'), validate(reportQuery, 'query'), asyncHandler(reportController.csv));
adminRoutes.get('/relatorios', requirePermission('relatorios.visualizar'), asyncHandler(reportController.catalog));
adminRoutes.get('/relatorios/opcoes/:fonte', requirePermission('relatorios.visualizar'), validate(reportOptionParamsSchema, 'params'), asyncHandler(reportController.options));
adminRoutes.get('/relatorios/:codigo', requirePermission('relatorios.visualizar'), validate(reportCodeParamsSchema, 'params'), asyncHandler(reportController.metadata));
adminRoutes.post('/relatorios/:codigo/gerar', requirePermission('relatorios.visualizar'), validate(reportCodeParamsSchema, 'params'), validate(reportGenerateSchema), asyncHandler(reportController.generate));
adminRoutes.post('/relatorios/:codigo/pdf', requirePermission('relatorios.visualizar'), validate(reportCodeParamsSchema, 'params'), validate(reportGenerateSchema), asyncHandler(reportController.pdf));
adminRoutes.get('/logs', requirePermission('logs.listar'), validate(logListQuerySchema, 'query'), asyncHandler(logController.list));
adminRoutes.get('/logs/:id', requirePermission('logs.listar'), validate(idParamsSchema, 'params'), asyncHandler(logController.detail));

adminRoutes.get('/push/configuracao', requirePermission('notificacoes.receber'), pushLimiter, notificationController.config);
adminRoutes.post('/push/inscricoes', requirePermission('notificacoes.receber'), pushLimiter, validate(pushSubscriptionSchema), asyncHandler(notificationController.subscribe));
adminRoutes.delete('/push/inscricoes', requirePermission('notificacoes.receber'), pushLimiter, validate(deletePushSchema), asyncHandler(notificationController.unsubscribe));
adminRoutes.get('/notificacoes', requirePermission('notificacoes.receber'), validate(paginationSchema.strict(), 'query'), asyncHandler(notificationController.list));
adminRoutes.get('/notificacoes/nao-lidas', requirePermission('notificacoes.receber'), asyncHandler(notificationController.unread));
adminRoutes.patch('/notificacoes/:id/lida', requirePermission('notificacoes.receber'), validate(idParamsSchema, 'params'), asyncHandler(notificationController.read));

adminRoutes.get('/pedidos/:id/comanda', requirePermission('impressoes.listar'), validate(idParamsSchema, 'params'), validate(receiptQuerySchema, 'query'), asyncHandler(printingController.receipt));
adminRoutes.post('/pedidos/:id/impressoes', requirePermission('impressoes.solicitar'), validate(idParamsSchema, 'params'), asyncHandler(printingController.request));
adminRoutes.get('/impressoes', requirePermission('impressoes.listar'), validate(printListQuerySchema, 'query'), asyncHandler(printingController.list));
adminRoutes.get('/impressoes/android/status', requirePermission('impressoes.listar'), asyncHandler(androidPrintingController.status));
adminRoutes.post('/impressoes/android/pareamentos', requirePermission('impressoes.configurar'), validate(createPrintPairingSchema), asyncHandler(androidPrintingController.createPairing));
adminRoutes.post('/impressoes/android/dispositivos/:id/revogar', requirePermission('impressoes.configurar'), validate(idParamsSchema, 'params'), asyncHandler(androidPrintingController.revoke));
adminRoutes.post('/impressoes/android/teste', requirePermission('impressoes.configurar'), asyncHandler(androidPrintingController.test));
adminRoutes.get('/impressoes/:id', requirePermission('impressoes.listar'), validate(idParamsSchema, 'params'), asyncHandler(printingController.detail));
adminRoutes.get('/qz/configuracao', requirePermission('impressoes.configurar'), printingController.qzConfig);
adminRoutes.post('/qz/assinar', requirePermission('impressoes.configurar'), validate(qzSignSchema), printingController.qzSign);
adminRoutes.get('/qz/certificado', requirePermission('impressoes.configurar'), printingController.qzCertificate);
