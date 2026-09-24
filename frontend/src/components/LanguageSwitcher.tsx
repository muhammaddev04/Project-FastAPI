import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../i18n';
import type { SupportedLanguage } from '../i18n/resources';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  return <label className="language-switcher"><Languages size={15} aria-hidden="true" /><span className="sr-only">Language</span><select value={i18n.language.slice(0, 2)} onChange={(event) => changeLanguage(event.target.value as SupportedLanguage)} aria-label="Language"><option value="tg">TG</option><option value="ru">RU</option><option value="en">EN</option></select></label>;
}
