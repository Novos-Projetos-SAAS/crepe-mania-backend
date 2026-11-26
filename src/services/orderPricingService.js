import { AppError } from '../utils/AppError.js';
import { addCents, centsToDecimal, decimalToCents, multiplyCents } from '../utils/money.js';
import { normalizeText } from '../utils/sanitize.js';

const sameId = (left, right) => String(left) === String(right);

export function normalizePhone(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) throw new AppError('Telefone invalido.', 422, 'INVALID_PHONE');
  return digits;
}

export function priceOrder(input, catalog, storeConfig) {
  if (input.tipo_entrega === 'ENTREGA' && (!input.endereco?.logradouro || (!input.endereco?.numero && !input.endereco?.sem_numero) || !input.endereco?.bairro || !input.endereco?.cidade || !input.endereco?.uf)) {
    throw new AppError('Endereco completo obrigatorio para entrega.', 422, 'ADDRESS_REQUIRED');
  }
  if (input.tipo_entrega === 'RETIRADA' && input.endereco) throw new AppError('Endereco nao deve ser enviado para retirada.', 422, 'ADDRESS_NOT_ALLOWED');
  if (!catalog.paymentMethod) throw new AppError('Metodo de pagamento indisponivel.', 422, 'PAYMENT_METHOD_UNAVAILABLE');
  const snapshots = input.itens.map((requested) => {
    const product = catalog.products.find((item) => sameId(item.id, requested.produto_id));
    if (!product || !product.ativo || !product.disponivel_hoje || product.deletado_em || !product.categoria_ativa || product.categoria_deletada_em || product.preco_base == null) {
      throw new AppError(`Produto ${requested.produto_id} indisponivel.`, 422, 'PRODUCT_UNAVAILABLE');
    }
    const ids = requested.adicionais.map((item) => String(item.adicional_id));
    if (new Set(ids).size !== ids.length) throw new AppError('Adicional repetido no mesmo item.', 422, 'DUPLICATE_ADDITIONAL');
    const extras = requested.adicionais.map((requestedExtra) => {
      const extra = catalog.additionals.find((item) => sameId(item.produto_id, product.id) && sameId(item.id, requestedExtra.adicional_id));
      if (!extra || !extra.vinculo_ativo || !extra.ativo || !extra.disponivel_hoje || extra.deletado_em) throw new AppError(`Adicional ${requestedExtra.adicional_id} indisponivel para ${product.nome}.`, 422, 'ADDITIONAL_UNAVAILABLE');
      if (requestedExtra.quantidade > extra.max_quantidade_por_item) throw new AppError(`Quantidade de ${extra.nome} excede o limite.`, 422, 'ADDITIONAL_LIMIT');
      const unitCents = decimalToCents(extra.preco, 'preco do adicional');
      return {
        adicional_id: extra.id,
        nome_snapshot: extra.nome,
        quantidade_por_unidade: requestedExtra.quantidade,
        preco_unitario_snapshot: centsToDecimal(unitCents),
        subtotal: centsToDecimal(multiplyCents(unitCents, requestedExtra.quantidade * requested.quantidade)),
        centsPerProduct: multiplyCents(unitCents, requestedExtra.quantidade),
      };
    });
    const baseCents = decimalToCents(product.preco_base, 'preco do produto');
    const unitCents = addCents(baseCents, ...extras.map((extra) => extra.centsPerProduct));
    const subtotalCents = multiplyCents(unitCents, requested.quantidade);
    return {
      produto_id: product.id,
      produto_nome_snapshot: product.nome,
      categoria_nome_snapshot: product.categoria_nome,
      tipo_produto_snapshot: product.tipo,
      quantidade: requested.quantidade,
      preco_base_snapshot: centsToDecimal(baseCents),
      preco_unitario: centsToDecimal(unitCents),
      subtotal: centsToDecimal(subtotalCents),
      observacoes: normalizeText(requested.observacoes) || null,
      adicionais: extras.map(({ centsPerProduct: _, ...extra }) => extra),
      subtotalCents,
    };
  });
  const subtotalCents = addCents(...snapshots.map((item) => item.subtotalCents));
  const deliveryCents = input.tipo_entrega === 'ENTREGA' ? decimalToCents(storeConfig.taxa_entrega, 'taxa de entrega') : 0;
  const totalCents = addCents(subtotalCents, deliveryCents);
  let changeFor = null;
  let changeAmount = null;
  if (input.precisa_troco) {
    if (catalog.paymentMethod.codigo !== 'DINHEIRO') throw new AppError('Troco permitido somente para pagamento em dinheiro.', 422, 'CHANGE_NOT_ALLOWED');
    const requestedChange = decimalToCents(input.troco_para, 'troco_para');
    if (requestedChange == null || requestedChange <= totalCents) throw new AppError('troco_para deve ser maior que o total.', 422, 'INVALID_CHANGE');
    changeFor = centsToDecimal(requestedChange);
    changeAmount = centsToDecimal(requestedChange - totalCents);
  } else if (input.troco_para != null) {
    throw new AppError('Nao informe troco_para sem solicitar troco.', 422, 'INVALID_CHANGE');
  }
  return {
    items: snapshots.map(({ subtotalCents: _, ...item }) => item),
    subtotal: centsToDecimal(subtotalCents),
    deliveryFee: centsToDecimal(deliveryCents),
    discount: '0.00',
    total: centsToDecimal(totalCents),
    changeFor,
    changeAmount,
    paymentMethod: catalog.paymentMethod,
  };
}
