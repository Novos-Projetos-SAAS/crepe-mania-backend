import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { normalizeRequestId } from '../../src/middlewares/requestContext.js';

describe('HTTP sem banco', () => {
  it('health funciona sem DATABASE_URL e nao vaza ambiente', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);
    expect(response.body.status).toBe('success'); expect(response.body.data.status).toBe('ok'); expect(response.text).not.toContain('DATABASE_URL');
  });
  it('ready informa indisponibilidade sem banco', async () => {
    const response = await request(app).get('/api/v1/ready').expect(503);
    expect(response.body.code).toBe('DATABASE_NOT_CONFIGURED');
  });
  it('rota inexistente segue envelope de erro', async () => {
    const response = await request(app).get('/inexistente').expect(404);
    expect(response.body).toMatchObject({ status: 'fail', code: 'ROUTE_NOT_FOUND' }); expect(response.body.request_id).toBeTruthy();
  });
  it('preserva UUID canonico e substitui request-ids hostis', async () => {
    const valid = '123e4567-e89b-42d3-a456-426614174000';
    const preserved = await request(app).get('/api/v1/health').set('x-request-id', valid).expect(200);
    expect(preserved.headers['x-request-id']).toBe(valid);
    const invalidValues = ['12345678', '123e4567e89b42d3a456426614174000', 'a'.repeat(64), 'zzzzzzzz-zzzz-4zzz-azzz-zzzzzzzzzzzz', ' 123e4567-e89b-42d3-a456-426614174000 ', ''];
    for (const value of invalidValues) {
      const response = await request(app).get('/api/v1/health').set('x-request-id', value).expect(200);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(response.headers['x-request-id']).not.toBe(value);
    }
  });
  it('rejeita diretamente UUID com espacos antes da normalizacao HTTP', () => {
    const hostile = ' 123e4567-e89b-42d3-a456-426614174000 ';
    expect(normalizeRequestId(hostile)).not.toBe(hostile.trim());
  });
  it('aplica CORS com credenciais somente a origem permitida', async () => {
    const allowed = await request(app).get('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-allow-origin']).not.toBe('*');

    const hostile = await request(app).get('/api/v1/health')
      .set('Origin', 'https://hostil.example.invalid')
      .expect(403);
    expect(hostile.body.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(hostile.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('recusa JSON malformado, campos extras e payload acima do limite', async () => {
    const malformed = await request(app).post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(malformed.body.code).toBe('INVALID_JSON');

    const extra = await request(app).post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'fake@example.invalid', senha: 'Senha123', extra: true })
      .expect(422);
    expect(extra.body.code).toBe('VALIDATION_ERROR');
    expect(extra.body.message).toBe('Revise os campos informados.');
    expect(extra.body.details).toContainEqual({ path: 'extra', message: 'Campo não permitido.' });
    expect(extra.text).not.toContain('unrecognized_keys');

    const oversized = await request(app).post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'fake@example.invalid', senha: 'A'.repeat(300 * 1024) })
      .expect(413);
    expect(oversized.body.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('retorna validações estruturadas e seguras em português', async () => {
    const response = await request(app).post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'invalido', senha: '1' })
      .expect(422);

    expect(response.body).toMatchObject({ status: 'fail', code: 'VALIDATION_ERROR' });
    expect(response.body.request_id).toBeTruthy();
    expect(response.body.details).toEqual(expect.arrayContaining([
      { path: 'email', message: 'Informe um e-mail válido.' },
      { path: 'senha', message: 'Informe pelo menos 8 caracteres.' },
    ]));
    expect(response.text).not.toMatch(/stack|ZodError|invalid_format/i);
  });
  it('cabecalhos inesperados nao derrubam o processo', async () => {
    const response = await request(app).get('/api/v1/health')
      .set('x-forwarded-host', 'hostil.example.invalid')
      .set('x-original-url', '/admin')
      .set('forwarded', 'for=unknown;proto=javascript')
      .expect(200);
    expect(response.body.data.status).toBe('ok');
  });
});
