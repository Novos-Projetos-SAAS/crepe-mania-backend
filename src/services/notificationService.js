import { getDb } from '../database/connection.js';
import { AppError } from '../utils/AppError.js';
import { auditService } from './auditService.js';
import { env } from '../config/env.js';
import { decodeAes256Key, encryptPushSecret } from '../utils/crypto.js';
import { assertNotificationAccess } from './notificationAccess.js';
import { isOperationallyReleased } from '../payments/orderPaymentPolicy.js';

export class NotificationService {
  constructor(dbProvider = getDb, { config = env, audit = auditService } = {}) {
    this.dbProvider = dbProvider;
    this.config = config;
    this.audit = audit;
  }

  async createNewOrderNotifications(trx, order) {
    const current = await trx('pedidos').where({ id: order.id }).forUpdate().first();
    if (!current || !isOperationallyReleased(current)) return [];
    const users = await trx('usuarios as u').join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id')
      .where({ 'u.ativo': true, 'n.ativo': true }).whereNull('u.deletado_em')
      .andWhere((builder) => builder.where('n.nome', 'admin').orWhere((allowed) => allowed
        .whereExists(trx('permissoes_usuarios as pu').join('permissoes as p', 'p.id', 'pu.permissao_id')
          .whereRaw('pu.usuario_id = u.id').where('p.nome', 'pedidos.listar').select(trx.raw('1')))
        .whereExists(trx('permissoes_usuarios as pu').join('permissoes as p', 'p.id', 'pu.permissao_id')
          .whereRaw('pu.usuario_id = u.id').where('p.nome', 'notificacoes.receber').select(trx.raw('1')))))
      .distinct('u.id');
    const notifiedUserIds = [];
    for (const user of users) {
      const [notification] = await trx('notificacoes').insert({
        usuario_id: user.id,
        tipo: 'NOVO_PEDIDO',
        titulo: 'Novo pedido recebido',
        corpo: `Pedido #${order.id} aguardando atendimento.`,
        pedido_id: order.id,
        dedup_key: `pedido:${order.id}:novo`,
      }).onConflict(['usuario_id', 'dedup_key']).ignore().returning('*');
      if (!notification) continue;
      notifiedUserIds.push(String(user.id));
      const subscriptions = await trx('push_subscriptions').where({ usuario_id: user.id, ativo: true });
      if (subscriptions.length) await trx('entregas_push').insert(subscriptions.map((subscription) => ({ notificacao_id: notification.id, subscription_id: subscription.id })));
    }
    return notifiedUserIds;
  }

  async list(userId, { page = 1, limit = 10 } = {}) {
    const db = this.dbProvider();
    const query = db('notificacoes').where({ usuario_id: userId });
    const [{ total }] = await query.clone().count('* as total');
    const items = await query.select('*').orderBy([{ column: 'criado_em', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(limit).offset((page - 1) * limit);
    return { items, total: Number(total) };
  }

  async unreadCount(userId) {
    const [{ total }] = await this.dbProvider()('notificacoes').where({ usuario_id: userId }).whereNull('lida_em').count('* as total');
    return Number(total);
  }

  async markRead(userId, id) {
    const [row] = await this.dbProvider()('notificacoes').where({ id, usuario_id: userId }).update({ lida_em: this.dbProvider().fn.now() }).returning('*');
    if (!row) throw new AppError('Notificacao nao encontrada.', 404, 'NOTIFICATION_NOT_FOUND');
    return row;
  }

  async subscribe(userId, data, context) {
    const db = this.dbProvider();
    const config = this.config;
    if (!config.PUSH_ENABLED || !config.PUSH_ENCRYPTION_KEY || !config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) {
      throw new AppError('Web Push ainda nao configurado.', 503, 'PUSH_NOT_CONFIGURED');
    }
    try { decodeAes256Key(config.PUSH_ENCRYPTION_KEY); } catch { throw new AppError('Criptografia Web Push nao configurada corretamente.', 503, 'PUSH_NOT_CONFIGURED'); }
    return db.transaction(async (trx) => {
      await assertNotificationAccess(trx, userId);
      const encryptedKeys = { p256dh: encryptPushSecret(data.keys.p256dh, config.PUSH_ENCRYPTION_KEY), auth: encryptPushSecret(data.keys.auth, config.PUSH_ENCRYPTION_KEY) };
      const existing = await trx('push_subscriptions').where({ endpoint: data.endpoint }).forUpdate().first();
      let row;
      if (existing) {
        if (subscriptionRegistrationMode(existing, userId) === 'TRANSFERIR') {
          await trx('entregas_push').where({ subscription_id: existing.id, status: 'PENDENTE' })
            .update({ status: 'DESCARTADO', ultimo_erro_sanitizado: 'Subscription transferida para outro usuario', atualizado_em: trx.fn.now() });
        }
        [row] = await trx('push_subscriptions').where({ id: existing.id }).update({
          usuario_id: userId, ...encryptedKeys, expiration_time: data.expirationTime,
          dispositivo_nome: data.dispositivo_nome, ativo: true, ultimo_sucesso_em: null,
          ultima_falha_em: null, atualizado_em: trx.fn.now(),
        }).returning(['id', 'dispositivo_nome', 'ativo', 'criado_em']);
      } else {
        [row] = await trx('push_subscriptions').insert({
          usuario_id: userId, endpoint: data.endpoint, ...encryptedKeys,
          expiration_time: data.expirationTime, dispositivo_nome: data.dispositivo_nome, ativo: true,
        }).returning(['id', 'dispositivo_nome', 'ativo', 'criado_em']);
      }
      await this.audit.registrar({ trx, usuarioId: userId, acao: 'PUSH.INSCRICAO', descricao: 'Dispositivo registrado para notificacoes', recursoTipo: 'push_subscription', recursoId: row.id, ...context, payload: { dispositivo_nome: data.dispositivo_nome } });
      return row;
    });
  }

  async unsubscribe(userId, endpoint, context) {
    const db = this.dbProvider();
    return db.transaction(async (trx) => {
      const subscription = await trx('push_subscriptions').where({ usuario_id: userId, endpoint }).forUpdate().first();
      if (!subscription) return false;
      await trx('entregas_push').where({ subscription_id: subscription.id, status: 'PENDENTE' })
        .update({ status: 'DESCARTADO', ultimo_erro_sanitizado: 'Subscription removida pelo usuario', atualizado_em: trx.fn.now() });
      const [row] = await trx('push_subscriptions').where({ id: subscription.id }).update({ ativo: false, atualizado_em: trx.fn.now() }).returning(['id']);
      if (row) await this.audit.registrar({ trx, usuarioId: userId, acao: 'PUSH.REMOVER_INSCRICAO', descricao: 'Dispositivo removido das notificacoes', recursoTipo: 'push_subscription', recursoId: row.id, ...context });
      return Boolean(row);
    });
  }
}

export const notificationService = new NotificationService();

export function subscriptionRegistrationMode(existing, userId) {
  if (!existing) return 'CRIAR';
  return String(existing.usuario_id) === String(userId) ? 'ATUALIZAR' : 'TRANSFERIR';
}
