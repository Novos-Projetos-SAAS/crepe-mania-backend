import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../config/logger.js';
import { auditService } from '../services/auditService.js';
import { zodErrorDetails } from '../utils/validationErrors.js';
import { safeRequestPath } from '../utils/sanitize.js';

const STATUS_MESSAGES = {
    400: 'Não foi possível processar a solicitação.',
    401: 'Sua sessão expirou. Entre novamente.',
    403: 'Você não tem permissão para realizar esta ação.',
    404: 'O recurso solicitado não foi encontrado.',
    409: 'A operação conflita com o estado atual do registro.',
    413: 'O conteúdo enviado excede o limite permitido.',
    422: 'Revise os campos informados.',
    429: 'Muitas tentativas. Aguarde um momento e tente novamente.',
};

export function notFound(req, _res, next) {
    next(new AppError(`Rota nao encontrada: ${req.method} ${req.path}`, 404, 'ROUTE_NOT_FOUND'));
}

export function errorHandler(error, req, res, _next) {
    const databaseConflict = ['23505', '23503'].includes(error.code);
    const invalidJson = error instanceof SyntaxError && error.status === 400 && 'body' in error;
    const payloadTooLarge = error?.type === 'entity.too.large' || error?.status === 413 || error?.statusCode === 413;
    const uploadTooLarge = error?.name === 'MulterError' && error.code === 'LIMIT_FILE_SIZE';
    const uploadError = error?.name === 'MulterError';
    const known = error instanceof AppError || error instanceof ZodError || databaseConflict || invalidJson || payloadTooLarge || uploadError;
    const candidateStatus = Number(error?.statusCode ?? error?.status);
    const safeCandidateStatus = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500;
    const status = uploadTooLarge || payloadTooLarge ? 413 : uploadError ? 422 : error instanceof ZodError ? 422 : databaseConflict ? 409 : invalidJson ? 400 : safeCandidateStatus;
    const code = uploadTooLarge ? 'IMAGE_TOO_LARGE' : payloadTooLarge ? 'PAYLOAD_TOO_LARGE' : uploadError ? 'INVALID_MULTIPART' : error instanceof ZodError ? 'VALIDATION_ERROR' : databaseConflict ? 'DATABASE_CONFLICT' : invalidJson ? 'INVALID_JSON' : error instanceof AppError ? error.code : 'INTERNAL_ERROR';
    if (!known) logger.error({ code, request_id: req.id, method: req.method, path: safeRequestPath(req.path) }, 'Erro nao tratado');
    if ((status >= 500 && code !== 'DATABASE_NOT_CONFIGURED') || ['ORIGIN_NOT_ALLOWED', 'REFRESH_REPLAY', 'INVALID_AGENT_TOKEN'].includes(code)) {
        Promise.resolve().then(() => auditService.registrar({
            usuarioId: req.user?.id ?? null,
            tipo: status >= 500 ? 'ERRO' : 'SEGURANCA',
            acao: `HTTP.${code}`,
            descricao: status >= 500 ? 'Falha tecnica durante request' : 'Requisicao de seguranca recusada',
            metodo: req.method,
            endpoint: safeRequestPath(req.originalUrl),
            requestId: req.id,
            payload: { code },
        })).catch(() => logger.warn({ code: 'AUDIT_UNAVAILABLE', request_id: req.id }, 'Nao foi possivel persistir auditoria da falha'));
    }
    const knownMessage = error instanceof AppError ? error.message : STATUS_MESSAGES[status];
    const response = {
        status: 'fail', code,
        message: uploadTooLarge ? 'A imagem excede o limite permitido.' : payloadTooLarge ? 'O conteúdo enviado excede o limite permitido.' : uploadError ? 'Não foi possível processar o arquivo enviado.' : error instanceof ZodError ? 'Revise os campos informados.' : databaseConflict ? 'A operação conflita com um registro existente ou relacionado.' : invalidJson ? 'O JSON enviado é inválido.' : knownMessage ?? 'Erro interno do servidor.',
        request_id: req.id,
    };
    const details = error instanceof ZodError ? zodErrorDetails(error) : error instanceof AppError ? error.details : undefined;
    if (details) response.details = details;
    res.status(status).json(response);
}
