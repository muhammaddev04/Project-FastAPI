import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, DataTable, ForbiddenState, Input, PageHeader } from '@/shared/ui';
import { formatDateTime } from '@/shared/lib/datetime';
import { errorMessage } from '@/shared/api/errors';
import { useCatalogMutation, useCatalogQuery, priceDifference, type MatrixRow, type Page, type Price, type PriceList } from './api';
import { CatalogTabs, Feedback, Field } from './shared';
import { useCatalogAccess } from './api';

export function PriceListsPage() {
  const { t } = useTranslation();
  const { membership, orgId, writable } = useCatalogAccess('pricing.manage');
  const canView = membership.permissions.includes('pricing.view');
  const query = useCatalogQuery<Page<PriceList>>('/pricing/price-lists?limit=100', orgId, canView);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const add = useCatalogMutation<PriceList>('/pricing/price-lists', orgId);
  if (!canView) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('catalog.priceLists')} />
      <CatalogTabs />
      <DataTable<PriceList>
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        rowKey={(row) => row.id}
        empty={{ title: t('catalog.priceLists') }}
        columns={[
          { key: 'code', header: t('catalog.code'), cell: (row) => row.code },
          {
            key: 'name',
            header: t('catalog.name'),
            primary: true,
            cell: (row) => (
              <Link className="text-primary underline" to={`/company/pricing/lists/${row.id}`}>
                {row.name} {row.is_default ? `(${t('catalog.default')})` : ''}
              </Link>
            ),
          },
          {
            key: 'status',
            header: t('catalog.status'),
            cell: (row) => <ListEdit key={row.version} list={row} orgId={orgId} writable={writable} />,
          },
        ]}
      />
      {writable && (
        <Card className="p-5">
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate(
                { code, name },
                {
                  onSuccess: () => {
                    setName('');
                    setCode('');
                  },
                },
              );
            }}
          >
            <Field label={t('catalog.code')}>
              <Input required maxLength={32} value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <Field label={t('catalog.name')}>
              <Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Button type="submit" disabled={add.isPending}>
              {t('catalog.addPriceList')}
            </Button>
            <Feedback error={add.error} />
          </form>
        </Card>
      )}
    </div>
  );
}

function ListEdit({ list, orgId, writable }: { list: PriceList; orgId: string; writable: boolean }) {
  const { t } = useTranslation();
  const [name, setName] = useState(list.name);
  const mutation = useCatalogMutation<PriceList>(`/pricing/price-lists/${list.id}`, orgId, 'PATCH');
  if (!writable) return <span>{t(list.is_active ? 'catalog.active' : 'catalog.inactive')}</span>;
  return (
    <div className="flex flex-wrap gap-2">
      <Input aria-label={`${t('catalog.name')} ${list.code}`} value={name} onChange={(event) => setName(event.target.value)} />
      <Button
        variant="outline"
        disabled={mutation.isPending || !name.trim()}
        onClick={() => mutation.mutate({ version: list.version, name })}
      >
        {t('catalog.save')}
      </Button>
      {!list.is_default && (
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ version: list.version, is_active: !list.is_active })}
        >
          {t(list.is_active ? 'catalog.deactivate' : 'catalog.activate')}
        </Button>
      )}
      <Feedback error={mutation.error} />
    </div>
  );
}

export function PriceMatrixPage() {
  const { listId } = useParams();
  const { orgId } = useCatalogAccess('pricing.manage');
  return <MatrixEditor key={`${orgId}:${listId}`} id={listId ?? ''} />;
}

function MatrixEditor({ id }: { id: string }) {
  const { t } = useTranslation();
  const { membership, orgId, writable } = useCatalogAccess('pricing.manage');
  const canView = membership.permissions.includes('pricing.view');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { row: MatrixRow; value: string }>>({});
  const [preview, setPreview] = useState(false);
  const [future, setFuture] = useState('');
  const [history, setHistory] = useState('');
  const query = useCatalogQuery<Page<MatrixRow>>(
    `/pricing/price-lists/${id}/prices?${new URLSearchParams({ search, offset: String(offset), limit: '20' })}`,
    orgId,
    canView,
  );
  const save = useCatalogMutation<Price[]>('/pricing/prices/bulk', orgId, 'POST', true);
  const historyQuery = useCatalogQuery<Page<Price>>(
    `/pricing/prices/history?price_list_id=${id}&product_unit_id=${history}&limit=100`,
    orgId,
    !!history && canView,
  );
  if (!canView) return <ForbiddenState />;
  const changes = Object.values(drafts).filter((draft) => draft.value && draft.value !== draft.row.current?.price);
  return (
    <div className="space-y-5">
      <PageHeader title={t('catalog.priceMatrix')} />
      <CatalogTabs />
      <Input
        aria-label={t('catalog.search')}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOffset(0);
        }}
      />
      <DataTable<MatrixRow>
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        rowKey={(row) => row.unit.id}
        empty={{ title: t('catalog.noProducts') }}
        pagination={{ offset, limit: 20, count: query.data?.count ?? 0, onChange: setOffset }}
        columns={[
          { key: 'name', header: t('catalog.name'), primary: true, cell: (row) => `${row.sku} · ${row.name}` },
          { key: 'unit', header: t('catalog.units'), cell: (row) => row.unit.code },
          {
            key: 'price',
            header: t('catalog.currentPrice'),
            numeric: true,
            cell: (row) =>
              writable ? (
                <Input
                  aria-label={`${t('catalog.price')} ${row.sku} ${row.unit.code}`}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={drafts[row.unit.id]?.value ?? row.current?.price ?? ''}
                  onChange={(event) => {
                    setPreview(false);
                    setDrafts({ ...drafts, [row.unit.id]: { row, value: event.target.value } });
                  }}
                />
              ) : (
                (row.current?.price ?? row.resolved_price ?? '—')
              ),
          },
          {
            key: 'future',
            header: t('catalog.futurePrice'),
            cell: (row) =>
              row.future ? (
                <div>
                  {row.future.price} · {formatDateTime(row.future.valid_from)}
                  {writable && <CancelPrice price={row.future} orgId={orgId} />}
                </div>
              ) : (
                '—'
              ),
          },
          {
            key: 'history',
            header: t('catalog.priceHistory'),
            cell: (row) => (
              <Button variant="link" onClick={() => setHistory(row.unit.id)}>
                {t('catalog.priceHistory')}
              </Button>
            ),
          },
        ]}
      />
      {writable && (
        <Card className="space-y-3 p-5">
          <Field label={t('catalog.validFrom')}>
            <Input
              type="datetime-local"
              value={future}
              onChange={(event) => {
                setFuture(event.target.value);
                setPreview(false);
              }}
            />
          </Field>
          <Button
            disabled={!changes.length || changes.length > 500 || changes.some((change) => Number(change.value) <= 0)}
            onClick={() => setPreview(true)}
          >
            {t('catalog.preview')} ({changes.length})
          </Button>
          {preview && (
            <div className="space-y-3">
              <h2 className="font-semibold">{t('catalog.preview')}</h2>
              {changes.map((change) => (
                <p key={change.row.unit.id}>
                  {change.row.sku} · {change.row.unit.code}: {change.row.current?.price ?? '—'} → {change.value} TJS (
                  {priceDifference(change.row.current?.price, change.value) ?? '—'}%)
                </p>
              ))}
              <Button
                disabled={!writable || save.isPending}
                onClick={() =>
                  save.mutate(
                    {
                      rows: changes.map((change) => ({
                        price_list_id: id,
                        product_unit_id: change.row.unit.id,
                        price: change.value,
                        ...(future ? { valid_from: new Date(future).toISOString() } : {}),
                      })),
                    },
                    {
                      onSuccess: () => {
                        setDrafts({});
                        setPreview(false);
                      },
                    },
                  )
                }
              >
                {t('catalog.confirm')}
              </Button>
            </div>
          )}
          <Feedback error={save.error} success={save.isSuccess} />
        </Card>
      )}
      {history && (
        <Card className="space-y-2 p-5">
          <h2 className="font-semibold">{t('catalog.priceHistory')}</h2>
          {historyQuery.data?.results.map((price) => (
            <p key={price.id}>
              {price.price} TJS · {formatDateTime(price.valid_from)} → {price.valid_to ? formatDateTime(price.valid_to) : '∞'}
            </p>
          ))}
          <Feedback error={historyQuery.error} />
          <Button variant="outline" onClick={() => setHistory('')}>
            {t('common.close')}
          </Button>
        </Card>
      )}
    </div>
  );
}

function CancelPrice({ price, orgId }: { price: Price; orgId: string }) {
  const { t } = useTranslation();
  const mutation = useCatalogMutation<void>(`/pricing/prices/${price.id}`, orgId, 'DELETE');
  return (
    <>
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(undefined)}>
        {t('catalog.cancelFuture')}
      </Button>
      <Feedback error={mutation.error} />
    </>
  );
}
