import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
const identity = { order_nsu: identifier.max(100), transaction_nsu: identifier, slug: identifier.optional(), invoice_slug: identifier.optional(), receipt_url: z.string().url().max(2048).optional() };
const normalizeSignal = (schema) => schema.superRefine((value, context) => {
  if ((!value.slug && !value.invoice_slug) || (value.slug && value.invoice_slug && value.slug !== value.invoice_slug)) context.addIssue({ code: 'custom', path: ['slug'], message: 'Informe um identificador de fatura consistente.' });
}).transform(({ invoice_slug, ...value }) => ({ ...value, slug: value.slug ?? invoice_slug }));

export const infinitepayConfirmSchema = normalizeSignal(z.object(identity).strict());
export const infinitepayWebhookSchema = normalizeSignal(z.object({
  ...identity,
  event_type: z.enum(['created', 'paid', 'settled', 'canceled', 'refunded', 'payment_failed']).optional(),
  amount: z.number().int().nonnegative().optional(), paid_amount: z.number().int().nonnegative().optional(), installments: z.number().int().optional(), capture_method: z.string().max(30).optional(), items: z.array(z.unknown()).max(100).optional(),
}).strict());

export const infinitepayConfigSchema = z.object({
  versao: z.number().int().positive(), ativo: z.boolean().optional(), pix_habilitado: z.boolean().optional(), credito_habilitado: z.boolean().optional(),
  handle: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,100}$/).optional(),
  api_key: z.union([z.literal(''), z.string().min(7).max(512).regex(/^inchk_[A-Za-z0-9_-]+$/)]).optional(),
  backend_public_url: z.string().url().max(2048).optional(), redirect_url: z.string().url().max(2048).optional(), assured_installments: z.number().int().min(0).max(12).optional(),
}).strict();

export const infinitepayAttemptParams = z.object({ id: z.string().uuid() }).strict();
export const infinitepayListSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(10), data_inicio: z.string().date().optional(), data_fim: z.string().date().optional() }).strict().refine((value) => !value.data_inicio || !value.data_fim || value.data_inicio <= value.data_fim, { message: 'Periodo invalido.', path: ['data_fim'] });
