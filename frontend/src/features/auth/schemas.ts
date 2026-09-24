import { z } from 'zod';

/** Mirrors backend PHONE check (users.phone, E.164). Spaces, dashes and brackets typed by users are removed. */
export const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
export const normalizePhone = (value: string) => value.replace(/[\s()-]/g, '');

export const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((value) => PHONE_PATTERN.test(value), 'validation.phone');

/** IAM-003 as enforced by backend app/modules/auth/password_policy.py (the common-password list is server-side). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export type PasswordRule = 'length' | 'letter' | 'digit';

export function passwordRules(password: string): Record<PasswordRule, boolean> {
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    letter: /\p{L}/u.test(password),
    digit: /\d/.test(password),
  };
}

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, 'validation.passwordTooShort')
  .max(PASSWORD_MAX, 'validation.passwordTooLong')
  .refine((value) => passwordRules(value).letter && passwordRules(value).digit, 'validation.passwordLetterDigit');

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'validation.required'),
});
export type LoginValues = z.input<typeof loginSchema>;

export const registerSchema = z
  .object({
    orgType: z.enum(['COMPANY', 'STORE']),
    orgName: z.string().trim().min(2, 'validation.nameTooShort').max(200, 'validation.tooLong'),
    fullName: z.string().trim().min(2, 'validation.nameTooShort').max(150, 'validation.tooLong'),
    phone: phoneSchema,
    email: z.union([z.literal(''), z.string().trim().email('validation.email').max(254, 'validation.tooLong')]),
    language: z.enum(['tg', 'ru', 'en']),
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordsMismatch',
  });
export type RegisterValues = z.input<typeof registerSchema>;

export const REGISTER_STEPS: { id: 'business' | 'details' | 'security'; fields: (keyof RegisterValues)[] }[] = [
  { id: 'business', fields: ['orgType', 'orgName'] },
  { id: 'details', fields: ['fullName', 'phone', 'email', 'language'] },
  { id: 'security', fields: ['password', 'confirmPassword'] },
];

export const resetSchema = z.object({ phone: phoneSchema });
export type ResetValues = z.input<typeof resetSchema>;
