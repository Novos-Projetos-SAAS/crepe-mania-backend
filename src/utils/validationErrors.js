const DEFAULT_MESSAGES = {
  invalid_type: 'Valor inválido.',
  invalid_format: 'Formato inválido.',
  invalid_value: 'Valor não permitido.',
  too_small: 'Valor abaixo do mínimo permitido.',
  too_big: 'Valor acima do máximo permitido.',
  not_multiple_of: 'Valor inválido.',
  unrecognized_keys: 'Campo não permitido.',
};

function pathFor(issue, suffix) {
  return [...issue.path, ...(suffix ? [suffix] : [])].join('.');
}

function safeIssueMessage(issue) {
  if (issue.code === 'custom' && issue.message) return issue.message;
  if (issue.code === 'invalid_format') {
    if (issue.format === 'email') return 'Informe um e-mail válido.';
    if (issue.format === 'url') return 'Informe uma URL válida.';
    if (issue.format === 'regex') return 'Formato inválido.';
  }
  if (issue.code === 'invalid_type') {
    if (issue.input === undefined) return 'Campo obrigatório.';
    return 'Tipo de valor inválido.';
  }
  if (issue.code === 'too_small') {
    if (issue.origin === 'string') return `Informe pelo menos ${issue.minimum} caracteres.`;
    if (issue.origin === 'array') return `Informe pelo menos ${issue.minimum} item(ns).`;
    return 'Valor abaixo do mínimo permitido.';
  }
  if (issue.code === 'too_big') {
    if (issue.origin === 'string') return `Informe no máximo ${issue.maximum} caracteres.`;
    if (issue.origin === 'array') return `Informe no máximo ${issue.maximum} item(ns).`;
    return 'Valor acima do máximo permitido.';
  }
  return DEFAULT_MESSAGES[issue.code] ?? 'Valor inválido.';
}

export function zodErrorDetails(error) {
  return error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      return issue.keys.map((key) => ({ path: pathFor(issue, key), message: 'Campo não permitido.' }));
    }
    return [{ path: pathFor(issue), message: safeIssueMessage(issue) }];
  });
}
