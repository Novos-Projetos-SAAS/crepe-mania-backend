import { randomUUID } from 'node:crypto';
import { getDb } from '../database/connection.js';
import { isOperationallyReleased } from '../payments/orderPaymentPolicy.js';

const QUEUES = new Set(['infinitepay_inbox', 'eventos_outbox']);

export class InfinitepayRepository {
  constructor(db) { this.db = db; }
  get database() { return this.db ?? getDb(); }
  configuration(trx = this.database, lock = false) { const query = trx('infinitepay_configuracoes').where({ id: 1 }); return (lock ? query.forUpdate() : query).first(); }
  ensureConfiguration(trx) { return trx('infinitepay_configuracoes').insert({ id: 1 }).onConflict('id').ignore(); }
  credential(id, trx = this.database) { return trx('infinitepay_credenciais').where({ id }).first(); }
  async insertCredential(data, trx) { const [row] = await trx('infinitepay_credenciais').insert(data).returning('*'); return row; }
  async updateConfiguration(data, trx) { const [row] = await trx('infinitepay_configuracoes').where({ id: 1 }).update({ ...data, atualizado_em: trx.fn.now() }).returning('*'); return row; }
  order(id, trx = this.database, lock = false) { const query = trx('pedidos').where({ id }); return (lock ? query.forUpdate() : query).first(); }
  orderByCode(code) { return this.database('pedidos').where({ codigo_acompanhamento: code }).first(); }
  attempt(id, trx = this.database, lock = false) { const query = trx('infinitepay_tentativas').where({ id }); return (lock ? query.forUpdate() : query).first(); }
  attemptForOrder(id, trx = this.database) { return trx('infinitepay_tentativas').where({ pedido_id: id }).first(); }
  attemptByNsu(nsu) { return this.database('infinitepay_tentativas').where({ order_nsu: nsu }).first(); }
  pendingCheckout() { return this.database('infinitepay_tentativas').where({ estado: 'AGUARDANDO_CRIACAO' }).where('valid_until', '>', this.database.fn.now()).orderBy('criado_em').first('id'); }
  async insertAttempt(data, trx) { const [row] = await trx('infinitepay_tentativas').insert(data).returning('*'); return row; }
  async updateAttempt(id, data, trx = this.database) { const [row] = await trx('infinitepay_tentativas').where({ id }).update({ ...data, atualizado_em: trx.fn.now() }).returning('*'); return row; }

  async claimCheckout(id) {
    const known = await this.attempt(id);
    if (!known) return null;
    return this.database.transaction(async (trx) => {
      const order = await this.order(known.pedido_id, trx, true);
      const row = await this.attempt(id, trx, true);
      if (row.estado !== 'AGUARDANDO_CRIACAO') return null;
      if (order.status === 'CANCELADO') { await this.updateAttempt(id, { estado: 'EXPIRADO', ultimo_erro: 'ORDER_CANCELED' }, trx); return null; }
      return this.updateAttempt(id, { estado: 'CRIANDO', criacao_iniciada_em: trx.fn.now() }, trx);
    });
  }

  transactionByNsu(nsu, trx = this.database) { return trx('infinitepay_transacoes').where({ transaction_nsu: nsu }).first(); }
  transactionForAttempt(id) { return this.database('infinitepay_transacoes').where({ tentativa_id: id, classificacao: 'ELEGIVEL' }).first(); }
  async insertTransaction(data, trx) { const [row] = await trx('infinitepay_transacoes').insert(data).onConflict('transaction_nsu').ignore().returning('*'); return row; }
  async insertConfirmation(data, trx) { const [row] = await trx('infinitepay_confirmacoes').insert(data).returning('*'); return row; }

  async enqueueSignal(data) {
    const [row] = await this.database('infinitepay_inbox').insert(data).onConflict('dedup_key').ignore().returning('*');
    if (row) return row;
    const existing = await this.database('infinitepay_inbox').where({ dedup_key: data.dedup_key }).first();
    if (data.origem === 'ADMIN' && existing.estado === 'FALHOU') {
      await this.database('infinitepay_inbox').where({ id: existing.id, estado: 'FALHOU' }).update({ estado: 'PENDENTE', tentativas: 0, ultimo_erro: null, disponivel_em: this.database.fn.now(), atualizado_em: this.database.fn.now() });
    }
    return existing;
  }

  async queueParent(table, row, trx) {
    return table === 'eventos_outbox' ? row.pedido_id : (await this.attempt(row.tentativa_id, trx)).pedido_id;
  }

  async claimQueue(table, id) {
    if (!QUEUES.has(table)) throw new Error('Fila invalida');
    const db = this.database;
    const due = (query) => query.where((pending) => pending.where({ estado: 'PENDENTE' }).where('disponivel_em', '<=', db.fn.now()))
      .orWhere((expired) => expired.where({ estado: 'PROCESSANDO' }).where('lease_ate', '<', db.fn.now()));
    const candidates = db(table).where(due);
    if (id) candidates.where({ id });
    const candidate = await candidates.orderBy('criado_em').first();
    if (!candidate) return null;
    return db.transaction(async (trx) => {
      const order = await this.order(await this.queueParent(table, candidate, trx), trx, true);
      const row = await trx(table).where({ id: candidate.id }).where(due).forUpdate().skipLocked().first();
      if (!row) return null;
      if (table === 'eventos_outbox' && (!order || !isOperationallyReleased(order))) {
        await trx(table).where({ id: row.id }).update({ estado: 'CONCLUIDO', lease_token: null, lease_ate: null, ultimo_erro: 'ORDER_NOT_OPERATIONAL', atualizado_em: trx.fn.now() });
        return null;
      }
      if (row.tentativas >= 5) {
        await trx(table).where({ id: row.id }).update({ estado: 'FALHOU', lease_token: null, lease_ate: null, ultimo_erro: 'RETRY_EXHAUSTED', atualizado_em: trx.fn.now() });
        return null;
      }
      const [claimed] = await trx(table).where({ id: row.id }).update({ estado: 'PROCESSANDO', tentativas: row.tentativas + 1, lease_token: randomUUID(), lease_ate: new Date(Date.now() + 30000), atualizado_em: trx.fn.now() }).returning('*');
      return claimed;
    });
  }

  async updateQueue(table, row, patch) {
    if (!QUEUES.has(table)) throw new Error('Fila invalida');
    return this.database.transaction(async (trx) => {
      const order = await this.order(await this.queueParent(table, row, trx), trx, true);
      const safePatch = table === 'eventos_outbox' && (!order || !isOperationallyReleased(order)) ? { ...patch, estado: 'CONCLUIDO', lease_token: null, lease_ate: null, ultimo_erro: 'ORDER_NOT_OPERATIONAL' } : patch;
      return trx(table).where({ id: row.id, lease_token: row.lease_token, estado: 'PROCESSANDO' }).update({ ...safePatch, atualizado_em: trx.fn.now() });
    });
  }

  finishQueue(table, row, result) {
    return this.updateQueue(table, row, { estado: 'CONCLUIDO', lease_token: null, lease_ate: null, ultimo_erro: null, ...(table === 'infinitepay_inbox' ? { resultado_json: result } : {}) });
  }

  failQueue(table, row, code, permanent = false) {
    return this.updateQueue(table, row, { estado: permanent || row.tentativas >= 5 ? 'FALHOU' : 'PENDENTE', lease_token: null, lease_ate: null, ultimo_erro: code, disponivel_em: new Date(Date.now() + Math.min(300000, 5000 * 2 ** row.tentativas)) });
  }

  async maintainAttempts() {
    const db = this.database;
    const candidates = await db('infinitepay_tentativas').where((query) => query.where((stalled) => stalled.where({ estado: 'CRIANDO' }).where('criacao_iniciada_em', '<', new Date(Date.now() - 60000))).orWhere((expired) => expired.whereIn('estado', ['AGUARDANDO_PAGAMENTO', 'AGUARDANDO_CRIACAO']).where('valid_until', '<', db.fn.now()))).orderBy('criado_em').limit(100).select('id', 'pedido_id');
    for (const candidate of candidates) await db.transaction(async (trx) => {
      await this.order(candidate.pedido_id, trx, true);
      const row = await this.attempt(candidate.id, trx, true);
      const stalled = row.estado === 'CRIANDO' && new Date(row.criacao_iniciada_em).getTime() < Date.now() - 60000;
      const expired = ['AGUARDANDO_PAGAMENTO', 'AGUARDANDO_CRIACAO'].includes(row.estado) && new Date(row.valid_until) <= new Date();
      if (stalled) await this.updateAttempt(row.id, { estado: 'CRIACAO_INCERTA', ultimo_erro: 'CHECKOUT_INTERRUPTED' }, trx);
      else if (expired) await this.updateAttempt(row.id, { estado: 'EXPIRADO' }, trx);
    });
  }

  async listPayments({ page = 1, limit = 10, data_inicio, data_fim }) {
    const query = this.database('infinitepay_tentativas as a').join('pedidos as p', 'p.id', 'a.pedido_id');
    if (data_inicio) query.where('a.criado_em', '>=', data_inicio);
    if (data_fim) query.where('a.criado_em', '<', data_fim);
    const [{ total }] = await query.clone().count('* as total');
    const items = await query.select('a.id', 'a.pedido_id', 'a.order_nsu', 'a.estado', 'a.valor_centavos', 'a.valid_until', 'a.criado_em', 'p.status', 'p.liberado_operacionalmente_em').orderBy('a.criado_em', 'desc').limit(limit).offset((page - 1) * limit);
    if (items.length) {
      const transactions = await this.database('infinitepay_transacoes').whereIn('tentativa_id', items.map((item) => item.id)).select('id', 'tentativa_id', 'transaction_nsu', 'amount', 'paid_amount', 'capture_method', 'installments', 'classificacao', 'provider_verified_at', 'receipt_url');
      const signals = await this.database('infinitepay_inbox').whereIn('tentativa_id', items.map((item) => item.id)).select('id', 'tentativa_id', 'event_type', 'estado', 'ultimo_erro', 'criado_em', 'resultado_json').orderBy('criado_em', 'desc');
      for (const item of items) { item.transacoes = transactions.filter((row) => row.tentativa_id === item.id); item.sinais = signals.filter((row) => row.tentativa_id === item.id); }
    }
    return { items, total: Number(total) };
  }
}
