/** Auditoria estatica que pode rodar mesmo antes de npm ci ou da criacao do banco. */
import { readdir, readFile } from 'node:fs/promises';
import { PRODUTOS } from '../src/database/seeds/versions/011_cardapio_crepe_mania.js';
import { seedFiles } from '../src/database/seeds/seedManifest.js';
import { REPORT_CATALOG } from '../src/config/reportCatalog.js';
const migrationNames = (await readdir(new URL('../src/database/migrations/', import.meta.url)))
  .filter((file) => /^\d{3}_[a-z0-9_]+\.js$/.test(file)).sort();
function checkNumbering(files, total, label) {
  if (files.length !== total || files.some((file, i) => Number(file.slice(0, 3)) !== i + 1)) {
    throw new Error(`${label}: numeração esperada 001 a ${total} sem lacunas; encontrado ${files.length}`);
  }
}
checkNumbering(migrationNames, 46, 'Migrations');
checkNumbering(seedFiles, 14, 'Seeds');
const tableSource = await readFile(new URL('../src/database/migrations/017_itens_pedido.js', import.meta.url), 'utf8');
if (/tipo_pao|acrescimo_pao/.test(tableSource)) throw new Error('A migration de pedidos ainda exige pao.');
const productSource = await readFile(new URL('../src/database/migrations/010_produtos.js', import.meta.url), 'utf8');
for (const tipo of ['CREPE', 'PASTEL', 'PIZZA', 'BEBIDA', 'SUCO', 'ACAI']) if (!productSource.includes(`'${tipo}'`)) throw new Error(`Tipo ${tipo} nao suportado.`);
const categories = new Set(PRODUTOS.map((p) => p.categoria));
if (PRODUTOS.length !== 75 || categories.size !== 11) throw new Error('Inventário inicial alterado sem revisão.');
if (REPORT_CATALOG.some((r) => /p[aã]o/i.test(r.nome))) throw new Error('Relatorio legado de pao ativo.');
console.log(`OK: ${migrationNames.length} migrations; ${seedFiles.length} seeds; ${PRODUTOS.length} produtos; ${categories.size} categorias; ${REPORT_CATALOG.length} relatorios sem pao.`);
console.log('Auditoria estatica: NÃO substitui execucao em PostgreSQL nem testes de frontend.');
