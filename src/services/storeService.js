
import { DateTime } from 'luxon';
import { StoreRepository } from '../repositories/storeRepository.js';
import { auditService } from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { domainEvents } from '../realtime/domainEvents.js';

const TIMEZONE = 'America/Sao_Paulo';

export const STORE_OPERATION_MODES = Object.freeze({
  AUTOMATICO: 'AUTOMATICO',
  ABERTO_MANUAL: 'ABERTO_MANUAL',
  FECHADO_MANUAL: 'FECHADO_MANUAL',
});

const toMinutes = (time) => {
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

export function isWithinSchedule(
  schedules,
  date = DateTime.now(),
) {
  const localDate = date.setZone(TIMEZONE);

  // Sem horários ativos, o modo automático fica fechado.
  // Uma abertura manual continua sendo possível.
  if (!schedules.length) {
    return { open: false, mode: 'SEM_HORARIOS' };
  }

  const day = localDate.weekday % 7;
  const minute = localDate.hour * 60 + localDate.minute;

  const open = schedules.some((schedule) => {
    const start = toMinutes(schedule.hora_inicio);
    const end = toMinutes(schedule.hora_fim);
    const scheduleDay = Number(schedule.dia_semana);

    if (start < end) {
      return (
        scheduleDay === day &&
        minute >= start &&
        minute < end
      );
    }

    // Horários que atravessam a meia-noite.
    return (
      (scheduleDay === day && minute >= start) ||
      (
        scheduleDay === (day + 6) % 7 &&
        minute < end
      )
    );
  });

  return { open, mode: 'HORARIO' };
}

export function assertNoScheduleOverlap(schedules) {
  const week = 7 * 1440;

  const ranges = schedules
    .filter((item) => item.ativo)
    .map((item) => {
      const start =
        Number(item.dia_semana) * 1440 +
        toMinutes(item.hora_inicio);

      let end =
        Number(item.dia_semana) * 1440 +
        toMinutes(item.hora_fim);

      if (end <= start) end += 1440;

      return { start, end };
    });

  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const candidates = [
        ranges[j],
        {
          start: ranges[j].start - week,
          end: ranges[j].end - week,
        },
        {
          start: ranges[j].start + week,
          end: ranges[j].end + week,
        },
      ];

      if (candidates.some((other) =>
        ranges[i].start < other.end &&
        other.start < ranges[i].end
      )) {
        throw new AppError(
          'Horarios de funcionamento sobrepostos.',
          422,
          'OVERLAPPING_SCHEDULE',
        );
      }
    }
  }
}

// Compatibilidade com dados anteriores à migration 041.
export function resolveOperationMode(config) {
  const mode = config.modo_operacao;

  if (
    Object.values(STORE_OPERATION_MODES).includes(mode)
  ) {
    return mode;
  }

  if (mode == null) {
    return config.aceitar_pedidos
      ? STORE_OPERATION_MODES.AUTOMATICO
      : STORE_OPERATION_MODES.FECHADO_MANUAL;
  }

  // Valor desconhecido: comportamento seguro.
  return STORE_OPERATION_MODES.FECHADO_MANUAL;
}

export function calculateStoreAvailability({
  mode,
  schedule,
  configured,
}) {
  if (!configured) {
    return {
      open: false,
      message: 'Loja ainda não configurada.',
    };
  }

  if (mode === STORE_OPERATION_MODES.FECHADO_MANUAL) {
    return {
      open: false,
      message: 'Loja fechada manualmente.',
    };
  }

  if (mode === STORE_OPERATION_MODES.ABERTO_MANUAL) {
    return {
      open: true,
      message: 'Loja aberta manualmente para pedidos.',
    };
  }

  if (schedule.mode === 'SEM_HORARIOS') {
    return {
      open: false,
      message: 'Não há horários de funcionamento ativos.',
    };
  }

  if (schedule.open) {
    return {
      open: true,
      message: 'Loja aberta no horário programado.',
    };
  }

  return {
    open: false,
    message: 'Fora do horário de funcionamento.',
  };
}

export class StoreService {
  constructor(repository = new StoreRepository()) {
    this.repository = repository;
  }

  async status({ trx, lock = false, now } = {}) {
    const executor = trx ?? this.repository.database;

    let config;
    let schedules;

    if (trx) {
      config = await this.repository.config(executor, lock);
      schedules = await this.repository.schedules(executor);
    } else {
      [config, schedules] = await Promise.all([
        this.repository.config(executor, lock),
        this.repository.schedules(executor),
      ]);
    }

    if (!config) {
      throw new AppError(
        'Configuracao da loja nao inicializada.',
        503,
        'STORE_NOT_CONFIGURED',
      );
    }

    const schedule = isWithinSchedule(schedules, now);
    const mode = resolveOperationMode(config);

    const configured =
      Boolean(config.nome_fantasia) &&
      config.taxa_entrega != null;

    const availability = calculateStoreAvailability({
      mode,
      schedule,
      configured,
    });

    return {
      aberta: availability.open,
      modo_operacao: mode,
      modo_horario: schedule.mode,
      horario_ativo: schedule.open,
      mensagem: availability.message,

      loja: {
        nome_fantasia: config.nome_fantasia,
        telefone: config.telefone,
        whatsapp: config.whatsapp,
        endereco_trailer: config.endereco_trailer,
        referencia_trailer: config.referencia_trailer,
        logo_url: config.logo_url,
        taxa_entrega: config.taxa_entrega,
        tempo_estimado_min: config.tempo_estimado_min,
        timezone: config.timezone,
      },

      horarios: schedules,
      config,
    };
  }

  async updateConfig(data, context) {
    const db = this.repository.database;

    const row = await db.transaction(async (trx) => {
      const before = await this.repository.config(trx, true);

      const updated = await this.repository.updateConfig(
        data,
        trx,
      );

      await auditService.registrar({
        trx,
        usuarioId: context.user.id,
        acao: context.acao ?? 'LOJA.CONFIGURAR',
        descricao:
          context.acao === 'LOJA.STATUS'
            ? 'Modo de funcionamento da loja alterado'
            : 'Configuracoes da loja alteradas',
        recursoTipo: 'loja',
        recursoId: 1,
        ...context,
        payload: {
          antes: before,
          depois: updated,
        },
      });

      return updated;
    });

    domainEvents.emit('loja_atualizada', {
      event_id: `loja:${row.atualizado_em}`,
      atualizado_em: row.atualizado_em,
    });

    return row;
  }

  // Novo método utilizado pelo controle de três modos.
  async updateOperationMode(mode, context) {
    if (
      !Object.values(STORE_OPERATION_MODES).includes(mode)
    ) {
      throw new AppError(
        'Modo de funcionamento inválido.',
        422,
        'INVALID_STORE_OPERATION_MODE',
      );
    }

    // Campo antigo mantido para compatibilidade.
    const aceitarPedidos =
      mode !== STORE_OPERATION_MODES.FECHADO_MANUAL;

    const row = await this.updateConfig(
      {
        modo_operacao: mode,
        aceitar_pedidos: aceitarPedidos,
      },
      {
        ...context,
        acao: 'LOJA.STATUS',
      },
    );

    domainEvents.emit('status_loja_alterado', {
      event_id: `loja:${row.atualizado_em}`,
      modo_operacao: row.modo_operacao,
      aceitar_pedidos: row.aceitar_pedidos,
      atualizado_em: row.atualizado_em,
    });

    return row;
  }

  // Compatibilidade com o endpoint antigo.
  // true = seguir horários; false = fechar manualmente.
  async updateStatus(aceitarPedidos, context) {
    if (typeof aceitarPedidos !== 'boolean') {
      throw new AppError(
        'Informe se a loja deve aceitar pedidos.',
        422,
        'INVALID_STORE_STATUS',
      );
    }

    const mode = aceitarPedidos
      ? STORE_OPERATION_MODES.AUTOMATICO
      : STORE_OPERATION_MODES.FECHADO_MANUAL;

    return this.updateOperationMode(mode, context);
  }

  async replaceSchedules(items, context) {
    const keys = items.map(
      (item) =>
        `${item.dia_semana}-${item.hora_inicio}-${item.hora_fim}`,
    );

    if (new Set(keys).size !== keys.length) {
      throw new AppError(
        'Horarios duplicados.',
        422,
        'DUPLICATE_SCHEDULE',
      );
    }

    assertNoScheduleOverlap(items);

    const db = this.repository.database;

    return db.transaction(async (trx) => {
      const rows = await this.repository.replaceSchedules(
        items,
        trx,
      );

      await auditService.registrar({
        trx,
        usuarioId: context.user.id,
        acao: 'LOJA.HORARIOS',
        descricao: 'Horarios de funcionamento substituidos',
        recursoTipo: 'loja',
        recursoId: 1,
        ...context,
        payload: {
          quantidade: rows.length,
        },
      });

      return rows;
    });
  }
}

export const storeService = new StoreService();
