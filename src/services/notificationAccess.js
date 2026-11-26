import { AppError } from '../utils/AppError.js';

export function canReceiveNotifications(recipient) {
  if (!recipient || !recipient.ativo || recipient.deletado_em || recipient.nivel_ativo === false) return false;
  if (recipient.nivel === 'admin') return true;
  const permissions = recipient.permissoes ?? [];
  return permissions.includes('pedidos.listar') && permissions.includes('notificacoes.receber');
}

export async function loadNotificationRecipient(trx, userId) {
  const user = await trx('usuarios as u')
    .join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id')
    .where('u.id', userId)
    .select('u.id', 'u.ativo', 'u.deletado_em', 'n.nome as nivel', 'n.ativo as nivel_ativo')
    .first();
  if (!user) return null;
  const rows = await trx('permissoes_usuarios as pu')
    .join('permissoes as p', 'p.id', 'pu.permissao_id')
    .where('pu.usuario_id', userId)
    .select('p.nome');
  return { ...user, permissoes: rows.map((row) => row.nome) };
}

export async function assertNotificationAccess(trx, userId) {
  const recipient = await loadNotificationRecipient(trx, userId);
  if (!canReceiveNotifications(recipient)) throw new AppError('Usuario nao autorizado a receber notificacoes.', 403, 'NOTIFICATION_ACCESS_REVOKED');
  return recipient;
}

export async function revokeNotificationAccess(trx, userId, reason = 'Acesso a notificacoes revogado') {
  const subscriptions = await trx('push_subscriptions').where({ usuario_id: userId }).forUpdate().select('id');
  const ids = subscriptions.map((row) => row.id);
  if (ids.length) {
    await trx('entregas_push').whereIn('subscription_id', ids).where({ status: 'PENDENTE' })
      .update({ status: 'DESCARTADO', ultimo_erro_sanitizado: reason.slice(0, 500), atualizado_em: trx.fn.now() });
    await trx('push_subscriptions').whereIn('id', ids)
      .update({ ativo: false, atualizado_em: trx.fn.now() });
  }
  return ids.length;
}
