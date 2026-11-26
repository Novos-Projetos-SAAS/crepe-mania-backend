import { env } from '../config/env.js';
import { InfinitepayRepository } from '../repositories/infinitepayRepository.js';
import { AppError } from '../utils/AppError.js';
import { encryptApiKey, encryptionKey } from '../payments/infinitepayCredentials.js';
import { validateModalityFlags } from '../payments/orderPaymentPolicy.js';
import { auditService } from './auditService.js';

const defaults = { ativo: false, pix_habilitado: false, credito_habilitado: false, versao: 1, assured_installments: 0 };
const configurationKeys = ['ativo', 'pix_habilitado', 'credito_habilitado', 'handle', 'backend_public_url', 'redirect_url', 'assured_installments'];

export function safeConfiguration(row = defaults) {
  return { ...Object.fromEntries(configurationKeys.map((name) => [name, row[name] ?? defaults[name] ?? null])), versao: row.versao, has_api_key: Boolean(row.credencial_id) };
}

export function validateCallbackUrls(config, origins) {
  try {
    const backend = new URL(config.backend_public_url);
    const redirect = new URL(config.redirect_url);
    if ([backend, redirect].some((url) => url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search) || backend.pathname !== '/' || !origins.includes(redirect.origin)) throw new Error('url');
  } catch { throw new AppError('Configure URLs HTTPS de backend e retorno autorizado.', 422, 'INFINITEPAY_INVALID_URLS'); }
}

export class InfinitepayConfigService {
  constructor({ repo = new InfinitepayRepository(), key = () => env.INFINITEPAY_ENCRYPTION_KEY, origins = () => env.allowedOrigins, audit = auditService } = {}) { this.repo = repo; this.key = key; this.origins = origins; this.audit = audit; }
  async read() { return safeConfiguration(await this.repo.configuration() ?? defaults); }
  async forCheckout(trx) { return await this.repo.configuration(trx, true) ?? defaults; }

  async update(input, context) {
    return this.repo.database.transaction(async (trx) => {
      await this.repo.ensureConfiguration(trx);
      const current = await this.repo.configuration(trx, true);
      if (Number(current.versao) !== input.versao) throw new AppError('Configuracao alterada por outro usuario.', 409, 'INFINITEPAY_CONFIG_VERSION_CONFLICT');
      const patch = Object.fromEntries(configurationKeys.filter((name) => input[name] !== undefined).map((name) => [name, input[name]]));
      const next = { ...current, ...patch };
      validateModalityFlags(next);
      if (current.credencial_id && next.handle !== current.handle && !input.api_key) throw new AppError('Troca de InfiniteTag exige nova API Key.', 422, 'INFINITEPAY_ACCOUNT_CHANGED');
      if (input.api_key) {
        if (!next.handle) throw new AppError('InfiniteTag obrigatoria.', 422, 'INFINITEPAY_HANDLE_REQUIRED');
        const credential = await this.repo.insertCredential({ handle: next.handle, api_key_ciphertext: encryptApiKey(input.api_key, this.key(), next.handle), key_version: 1, criado_por_usuario_id: context.user.id }, trx);
        next.credencial_id = credential.id;
        patch.credencial_id = credential.id;
      }
      if (next.ativo) {
        if (!next.credito_habilitado) throw new AppError('Ativacao exige ao menos credito online.', 422, 'INFINITEPAY_MODALITY_REQUIRED');
        encryptionKey(this.key());
        if (!next.credencial_id || !next.handle) throw new AppError('Credencial obrigatoria para ativar.', 422, 'INFINITEPAY_CREDENTIAL_REQUIRED');
        validateCallbackUrls(next, this.origins());
      }
      const row = await this.repo.updateConfiguration({ ...patch, versao: current.versao + 1 }, trx);
      await this.audit.registrar({ trx, usuarioId: context.user.id, acao: 'INFINITEPAY.CONFIGURAR', descricao: 'Configuracao financeira atualizada', recursoTipo: 'infinitepay_configuracao', recursoId: 1, payload: { versao: row.versao, ativo: row.ativo, credencial_substituida: Boolean(input.api_key) } });
      return safeConfiguration(row);
    });
  }
}

export const infinitepayConfigService = new InfinitepayConfigService();
