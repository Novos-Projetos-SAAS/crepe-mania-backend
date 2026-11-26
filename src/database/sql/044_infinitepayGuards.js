export const INFINITEPAY_GUARDS_SQL = `
CREATE OR REPLACE FUNCTION public.fn_infinitepay_prova_elegivel(p_pedido_id bigint, p_confirmacao_id uuid, p_total numeric)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.infinitepay_confirmacoes c
    JOIN public.infinitepay_transacoes t ON t.id = c.transacao_id
    JOIN public.infinitepay_tentativas a ON a.id = c.tentativa_id AND t.tentativa_id = a.id
    WHERE c.id = p_confirmacao_id AND c.elegivel
      AND c.pedido_id = p_pedido_id AND t.pedido_id = p_pedido_id AND a.pedido_id = p_pedido_id
      AND t.classificacao = 'ELEGIVEL' AND t.provider_verified_at IS NOT NULL
      AND t.amount = p_total * 100 AND t.amount = a.valor_centavos AND t.paid_amount >= t.amount
      AND jsonb_exists(a.metodos_permitidos, lower(t.capture_method))
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_infinitepay_credencial_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INFINITEPAY_CREDENCIAL_IMUTAVEL' USING ERRCODE = '23514';
  END IF;
  IF ROW(OLD.id, OLD.handle, OLD.api_key_ciphertext, OLD.key_version, OLD.criado_em)
     IS DISTINCT FROM ROW(NEW.id, NEW.handle, NEW.api_key_ciphertext, NEW.key_version, NEW.criado_em) THEN
    RAISE EXCEPTION 'INFINITEPAY_CREDENCIAL_IMUTAVEL' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_credencial_imutavel BEFORE UPDATE OR DELETE ON public.infinitepay_credenciais
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_credencial_imutavel();

CREATE OR REPLACE FUNCTION public.fn_infinitepay_configuracao_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.credencial_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.infinitepay_credenciais WHERE id = NEW.credencial_id AND handle = NEW.handle
  ) THEN
    RAISE EXCEPTION 'INFINITEPAY_CREDENCIAL_HANDLE_DIVERGENTE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_configuracao_guard BEFORE INSERT OR UPDATE ON public.infinitepay_configuracoes
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_configuracao_guard();

CREATE OR REPLACE FUNCTION public.fn_infinitepay_pedido_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.fluxo_pagamento = 'INFINITEPAY' THEN
      RAISE EXCEPTION 'INFINITEPAY_HISTORICO_IMUTAVEL' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.fluxo_pagamento IS DISTINCT FROM NEW.fluxo_pagamento THEN
    RAISE EXCEPTION 'INFINITEPAY_FLUXO_IMUTAVEL' USING ERRCODE = '23514';
  END IF;
  IF NEW.fluxo_pagamento = 'TRADICIONAL' THEN
    IF TG_OP = 'INSERT' THEN NEW.liberado_operacionalmente_em := NEW.criado_em; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD.id, OLD.codigo_acompanhamento, OLD.canal_pedido, OLD.cliente_nome, OLD.cliente_telefone,
           OLD.tipo_entrega, OLD.endereco_logradouro, OLD.endereco_numero, OLD.endereco_sem_numero,
           OLD.endereco_bairro, OLD.endereco_cidade, OLD.endereco_uf, OLD.endereco_complemento, OLD.endereco_referencia,
           OLD.metodo_pagamento_id, OLD.metodo_pagamento_nome_snapshot, OLD.subtotal, OLD.taxa_entrega, OLD.desconto,
           OLD.total, OLD.precisa_troco, OLD.troco_para, OLD.troco_previsto, OLD.observacoes, OLD.criado_em)
       IS DISTINCT FROM
       ROW(NEW.id, NEW.codigo_acompanhamento, NEW.canal_pedido, NEW.cliente_nome, NEW.cliente_telefone,
           NEW.tipo_entrega, NEW.endereco_logradouro, NEW.endereco_numero, NEW.endereco_sem_numero,
           NEW.endereco_bairro, NEW.endereco_cidade, NEW.endereco_uf, NEW.endereco_complemento, NEW.endereco_referencia,
           NEW.metodo_pagamento_id, NEW.metodo_pagamento_nome_snapshot, NEW.subtotal, NEW.taxa_entrega, NEW.desconto,
           NEW.total, NEW.precisa_troco, NEW.troco_para, NEW.troco_previsto, NEW.observacoes, NEW.criado_em) THEN
      RAISE EXCEPTION 'INFINITEPAY_PEDIDO_SNAPSHOT_IMUTAVEL' USING ERRCODE = '23514';
    END IF;
    IF OLD.liberado_operacionalmente_em IS NOT NULL AND (
      OLD.liberado_operacionalmente_em IS DISTINCT FROM NEW.liberado_operacionalmente_em
      OR OLD.confirmacao_liberacao_id IS DISTINCT FROM NEW.confirmacao_liberacao_id
    ) THEN
      RAISE EXCEPTION 'INFINITEPAY_LIBERACAO_IMUTAVEL' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'CANCELADO' AND NEW.status <> 'CANCELADO' THEN
      RAISE EXCEPTION 'INFINITEPAY_CANCELAMENTO_IRREVERSIVEL' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (NEW.confirmacao_liberacao_id IS NULL) <> (NEW.liberado_operacionalmente_em IS NULL) THEN
    RAISE EXCEPTION 'INFINITEPAY_LIBERACAO_SEM_PROVA' USING ERRCODE = '23514';
  END IF;
  IF NEW.confirmacao_liberacao_id IS NOT NULL THEN
    IF NOT public.fn_infinitepay_prova_elegivel(NEW.id, NEW.confirmacao_liberacao_id, NEW.total) THEN
      RAISE EXCEPTION 'INFINITEPAY_CONFIRMACAO_INVALIDA' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CANCELADO' AND (TG_OP = 'INSERT' OR OLD.liberado_operacionalmente_em IS NULL) THEN
      RAISE EXCEPTION 'INFINITEPAY_CANCELADO_NAO_LIBERAVEL' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (NEW.status NOT IN ('PENDENTE','CANCELADO') OR NEW.status_pagamento = 'PAGO')
     AND NEW.liberado_operacionalmente_em IS NULL THEN
    RAISE EXCEPTION 'INFINITEPAY_PEDIDO_NAO_LIBERADO' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_pedido_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_pedido_guard();

CREATE OR REPLACE FUNCTION public.fn_infinitepay_tentativa_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE p public.pedidos%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INFINITEPAY_TENTATIVA_IMUTAVEL' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO p FROM public.pedidos WHERE id = NEW.pedido_id FOR UPDATE;
  IF NOT FOUND OR p.fluxo_pagamento <> 'INFINITEPAY' OR NEW.valor_centavos <> p.total * 100 THEN
    RAISE EXCEPTION 'INFINITEPAY_TENTATIVA_PEDIDO_DIVERGENTE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.infinitepay_credenciais WHERE id = NEW.credencial_id AND handle = NEW.handle_snapshot
  ) THEN
    RAISE EXCEPTION 'INFINITEPAY_TENTATIVA_CREDENCIAL_DIVERGENTE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD.id, OLD.pedido_id, OLD.order_nsu, OLD.valor_centavos, OLD.metodos_permitidos,
           OLD.payload_json, OLD.payload_hash, OLD.credencial_id, OLD.handle_snapshot, OLD.criado_em)
       IS DISTINCT FROM
       ROW(NEW.id, NEW.pedido_id, NEW.order_nsu, NEW.valor_centavos, NEW.metodos_permitidos,
           NEW.payload_json, NEW.payload_hash, NEW.credencial_id, NEW.handle_snapshot, NEW.criado_em)
       OR OLD.valid_until IS DISTINCT FROM NEW.valid_until THEN
      RAISE EXCEPTION 'INFINITEPAY_TENTATIVA_SNAPSHOT_IMUTAVEL' USING ERRCODE = '23514';
    END IF;
    IF (OLD.checkout_url IS NOT NULL AND OLD.checkout_url IS DISTINCT FROM NEW.checkout_url)
       OR (OLD.criacao_iniciada_em IS NOT NULL AND OLD.criacao_iniciada_em IS DISTINCT FROM NEW.criacao_iniciada_em)
       OR (OLD.criacao_iniciada_em IS NOT NULL AND NEW.estado = 'AGUARDANDO_CRIACAO')
       OR (OLD.estado IN ('CRIACAO_INCERTA','AGUARDANDO_PAGAMENTO','PAGO_VERIFICADO','PAGO_EM_REVISAO','EXPIRADO') AND NEW.estado = 'CRIANDO') THEN
      RAISE EXCEPTION 'INFINITEPAY_RECRIACAO_PROIBIDA' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_tentativa_guard BEFORE INSERT OR UPDATE OR DELETE ON public.infinitepay_tentativas
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_tentativa_guard();

CREATE OR REPLACE FUNCTION public.fn_infinitepay_transacao_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE p public.pedidos%ROWTYPE; a public.infinitepay_tentativas%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'INFINITEPAY_TRANSACAO_IMUTAVEL' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO p FROM public.pedidos WHERE id = NEW.pedido_id FOR UPDATE;
  SELECT * INTO a FROM public.infinitepay_tentativas WHERE id = NEW.tentativa_id;
  IF p.id IS NULL OR a.id IS NULL OR a.pedido_id <> p.id OR p.fluxo_pagamento <> 'INFINITEPAY' THEN
    RAISE EXCEPTION 'INFINITEPAY_TRANSACAO_PEDIDO_DIVERGENTE' USING ERRCODE = '23514';
  END IF;
  IF NEW.classificacao = 'ELEGIVEL' AND (
    p.status = 'CANCELADO' OR NEW.amount <> a.valor_centavos OR NEW.amount <> p.total * 100
    OR NEW.paid_amount < NEW.amount OR NOT jsonb_exists(a.metodos_permitidos, lower(NEW.capture_method))
  ) THEN
    RAISE EXCEPTION 'INFINITEPAY_TRANSACAO_INELEGIVEL' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_transacao_guard BEFORE INSERT OR UPDATE OR DELETE ON public.infinitepay_transacoes
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_transacao_guard();

CREATE OR REPLACE FUNCTION public.fn_infinitepay_confirmacao_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE p public.pedidos%ROWTYPE; t public.infinitepay_transacoes%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'INFINITEPAY_CONFIRMACAO_IMUTAVEL' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO p FROM public.pedidos WHERE id = NEW.pedido_id FOR UPDATE;
  SELECT * INTO t FROM public.infinitepay_transacoes WHERE id = NEW.transacao_id;
  IF p.id IS NULL OR t.id IS NULL OR t.pedido_id <> p.id OR t.tentativa_id <> NEW.tentativa_id THEN
    RAISE EXCEPTION 'INFINITEPAY_CONFIRMACAO_PEDIDO_DIVERGENTE' USING ERRCODE = '23514';
  END IF;
  IF NEW.elegivel AND (t.classificacao <> 'ELEGIVEL' OR p.status = 'CANCELADO') THEN
    RAISE EXCEPTION 'INFINITEPAY_CONFIRMACAO_INELEGIVEL' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_confirmacao_guard BEFORE INSERT OR UPDATE OR DELETE ON public.infinitepay_confirmacoes
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_confirmacao_guard();

CREATE OR REPLACE FUNCTION public.fn_infinitepay_itens_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE pedido_antigo bigint; pedido_novo bigint; p public.pedidos%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'itens_pedido' THEN
    IF TG_OP <> 'INSERT' THEN pedido_antigo := OLD.pedido_id; END IF;
    IF TG_OP <> 'DELETE' THEN pedido_novo := NEW.pedido_id; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN SELECT pedido_id INTO pedido_antigo FROM public.itens_pedido WHERE id = OLD.item_pedido_id; END IF;
    IF TG_OP <> 'DELETE' THEN SELECT pedido_id INTO pedido_novo FROM public.itens_pedido WHERE id = NEW.item_pedido_id; END IF;
  END IF;
  FOR p IN SELECT * FROM public.pedidos WHERE id IN (pedido_antigo, pedido_novo) ORDER BY id FOR UPDATE LOOP
    IF p.fluxo_pagamento = 'INFINITEPAY' AND EXISTS (SELECT 1 FROM public.infinitepay_tentativas WHERE pedido_id = p.id) THEN
      RAISE EXCEPTION 'INFINITEPAY_ITENS_IMUTAVEIS' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_itens_guard BEFORE INSERT OR UPDATE OR DELETE ON public.itens_pedido
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_itens_guard();
CREATE TRIGGER infinitepay_adicionais_guard BEFORE INSERT OR UPDATE OR DELETE ON public.itens_pedido_adicionais
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_itens_guard();

CREATE OR REPLACE FUNCTION public.fn_infinitepay_operacional_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE p public.pedidos%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'eventos_outbox' THEN
      IF ROW(OLD.id, OLD.pedido_id, OLD.tipo, OLD.event_id, OLD.payload, OLD.criado_em)
         IS DISTINCT FROM ROW(NEW.id, NEW.pedido_id, NEW.tipo, NEW.event_id, NEW.payload, NEW.criado_em) THEN
        RAISE EXCEPTION 'INFINITEPAY_FILA_IDENTIDADE_IMUTAVEL' USING ERRCODE = '23514';
      END IF;
      IF NEW.estado IN ('CONCLUIDO','FALHOU') THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'impressoes' THEN
      IF ROW(OLD.id, OLD.pedido_id, OLD.tipo, OLD.origem, OLD.payload_snapshot, OLD.dedup_key)
         IS DISTINCT FROM ROW(NEW.id, NEW.pedido_id, NEW.tipo, NEW.origem, NEW.payload_snapshot, NEW.dedup_key) THEN
        RAISE EXCEPTION 'INFINITEPAY_FILA_IDENTIDADE_IMUTAVEL' USING ERRCODE = '23514';
      END IF;
      IF NEW.status IN ('CONCLUIDA','FALHOU','RESULTADO_INDETERMINADO') THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'notificacoes' THEN
      IF (to_jsonb(OLD) - 'lida_em') = (to_jsonb(NEW) - 'lida_em') THEN RETURN NEW; END IF;
    END IF;
  END IF;
  IF NEW.pedido_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.pedidos WHERE id = NEW.pedido_id FOR UPDATE;
  IF p.fluxo_pagamento = 'INFINITEPAY' AND (
    p.status = 'CANCELADO' OR p.liberado_operacionalmente_em IS NULL
    OR NOT public.fn_infinitepay_prova_elegivel(p.id, p.confirmacao_liberacao_id, p.total)
  ) THEN
    RAISE EXCEPTION 'INFINITEPAY_OPERACAO_NAO_LIBERADA' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER infinitepay_impressao_guard BEFORE INSERT OR UPDATE ON public.impressoes
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_operacional_guard();
CREATE TRIGGER infinitepay_notificacao_guard BEFORE INSERT OR UPDATE ON public.notificacoes
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_operacional_guard();
CREATE TRIGGER infinitepay_outbox_guard BEFORE INSERT OR UPDATE ON public.eventos_outbox
FOR EACH ROW EXECUTE FUNCTION public.fn_infinitepay_operacional_guard();
`;
