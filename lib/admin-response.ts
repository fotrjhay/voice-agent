import 'server-only';
import { ZodError } from 'zod';
import { HttpError } from './http-error';
import { json } from './server';

export function adminError(error: unknown) {
  if (error instanceof HttpError) {
    const response = json({ error: error.message }, error.status);
    if (error.status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
  if (error instanceof ZodError) return json({ error: 'Check the field values and length limits.', fields: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) }, 400);
  return json({ error: 'The operation could not be completed. Please retry.' }, 503);
}
