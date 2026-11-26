
import { storeService } from '../services/storeService.js';
import { requestAuditContext, success } from './helpers.js';

export const storeController = {

    async publicStatus(_req, res) {
        const status = await storeService.status();

        // Remove os dados administrativos da resposta pública.
        delete status.config;

        return success(res, status);
    },


    async config(_req, res) {
        return success(
            res,
            await storeService.repository.config(),
        );
    },

    async updateConfig(req, res) {
        return success(
            res,
            await storeService.updateConfig(
                req.body,
                requestAuditContext(req),
            ),
        );
    },

    async updateStatus(req, res) {
        const context = requestAuditContext(req);

        // Novo contrato: modo explícito de funcionamento.
        if (req.body.modo_operacao !== undefined) {
            return success(
                res,
                await storeService.updateOperationMode(
                    req.body.modo_operacao,
                    context,
                ),
            );
        }

        // Contrato antigo:
        // true = automático
        // false = fechado manualmente
        return success(
            res,
            await storeService.updateStatus(
                req.body.aceitar_pedidos,
                context,
            ),
        );
    },

    async schedules(_req, res) {
        return success(
            res,
            await storeService.repository.schedules(),
        );
    },

    async replaceSchedules(req, res) {
        return success(
            res,
            await storeService.replaceSchedules(
                req.body.horarios,
                requestAuditContext(req),
            ),
        );
    },
};
