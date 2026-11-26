import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { auditService } from './auditService.js';

const allowedFormats = new Set(['jpeg', 'png', 'webp']);
const maxWidth = { produtos: 1600, logo: 1024 };

export function detectImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function publicBaseUrl(config) {
  let url;
  try { url = new URL(config.R2_PUBLIC_BASE_URL); } catch { throw new AppError('URL publica do storage invalida.', 503, 'IMAGE_STORAGE_NOT_CONFIGURED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new AppError('URL publica do storage invalida.', 503, 'IMAGE_STORAGE_NOT_CONFIGURED');
  }
  return url.href.replace(/\/$/, '');
}

export class ImageStorageService {
  constructor({ config = env, client, audit = auditService } = {}) {
    this.config = config;
    this.client = client;
    this.audit = audit;
  }

  configured() {
    const c = this.config;
    return Boolean(c.R2_ENABLED && c.R2_ACCOUNT_ID && c.R2_ACCESS_KEY_ID && c.R2_SECRET_ACCESS_KEY && c.R2_BUCKET && c.R2_PUBLIC_BASE_URL);
  }

  requireConfigured() {
    if (!this.configured()) throw new AppError('Storage de imagens nao configurado.', 503, 'IMAGE_STORAGE_NOT_CONFIGURED');
    return publicBaseUrl(this.config);
  }

  storageClient() {
    if (!this.client) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: this.config.R2_ACCESS_KEY_ID, secretAccessKey: this.config.R2_SECRET_ACCESS_KEY },
      });
    }
    return this.client;
  }

  async prepare(file, kind) {
    if (!file?.buffer?.length) throw new AppError('Envie uma imagem no campo arquivo.', 422, 'IMAGE_REQUIRED');
    if (file.buffer.length > this.config.IMAGE_UPLOAD_MAX_BYTES) throw new AppError('A imagem excede o limite permitido.', 413, 'IMAGE_TOO_LARGE');
    const signature = detectImageSignature(file.buffer);
    if (!signature) throw new AppError('Arquivo nao e JPEG, PNG ou WebP valido.', 422, 'INVALID_IMAGE');
    let metadata;
    try {
      metadata = await sharp(file.buffer, { failOn: 'warning', limitInputPixels: this.config.IMAGE_UPLOAD_MAX_PIXELS }).metadata();
    } catch {
      throw new AppError('Conteudo de imagem invalido ou excede o limite de pixels.', 422, 'INVALID_IMAGE');
    }
    if (!allowedFormats.has(metadata.format) || metadata.format !== signature || !metadata.width || !metadata.height
      || metadata.width * metadata.height > this.config.IMAGE_UPLOAD_MAX_PIXELS) {
      throw new AppError('Conteudo de imagem invalido ou excede o limite de dimensoes.', 422, 'INVALID_IMAGE');
    }
    const buffer = await sharp(file.buffer, { failOn: 'warning', limitInputPixels: this.config.IMAGE_UPLOAD_MAX_PIXELS })
      .rotate().resize({ width: maxWidth[kind], height: maxWidth[kind], fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 }).toBuffer();
    const output = await sharp(buffer).metadata();
    return { buffer, width: output.width, height: output.height };
  }

  async upload(kind, file, context) {
    if (!['produtos', 'logo'].includes(kind)) throw new AppError('Tipo de upload invalido.', 400, 'INVALID_UPLOAD_KIND');
    const baseUrl = this.requireConfigured();
    const prepared = await this.prepare(file, kind);
    const key = `imagens/${kind}/${randomUUID()}.webp`;
    const client = this.storageClient();
    await client.send(new PutObjectCommand({
      Bucket: this.config.R2_BUCKET,
      Key: key,
      Body: prepared.buffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    try {
      await this.audit.registrar({
        usuarioId: context.user.id, acao: 'UPLOAD.IMAGEM', descricao: `Imagem de ${kind} enviada`,
        recursoTipo: 'upload_imagem', recursoId: key,
        metodo: context.method, endpoint: context.endpoint, requestId: context.requestId,
        payload: { tipo: kind, chave: key, largura: prepared.width, altura: prepared.height },
      });
    } catch (error) {
      try { await client.send(new DeleteObjectCommand({ Bucket: this.config.R2_BUCKET, Key: key })); } catch { /* limpeza de melhor esforco */ }
      throw error;
    }
    return { url: `${baseUrl}/${key}`, formato: 'webp', largura: prepared.width, altura: prepared.height };
  }
}

export const imageStorageService = new ImageStorageService();
