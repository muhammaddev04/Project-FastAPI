import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { errorMessage } from '@/shared/api/errors';
import { Alert, Button } from '@/shared/ui';

export function CatalogTabs() {
  const { membership } = useAreaContext();
  const { t } = useTranslation();
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t('catalog.title')}>
      <Button asChild variant="outline">
        <Link to="/company/catalog/products">{t('catalog.products')}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to="/company/catalog/categories">{t('catalog.categories')}</Link>
      </Button>
      {membership.permissions.includes('pricing.view') && (
        <Button asChild variant="outline">
          <Link to="/company/pricing/lists">{t('catalog.priceLists')}</Link>
        </Button>
      )}
      {membership.permissions.includes('import.run') && (
        <Button asChild variant="outline">
          <Link to="/company/imports">{t('catalog.imports')}</Link>
        </Button>
      )}
    </nav>
  );
}

export function Feedback({ error, success }: { error?: unknown; success?: boolean }) {
  const { t } = useTranslation();
  if (error) return <Alert tone="danger">{errorMessage(error, t)}</Alert>;
  return success ? <Alert tone="success">{t('catalog.saved')}</Alert> : null;
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm">
      {label}
      {children}
    </label>
  );
}
