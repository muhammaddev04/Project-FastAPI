import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { SUPPORTED_LANGUAGES, currentLanguage, setLanguage, type Language } from './index';

/** FND-033: TG / RU / EN switch; the choice is stored in localStorage. */
export function LanguageSwitcher({ className, size }: { className?: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  return (
    <SegmentedControl<Language>
      className={className}
      size={size}
      label={t('common.language')}
      value={currentLanguage()}
      onChange={setLanguage}
      options={SUPPORTED_LANGUAGES.map((language) => ({
        value: language,
        label: language.toUpperCase(),
        title: t(`languages.${language}`),
      }))}
    />
  );
}
