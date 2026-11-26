import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_POLICIES, createRateLimiter } from '../../src/middlewares/security.js';

describe('rate limits isolados por instancia', () => {
  it('bloqueia a requisicao seguinte ao limite em cada superficie', async () => {
    const surfaces = ['login', 'refresh', 'publicOrder', 'tracking', 'push', 'upload'];
    for (const name of surfaces) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.id = '00000000-0000-4000-8000-000000000000';
        req.user = { id: 'fixture-user' };
        next();
      });
      app.post('/', createRateLimiter(name), (_req, res) => res.status(200).json({ ok: true }));
      const limit = RATE_LIMIT_POLICIES[name].limit;
      for (let index = 0; index < limit; index += 1) {
        await request(app).post('/').send({ email: 'rate@example.invalid' }).expect(200);
      }
      const blocked = await request(app).post('/').send({ email: 'rate@example.invalid' }).expect(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(blocked.headers['ratelimit-policy']).toBeTruthy();
    }
  });

  it('isola contador de conta, cliente, Push e upload por identidade protegida', async () => {
    for (const name of ['loginAccount', 'publicOrderCustomer', 'push', 'upload']) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.id = '00000000-0000-4000-8000-000000000000';
        req.user = { id: req.get('x-user') ?? 'A' };
        next();
      });
      app.post('/', createRateLimiter(name), (_req, res) => res.status(200).json({ ok: true }));
      const limit = RATE_LIMIT_POLICIES[name].limit;
      const bodyA = { email: 'a@example.invalid', cliente: { telefone: '11900000001' } };
      for (let index = 0; index < limit; index += 1) {
        await request(app).post('/').set('x-user', 'A').send(bodyA).expect(200);
      }
      await request(app).post('/').set('x-user', 'A').send(bodyA).expect(429);
      await request(app).post('/').set('x-user', 'B')
        .send({ email: 'b@example.invalid', cliente: { telefone: '11900000002' } })
        .expect(200);
    }
  });
});
