import { REPORT_CATALOG } from '../../../config/reportCatalog.js';

export async function apply(trx) {
  for (const report of REPORT_CATALOG) {
    const filtrosConfig = JSON.stringify(report.filtros_config);
    const colunasConfig = JSON.stringify(report.colunas_config);
    await trx('catalogo_relatorios').insert({
      ...report,
      filtros_config: filtrosConfig,
      colunas_config: colunasConfig,
      limite_linhas: 2000,
      ativo: true,
    })
      .onConflict('codigo')
      .merge({
        nome: report.nome,
        descricao: report.descricao,
        grupo: report.grupo,
        filtros_config: filtrosConfig,
        colunas_config: colunasConfig,
        ordem_exibicao: report.ordem_exibicao,
        atualizado_em: trx.fn.now(),
      });
  }
}

