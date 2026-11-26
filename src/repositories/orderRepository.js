import { getDb } from '../database/connection.js';
import { applyOperationalFilter } from '../payments/orderPaymentPolicy.js';

export class OrderRepository {
    constructor(db) { this.db = db; }
    get database() { return this.db ?? getDb(); }

    async insertOrder(data, trx) { const [row] = await trx('pedidos').insert(data).returning('*'); return row; }
    async insertItems(orderId, items, trx) {
        for (const item of items) {
            const { adicionais, ...data } = item;
            const [row] = await trx('itens_pedido').insert({ pedido_id: orderId, ...data }).returning('*');
            if (adicionais.length) await trx('itens_pedido_adicionais').insert(adicionais.map((extra) => ({ item_pedido_id: row.id, ...extra })));
        }
    }

    async detail(id, trx = this.database, lock = false) {
        const query = trx('pedidos').where({ id });
        const order = await (lock ? query.forUpdate() : query).first();
        if (!order) return null;
        const itemQuery = () => trx('itens_pedido').where({ pedido_id: id }).orderBy('id');
        const extraQuery = () => trx('itens_pedido_adicionais as a').join('itens_pedido as i', 'i.id', 'a.item_pedido_id').where('i.pedido_id', id).select('a.*').orderBy('a.id');
        const historyQuery = () => trx('historico_status_pedidos').where({ pedido_id: id }).orderBy('criado_em');
        let items;
        let extras;
        let history;
        if (trx.isTransaction) {
            items = await itemQuery();
            extras = await extraQuery();
            history = await historyQuery();
        } else {
            [items, extras, history] = await Promise.all([itemQuery(), extraQuery(), historyQuery()]);
        }
        let confirmedMethod = null;
        if (order.confirmacao_liberacao_id) {
            const payment = await trx('infinitepay_confirmacoes as c').join('infinitepay_transacoes as t', 't.id', 'c.transacao_id').where({ 'c.id': order.confirmacao_liberacao_id, 'c.pedido_id': order.id, 'c.elegivel': true }).first('t.capture_method');
            confirmedMethod = payment?.capture_method === 'pix' ? 'Pix (InfinitePay)' : payment?.capture_method === 'credit_card' ? 'Cartao de credito (InfinitePay)' : null;
        }
        return { ...order, metodo_pagamento_confirmado_nome: confirmedMethod, itens: items.map((item) => ({ ...item, adicionais: extras.filter((extra) => String(extra.item_pedido_id) === String(item.id)) })), historico: history };
    }

    async list(filters) {
        const { page = 1, limit = 10, status, status_pagamento, metodo_pagamento_id, tipo_entrega, busca, data_inicio, data_fim, order = 'desc' } = filters;
        const query = this.database('pedidos');
        applyOperationalFilter(query);
        if (status) query.where({ status });
        if (status_pagamento) query.where({ status_pagamento });
        if (metodo_pagamento_id) query.where({ metodo_pagamento_id });
        if (tipo_entrega) query.where({ tipo_entrega });
        if (busca) query.where((builder) => builder.whereILike('cliente_nome', `%${busca}%`).orWhere('cliente_telefone', 'like', `%${String(busca).replace(/\D/g, '')}%`));
        if (data_inicio) query.where('criado_em', '>=', data_inicio);
        if (data_fim) query.where('criado_em', '<', data_fim);
        const [{ total }] = await query.clone().clearSelect().clearOrder().count('* as total');
        const direction = order === 'asc' ? 'asc' : 'desc';
        const items = await query.select('*').orderBy([{ column: 'criado_em', order: direction }, { column: 'id', order: direction }]).limit(limit).offset((page - 1) * limit);
        return { items, total: Number(total) };
    }

    async replaceItems(orderId, items, trx) {
        await trx('itens_pedido').where({ pedido_id: orderId }).delete();
        await this.insertItems(orderId, items, trx);
    }

    async updateOrder(id, version, data, trx) {
        const [row] = await trx('pedidos').where({ id, versao: version }).update({ ...data, versao: version + 1, atualizado_em: trx.fn.now() }).returning('*');
        return row;
    }

    addHistory(data, trx) { return trx('historico_status_pedidos').insert(data); }
}
