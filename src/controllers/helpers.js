export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
export const success = (res, data, status = 200, message) => res.status(status).json({ status: 'success', data, ...(message ? { message } : {}) });
export const paginated = (res, result, page, limit) => success(res, { items: result.items, pagination: { page, limit, total: result.total, total_pages: Math.ceil(result.total / limit) } });
export const requestAuditContext = (req) => ({ user: req.user, method: req.method, endpoint: req.originalUrl, requestId: req.id });
