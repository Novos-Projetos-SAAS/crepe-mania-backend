import { randomUUID } from 'node:crypto';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeRequestId(value) {
  return typeof value === 'string' && CANONICAL_UUID.test(value) ? value.toLowerCase() : randomUUID();
}

export function requestContext(req, res, next) {
  req.id = normalizeRequestId(req.get('x-request-id'));
  res.set('x-request-id', req.id);
  next();
}
