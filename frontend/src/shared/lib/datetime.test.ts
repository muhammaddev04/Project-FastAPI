import { formatDate, formatDateTime } from './datetime';

describe('GLOBAL §12 dates: dd.MM.yyyy HH:mm in Asia/Dushanbe (UTC+5)', () => {
  it('shows UTC API timestamps in Dushanbe time', () => {
    expect(formatDateTime('2026-09-28T09:05:00Z')).toBe('28.09.2026 14:05');
    expect(formatDateTime('2026-09-28T09:05:00.123456+00:00')).toBe('28.09.2026 14:05');
  });

  it('crosses the date line at 19:00 UTC', () => {
    expect(formatDateTime('2026-12-31T19:00:00Z')).toBe('01.01.2027 00:00');
    expect(formatDate('2026-12-31T19:00:00Z')).toBe('01.01.2027');
    expect(formatDate('2026-12-31T18:59:00Z')).toBe('31.12.2026');
  });

  it('keeps calendar dates as they are', () => {
    expect(formatDate('2026-09-28')).toBe('28.09.2026');
  });

  it('returns null for missing or invalid values', () => {
    expect(formatDateTime(null)).toBeNull();
    expect(formatDateTime('')).toBeNull();
    expect(formatDateTime('not a date')).toBeNull();
    expect(formatDate(undefined)).toBeNull();
  });
});
