import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../src/services/auditService.js', () => ({ auditService: { registrar: vi.fn().mockResolvedValue(undefined) } }));

import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { logger } from '../../src/config/logger.js';

describe('errorHandler seguro', () => {
  it('omite detalhes SQL e capacidade financeira tambem dos logs', () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const capability = 'b'.repeat(32);
    const req = { id: 'fixture', method: 'POST', path: `/api/v1/pedidos/acompanhar/${capability}/pagamento`, originalUrl: `/api/v1/pedidos/acompanhar/${capability}/pagamento?api_key=fixture-key` };
    const error = Object.assign(new Error('inchk_fixture-secret'), { code: '23514', details: { api_key: 'fixture-key' } });
    errorHandler(error, req, response, vi.fn());
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/inchk_fixture|fixture-key|bbbbbbbb/);
    expect(response.json.mock.calls.at(-1)[0]).not.toHaveProperty('details');
  });
  it('não expõe mensagem, código ou stack de erro inesperado', () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const request = { id: '123e4567-e89b-42d3-a456-426614174000', method: 'POST', path: '/interno', originalUrl: '/interno' };
    const error = Object.assign(new Error('senha=super-secreta'), { code: 'SQL_INTERNAL', stack: 'stack secreta' });

    errorHandler(error, request, response, vi.fn());

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      status: 'fail', code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.', request_id: request.id,
    });
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toMatch(/super-secreta|SQL_INTERNAL|stack secreta/);
  });
});
