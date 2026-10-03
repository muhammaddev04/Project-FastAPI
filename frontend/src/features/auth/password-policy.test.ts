import { newPasswordSchema, passwordRules } from './schemas';

describe('password acceptance and advisory strength', () => {
  it.each(['1234', 'abcd', '!!!!', 'password1', 'a'.repeat(128)])('accepts %s independently of composition', (password) => {
    expect(newPasswordSchema.safeParse(password).success).toBe(true);
  });
  it.each(['', '123', 'a'.repeat(129)])('rejects passwords outside length limits', (password) => {
    expect(newPasswordSchema.safeParse(password).success).toBe(false);
  });
  it('keeps the stronger length and composition as recommendations', () => {
    expect(passwordRules('1234')).toEqual({ length: false, letter: false, digit: true });
    expect(passwordRules('Abcdef12!')).toEqual({ length: true, letter: true, digit: true });
  });
});
