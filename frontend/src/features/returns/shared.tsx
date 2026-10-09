import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useReturnsAccess } from './access';

/** The two queues link to each other: a return born from a dispute is the same case under another name. */
export function ReturnsTabs() {
  const { t } = useTranslation();
  const { base, has } = useReturnsAccess();
  const { pathname } = useLocation();
  const tabs = [
    { path: `${base}/returns`, label: t('returns.title'), visible: has('returns.view') },
    { path: `${base}/disputes`, label: t('returns.disputes'), visible: has('disputes.view') },
  ].filter((tab) => tab.visible);
  if (tabs.length < 2) return null;
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t('returns.title')}>
      {tabs.map((tab) => (
        <Button key={tab.path} asChild variant={pathname.startsWith(tab.path) ? 'primary' : 'outline'}>
          <Link to={tab.path}>{tab.label}</Link>
        </Button>
      ))}
    </nav>
  );
}
