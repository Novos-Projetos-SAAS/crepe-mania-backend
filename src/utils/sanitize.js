const SENSITIVE = /(senha|password|authorization|cookie|token|secret|jwt|auth|p256dh|private.?key|api.?key|encryption.?key)/i;

export function safeRequestPath(value) {
  return String(value ?? '').split(/[?#]/)[0].replace(/(\/pedidos\/acompanhar\/)[^/]+/g, '$1[REDACTED]');
}

export function sanitizeAuditPayload(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  // Datas do PostgreSQL chegam como Date. Object.entries(new Date()) e vazio;
  // converter para ISO preserva a data original nos snapshots de reimpressao.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAuditPayload(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE.test(key) ? '[REDACTED]' : sanitizeAuditPayload(item, depth + 1),
    ]));
  }
  // eslint-disable-next-line no-control-regex
  if (typeof value === 'string') return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 1000);
  return value;
}

export function normalizeText(value) {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() : value;
}

export function neutralizeCsv(value) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${/^[=+\-@]/.test(text) ? `'${text}` : text}"`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
