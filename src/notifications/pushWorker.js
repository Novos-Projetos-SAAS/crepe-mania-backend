import webpush from 'web-push';
import { env } from '../config/env.js';
import { getDb } from '../database/connection.js';
import { logger } from '../config/logger.js';
import { decryptPushSecret } from '../utils/crypto.js';
import { canReceiveNotifications } from '../services/notificationAccess.js';
import { applyOperationalFilter, isOperationallyReleased } from '../payments/orderPaymentPolicy.js';

let timer;
let configured = false;

export function pushConfiguration() {
  const enabled = env.PUSH_ENABLED && Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.PUSH_ENCRYPTION_KEY);
  return { habilitado: enabled, public_key: enabled ? env.VAPID_PUBLIC_KEY : null };
}

function configure() {
  if (configured || !pushConfiguration().habilitado) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

export function isDeliveryAuthorized(delivery) {
  return String(delivery.notificacao_usuario_id) === String(delivery.subscription_usuario_id)
    && canReceiveNotifications({
      ativo: delivery.usuario_ativo,
      deletado_em: delivery.usuario_deletado_em,
      nivel: delivery.nivel,
      nivel_ativo: delivery.nivel_ativo,
      permissoes: [delivery.pode_listar_pedidos && 'pedidos.listar', delivery.pode_receber_notificacoes && 'notificacoes.receber'].filter(Boolean),
    });
}

export async function deliverPushToProvider(delivery, { sendNotification, decrypt }) {
  if (!delivery.subscription_ativa || !isDeliveryAuthorized(delivery)) return { sent: false, reason: 'unauthorized' };
  await sendNotification(
    { endpoint: delivery.endpoint, keys: { p256dh: decrypt(delivery.p256dh), auth: decrypt(delivery.auth) } },
    JSON.stringify({ title: delivery.titulo, body: delivery.corpo, url: `/admin/pedidos/${delivery.pedido_id}`, event_id: delivery.dedup_key }),
    { TTL: 300 },
  );
  return { sent: true };
}

export async function processNextPush(db = getDb(), dependencies = {}) {
  const configuration = dependencies.configuration ?? pushConfiguration();
  if (!configuration.habilitado) return { processed: false, reason: 'disabled' };
  if (!dependencies.sendNotification) configure();
  const sendNotification = dependencies.sendNotification ?? ((subscription, payload, options) => webpush.sendNotification(subscription, payload, options));
  const decrypt = dependencies.decrypt ?? ((value) => decryptPushSecret(value, env.PUSH_ENCRYPTION_KEY));
  await db('entregas_push').where({ status: 'PENDENTE' }).where('tentativas', '>=', env.PUSH_MAX_ATTEMPTS).where('proxima_tentativa_em', '<=', db.fn.now())
    .update({ status: 'DESCARTADO', ultimo_erro_sanitizado: 'Limite de tentativas excedido', atualizado_em: db.fn.now() });
  return db.transaction(async (trx) => {
    const query = trx('entregas_push as e').join('notificacoes as n', 'n.id', 'e.notificacao_id').join('push_subscriptions as s', 's.id', 'e.subscription_id')
      .join('pedidos as p', 'p.id', 'n.pedido_id').modify(applyOperationalFilter, 'p')
      .leftJoin('usuarios as u', 'u.id', 's.usuario_id').leftJoin('niveis_acesso as na', 'na.id', 'u.nivel_acesso_id')
      .where({ 'e.status': 'PENDENTE' }).where('e.proxima_tentativa_em', '<=', trx.fn.now()).where('e.tentativas', '<', env.PUSH_MAX_ATTEMPTS)
      .select('e.*', 'n.titulo', 'n.corpo', 'n.pedido_id', 'n.dedup_key', 'n.usuario_id as notificacao_usuario_id',
        's.usuario_id as subscription_usuario_id', 's.ativo as subscription_ativa', 's.endpoint', 's.p256dh', 's.auth',
        'u.ativo as usuario_ativo', 'u.deletado_em as usuario_deletado_em', 'na.nome as nivel', 'na.ativo as nivel_ativo')
      .select(trx.raw("EXISTS (SELECT 1 FROM permissoes_usuarios pu JOIN permissoes p ON p.id = pu.permissao_id WHERE pu.usuario_id = s.usuario_id AND p.nome = 'pedidos.listar') AS pode_listar_pedidos"))
      .select(trx.raw("EXISTS (SELECT 1 FROM permissoes_usuarios pu JOIN permissoes p ON p.id = pu.permissao_id WHERE pu.usuario_id = s.usuario_id AND p.nome = 'notificacoes.receber') AS pode_receber_notificacoes"))
      .orderBy('e.proxima_tentativa_em');
    const candidate = await query.clone().first();
    if (!candidate) return { processed: false, reason: 'empty' };
    const current = await trx('pedidos').where({ id: candidate.pedido_id }).forUpdate().skipLocked().first();
    if (!current || !isOperationallyReleased(current)) return { processed: false, reason: 'order_unavailable' };
    const row = await query.where('e.id', candidate.id).forUpdate('e', 's').skipLocked().first();
    if (!row) return { processed: false, reason: 'empty' };
    if (!row.subscription_ativa || !isDeliveryAuthorized(row)) {
      await trx('entregas_push').where({ id: row.id }).update({ status: 'DESCARTADO', ultimo_erro_sanitizado: 'Destinatario sem autorizacao vigente', atualizado_em: trx.fn.now() });
      return { processed: true, status: 'DESCARTADO' };
    }
    await trx('entregas_push').where({ id: row.id }).update({ status: 'PENDENTE', tentativas: row.tentativas + 1, proxima_tentativa_em: new Date(Date.now() + 5 * 60000), atualizado_em: trx.fn.now() });
    const delivery = { ...row, tentativas: row.tentativas + 1 };
    try {
      await deliverPushToProvider(delivery, { sendNotification, decrypt });
      await trx('entregas_push').where({ id: delivery.id }).update({ status: 'ENVIADO', ultimo_erro_sanitizado: null, atualizado_em: trx.fn.now() });
      await trx('push_subscriptions').where({ id: delivery.subscription_id, usuario_id: delivery.notificacao_usuario_id }).update({ ultimo_sucesso_em: trx.fn.now(), atualizado_em: trx.fn.now() });
      return { processed: true, status: 'ENVIADO' };
    } catch (error) {
      const gone = error.statusCode === 404 || error.statusCode === 410;
      const exhausted = delivery.tentativas >= env.PUSH_MAX_ATTEMPTS;
      const status = gone || exhausted ? 'DESCARTADO' : 'PENDENTE';
      const backoffMinutes = Math.min(60, 2 ** delivery.tentativas);
      await trx('entregas_push').where({ id: delivery.id }).update({ status, proxima_tentativa_em: new Date(Date.now() + backoffMinutes * 60000), ultimo_erro_sanitizado: `HTTP ${error.statusCode ?? 'erro transitorio'}`.slice(0, 500), atualizado_em: trx.fn.now() });
      await trx('push_subscriptions').where({ id: delivery.subscription_id }).update({ ativo: gone ? false : true, ultima_falha_em: trx.fn.now(), atualizado_em: trx.fn.now() });
      if (gone) await trx('entregas_push').where({ subscription_id: delivery.subscription_id, status: 'PENDENTE' }).whereNot({ id: delivery.id })
        .update({ status: 'DESCARTADO', ultimo_erro_sanitizado: 'Endpoint invalidado pelo provedor', atualizado_em: trx.fn.now() });
      return { processed: true, status };
    }
  });
}

export function startPushWorker() {
  if (!pushConfiguration().habilitado || !env.DATABASE_URL || timer) {
    if (!pushConfiguration().habilitado) logger.warn('Web Push desabilitado: pedidos continuarao funcionando com inbox e Socket.IO.');
    else if (!env.DATABASE_URL) logger.warn('Worker Web Push aguardando configuracao do banco.');
    return;
  }
  const run = async () => { try { for (let index = 0; index < 20; index += 1) { const result = await processNextPush(); if (!result.processed) break; } } catch (error) { logger.error({ err: error }, 'Falha no worker Web Push'); } };
  timer = setInterval(run, env.PUSH_POLL_INTERVAL_MS);
  timer.unref();
  run();
}

export function stopPushWorker() { if (timer) clearInterval(timer); timer = undefined; }
