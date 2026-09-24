import en from './en.json';
import ru from './ru.json';
import tg from './tg.json';
import { detectLanguage, i18n, setLanguage } from './index';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nested]) => keys(nested, prefix ? `${prefix}.${key}` : key));
}

describe('i18n (FND-033, FND-037)', () => {
  it('has identical keys in tg, ru and en', () => {
    const reference = keys(tg).sort();
    expect(keys(ru).sort()).toEqual(reference);
    expect(keys(en).sort()).toEqual(reference);
  });

  it('defaults to Tajik when nothing is stored and the browser language is unsupported', () => {
    localStorage.clear();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    expect(detectLanguage()).toBe('tg');
  });

  it('uses the browser language when supported and a stored choice first', () => {
    localStorage.clear();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    expect(detectLanguage()).toBe('ru');
    localStorage.setItem('tezfarmo.language', 'en');
    expect(detectLanguage()).toBe('en');
  });

  it('persists the switch and updates the document language', () => {
    setLanguage('ru');
    expect(localStorage.getItem('tezfarmo.language')).toBe('ru');
    expect(i18n.t('common.continue')).toBe('Продолжить');
    expect(document.documentElement.lang).toBe('ru');
  });
});
