import { AppError } from '../utils/AppError.js';
import { zodErrorDetails } from '../utils/validationErrors.js';

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError('Revise os campos informados.', 422, 'VALIDATION_ERROR', zodErrorDetails(result.error)));
    }
    if (source === 'query') Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true, enumerable: true });
    else req[source] = result.data;
    next();
  };
}
