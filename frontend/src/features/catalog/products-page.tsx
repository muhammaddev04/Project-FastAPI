import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ForbiddenState, Input, PageHeader, Select } from '@/shared/ui';
import { useCatalogQuery, type Category, type Page, type Product } from './api';
import { CatalogTabs } from './shared';
import { useCatalogAccess } from './api';

export function ProductsPage() {
  const { t } = useTranslation();
  const { membership, orgId, writable } = useCatalogAccess();
  const canView = membership.permissions.includes('catalog.view');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState('');
  const [offset, setOffset] = useState(0);
  const [ordering, setOrdering] = useState('name');
  const query = useCatalogQuery<Page<Product>>(
    `/catalog/products?${new URLSearchParams({ search, ordering, limit: '20', offset: String(offset), ...(category ? { category_id: category } : {}), ...(active ? { is_active: active } : {}) })}`,
    orgId,
    canView,
  );
  const categories = useCatalogQuery<Category[]>('/catalog/categories?flat=true', orgId, canView);
  if (!canView) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('catalog.products')}
        actions={
          writable && (
            <Button asChild>
              <Link to="/company/catalog/products/new">{t('catalog.addProduct')}</Link>
            </Button>
          )
        }
      />
      <CatalogTabs />
      <div className="flex flex-wrap gap-3">
        <Input
          aria-label={t('catalog.search')}
          placeholder={t('catalog.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <Select
          aria-label={t('catalog.category')}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('catalog.allCategories')}</option>
          {categories.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('catalog.status')}
          value={active}
          onChange={(e) => {
            setActive(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('catalog.allStatuses')}</option>
          <option value="true">{t('catalog.active')}</option>
          <option value="false">{t('catalog.inactive')}</option>
        </Select>
      </div>
      <DataTable<Product>
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? t('common.error') : undefined}
        onRetry={() => void query.refetch()}
        rowKey={(row) => row.id}
        empty={{ title: t('catalog.noProducts') }}
        pagination={{ offset, limit: 20, count: query.data?.count ?? 0, onChange: setOffset }}
        sort={{
          key: ordering.replace('-', ''),
          direction: ordering.startsWith('-') ? 'desc' : 'asc',
          onChange: (next) => {
            setOrdering(`${next.direction === 'desc' ? '-' : ''}${next.key}`);
            setOffset(0);
          },
        }}
        columns={[
          { key: 'sku', header: 'SKU', sortable: true, cell: (row) => row.sku },
          {
            key: 'name',
            header: t('catalog.name'),
            sortable: true,
            primary: true,
            cell: (row) => (
              <Link className="text-primary underline" to={`/company/catalog/products/${row.id}`}>
                {row.name}
              </Link>
            ),
          },
          {
            key: 'category',
            header: t('catalog.category'),
            cell: (row) => categories.data?.find((cat) => cat.id === row.category_id)?.name ?? '—',
          },
          { key: 'unit', header: t('catalog.baseUnit'), cell: (row) => row.base_unit },
          { key: 'active', header: t('catalog.status'), cell: (row) => t(row.is_active ? 'catalog.active' : 'catalog.inactive') },
        ]}
      />
    </div>
  );
}
