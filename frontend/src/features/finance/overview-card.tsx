import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useCatalogQuery } from '@/features/catalog/api';
import { Feedback } from '@/features/catalog/shared';
import { Button, Card } from '@/shared/ui';
import type { Summary } from './api';

export function FinanceOverviewCard() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const allowed = membership.permissions.includes('finance.view');
  const query = useCatalogQuery<Summary>('/finance/summary', membership.organization_id, allowed);
  if (!allowed) return null;
  const company = membership.org_type === 'COMPANY';
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">{t(company ? 'finance.title' : 'finance.debts')}</h2>
      <Feedback error={query.error} />
      {query.data && (
        <>
          <p>
            {t('finance.balance')}: {query.data.balance} TJS
          </p>
          <p>
            {t('finance.overdue')}: {query.data.overdue} TJS
          </p>
        </>
      )}
      <Button asChild variant="outline">
        <Link to={company ? '/company/finance' : '/store/finance'}>{t(company ? 'finance.title' : 'finance.debts')}</Link>
      </Button>
    </Card>
  );
}
