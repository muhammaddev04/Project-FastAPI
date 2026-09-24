import type { TFunction } from 'i18next';
import { ApiError } from './client';

/** FE-006: map an error to translated text by its stable code; never show raw server output. */
export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    const translated = t(key);
    return translated === key ? t('errors.generic') : translated;
  }
  return t('errors.generic');
}

/** Field-level messages from a validation_error, keyed by field path. */
export function fieldErrorMap(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'validation_error') return {};
  return Object.fromEntries(error.fieldErrors.map((field) => [field.field, field.message]));
}
