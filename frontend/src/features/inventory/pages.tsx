import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { useCatalogAccess, useCatalogMutation, useCatalogQuery, type Category, type Page, type Product } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import { Alert, Button, Card, ConfirmDialog, DataTable, ForbiddenState, Input, PageHeader, Select, Skeleton } from '@/shared/ui';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import { baseQuantity, quantityDifference, type Movement, type Stock, type StockDetail } from './api';

function InventoryTabs() {
  const { t } = useTranslation();
  const access = useCatalogAccess('stock.receive');
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t('inventory.title')}>
      <Button asChild variant="outline">
        <Link to="/company/warehouse/stock">{t('inventory.title')}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to="/company/warehouse/movements">{t('inventory.movements')}</Link>
      </Button>
      {access.writable && (
        <Button asChild>
          <Link to="/company/warehouse/receipts/new">{t('inventory.receive')}</Link>
        </Button>
      )}
    </nav>
  );
}

export function StockPage() {
  const { t } = useTranslation();
  const { membership, orgId } = useCatalogAccess('stock.receive');
  const allowed = membership.permissions.includes('stock.view');
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [active, setActive] = useState('');
  const [low, setLow] = useState(false),
    [offset, setOffset] = useState(0),
    [ordering, setOrdering] = useState('name');
  const query = useCatalogQuery<Page<Stock>>(
    `/inventory/stocks?${new URLSearchParams({ search, ordering, limit: '20', offset: String(offset), ...(low ? { low_stock: 'true' } : {}), ...(category ? { category_id: category } : {}), ...(active ? { is_active: active } : {}) })}`,
    orgId,
    allowed,
  );
  const categories = useCatalogQuery<Category[]>('/catalog/categories?flat=true', orgId, allowed);
  if (!allowed) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('inventory.title')} />
      <InventoryTabs />
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t('catalog.search')}
          placeholder={t('inventory.search')}
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
        <Select
          aria-label={t('catalog.sortOrder')}
          value={ordering}
          onChange={(e) => {
            setOrdering(e.target.value);
            setOffset(0);
          }}
        >
          <option value="name">{t('catalog.name')}</option>
          <option value="available">{t('inventory.available')}</option>
          <option value="-available">{t('inventory.availableDescending')}</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => {
              setLow(e.target.checked);
              setOffset(0);
            }}
          />
          {t('inventory.low')}
        </label>
      </div>
      <DataTable<Stock>
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        rowKey={(row) => row.product_id}
        empty={{ title: t('inventory.empty') }}
        pagination={{ offset, limit: 20, count: query.data?.count ?? 0, onChange: setOffset }}
        columns={[
          {
            key: 'product',
            header: t('catalog.name'),
            primary: true,
            cell: (row) => (
              <Link className="text-primary underline" to={`/company/warehouse/stock/${row.product_id}`}>
                {row.name} · {row.sku}
              </Link>
            ),
          },
          { key: 'quantity', header: t('inventory.quantity'), numeric: true, cell: (row) => `${row.quantity} ${row.base_unit}` },
          { key: 'reserved', header: t('inventory.reserved'), numeric: true, cell: (row) => row.reserved_quantity },
          {
            key: 'available',
            header: t('inventory.available'),
            numeric: true,
            cell: (row) => (
              <span
                className={
                  row.low_stock_threshold !== null && Number(row.available) < Number(row.low_stock_threshold)
                    ? 'font-semibold text-danger'
                    : ''
                }
              >
                {row.available}
              </span>
            ),
          },
          { key: 'threshold', header: t('inventory.threshold'), numeric: true, cell: (row) => row.low_stock_threshold ?? '—' },
        ]}
      />
    </div>
  );
}

export function StockDetailPage() {
  const { productId = '' } = useParams();
  const access = useCatalogAccess('stock.view');
  return <Detail key={`${access.orgId}:${productId}`} productId={productId} />;
}
function Detail({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const { orgId, membership } = useCatalogAccess('stock.view');
  const allowed = membership.permissions.includes('stock.view');
  const query = useCatalogQuery<StockDetail>(`/inventory/stocks/${productId}`, orgId, allowed);
  const settings = useCatalogAccess('stock.settings'),
    adjust = useCatalogAccess('stock.adjust'),
    write = useCatalogAccess('stock.write_off');
  const [threshold, setThreshold] = useState<string | null>(null),
    [dialog, setDialog] = useState<'adjust' | 'write' | null>(null);
  const save = useCatalogMutation<StockDetail>(`/inventory/stocks/${productId}`, orgId, 'PATCH');
  if (!allowed) return <ForbiddenState />;
  if (query.isError)
    return (
      <Alert tone="danger">
        {errorMessage(query.error, t)}
        <Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>
      </Alert>
    );
  if (!query.data) return <Skeleton className="h-48" />;
  const stock = query.data;
  return (
    <div className="space-y-5">
      <PageHeader title={stock.name} description={`${stock.sku} · ${stock.base_unit}`} />
      <InventoryTabs />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [t('inventory.quantity'), stock.quantity],
          [t('inventory.reserved'), stock.reserved_quantity],
          [t('inventory.available'), stock.available],
        ].map(([label, value]) => (
          <Card key={label} className="space-y-2 p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold">
              {value} {stock.base_unit}
            </p>
          </Card>
        ))}
      </div>
      <Card className="space-y-4 p-5">
        <Field label={t('inventory.threshold')}>
          <Input
            type="number"
            min="0"
            step="0.001"
            disabled={!settings.writable}
            value={threshold ?? stock.low_stock_threshold ?? ''}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>
        {settings.writable && (
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate({ version: stock.version, low_stock_threshold: (threshold ?? stock.low_stock_threshold) || null })}
          >
            {t('common.save')}
          </Button>
        )}
        <Feedback error={save.error} success={save.isSuccess} />
        <div className="flex flex-wrap gap-2">
          {adjust.writable && (
            <Button variant="outline" onClick={() => setDialog('adjust')}>
              {t('inventory.adjust')}
            </Button>
          )}
          {write.writable && (
            <Button variant="danger" onClick={() => setDialog('write')}>
              {t('inventory.writeOff')}
            </Button>
          )}
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t('inventory.reservations')}</h2>
        {stock.reservations.length ? (
          stock.reservations.map((row) => (
            <p key={row.id}>
              {row.order_number ? (
                <Link className="text-primary underline" to={`/company/orders/${row.source_id}`}>
                  {row.order_number}
                </Link>
              ) : (
                t('inventory.sources.ORDER')
              )}{' '}
              · {row.quantity} {stock.base_unit}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground">{t('inventory.noReservations')}</p>
        )}
      </Card>
      <Movements productId={productId} />
      {dialog && <StockAction key={dialog} stock={stock} mode={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function StockAction({ stock, mode, onClose }: { stock: StockDetail; mode: 'adjust' | 'write'; onClose: () => void }) {
  const { t } = useTranslation();
  const { orgId, writable } = useCatalogAccess(mode === 'adjust' ? 'stock.adjust' : 'stock.write_off');
  const [quantity, setQuantity] = useState(''),
    [reason, setReason] = useState(''),
    [unitId, setUnitId] = useState('');
  const product = useCatalogQuery<Product>(`/catalog/products/${stock.product_id}`, orgId, mode === 'write');
  const units = product.data?.units?.filter((unit) => unit.is_active) ?? [];
  const unit = units.find((row) => row.id === unitId) ?? units[0];
  const base = mode === 'write' ? baseQuantity(quantity, unit?.coefficient ?? '') : null;
  const delta = mode === 'adjust' ? quantityDifference(quantity, stock.quantity) : base ? `-${base}` : null;
  const action = useCatalogMutation<StockDetail>(
    mode === 'adjust' ? '/inventory/adjustments' : '/inventory/write-offs',
    orgId,
    'POST',
    true,
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(mode === 'adjust' ? 'inventory.adjust' : 'inventory.writeOff')}
      description={t('inventory.confirmMovement')}
      confirmLabel={t('catalog.confirm')}
      tone={mode === 'write' ? 'danger' : 'primary'}
      loading={action.isPending}
      confirmDisabled={
        !writable ||
        !delta ||
        reason.trim().length < 5 ||
        (mode === 'write' && (!unit || (!unit.allow_fraction && !Number.isInteger(Number(quantity)))))
      }
      onConfirm={() =>
        action.mutate(
          mode === 'adjust'
            ? { product_id: stock.product_id, actual_quantity: quantity, reason }
            : { product_id: stock.product_id, unit_id: unit?.id, quantity, reason },
          { onSuccess: onClose },
        )
      }
    >
      <div className="space-y-3">
        <Field label={t(mode === 'adjust' ? 'inventory.actual' : 'inventory.quantity')}>
          <Input
            type="number"
            min={mode === 'adjust' ? '0' : '0.001'}
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        {mode === 'write' && (
          <Field label={t('catalog.unitCode')}>
            <Select value={unit?.id ?? ''} onChange={(e) => setUnitId(e.target.value)}>
              {units.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('inventory.reason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={2000} />
        </Field>
        {delta && (
          <Alert>
            {t('inventory.difference')}: {delta} {stock.base_unit}
          </Alert>
        )}
        <Feedback error={action.error} />
      </div>
    </ConfirmDialog>
  );
}

export function ReceiptPage() {
  const { orgId } = useCatalogAccess('stock.receive');
  return <Receipt key={orgId} />;
}
type ReceiptDraft = { product: Product; unitId: string; quantity: string; key: number };
function Receipt() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orgId, membership, writable } = useCatalogAccess('stock.receive');
  const allowed = membership.permissions.includes('stock.receive');
  const [search, setSearch] = useState(''),
    [items, setItems] = useState<ReceiptDraft[]>([]),
    [note, setNote] = useState(''),
    [confirm, setConfirm] = useState(false);
  const serial = useRef(0);
  const selection = useMutation({
    mutationFn: (product: Product) => apiRequest<Product>(`/catalog/products/${product.id}`, { headers: { 'X-Org-Id': orgId } }),
    onSuccess: (product) => {
      const draft = { product, unitId: product.units?.find((row) => row.is_base)?.id ?? '', quantity: '', key: serial.current++ };
      setItems((previous) => (previous.length < 200 ? [...previous, draft] : previous));
      setSearch('');
    },
  });
  const products = useCatalogQuery<Page<Product>>(
    `/catalog/products?${new URLSearchParams({ search, is_active: 'true', limit: '20' })}`,
    orgId,
    allowed && !!search,
  );
  const receive = useCatalogMutation<{ received: number }>('/inventory/receipts', orgId, 'POST', true);
  const previews = items.map((item) => {
    const unit = item.product.units?.find((row) => row.id === item.unitId);
    return { item, unit, base: baseQuantity(item.quantity, unit?.coefficient ?? '') };
  });
  const valid =
    items.length > 0 &&
    items.length <= 200 &&
    previews.every(({ item, unit, base }) => !!base && !!unit && (unit.allow_fraction || Number.isInteger(Number(item.quantity))));
  if (!allowed) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('inventory.receive')} />
      <InventoryTabs />
      <Card className="space-y-4 p-5">
        <Field label={t('inventory.search')}>
          <Input
            value={search}
            disabled={!writable || selection.isPending}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const found = await products.refetch();
                const matches = found.data?.results.filter((row) => row.barcode === search || row.sku === search) ?? [];
                if (writable && matches.length === 1 && items.length < 200) {
                  const product = matches[0];
                  if (product) selection.mutate(product);
                }
              }
            }}
            placeholder={t('inventory.scanHint')}
          />
        </Field>
        <Feedback error={products.error} />
        <Feedback error={selection.error} />
        <div className="flex flex-wrap gap-2">
          {products.data?.results.map((product) => (
            <Button
              key={product.id}
              variant="outline"
              disabled={!writable || selection.isPending || items.length >= 200}
              onClick={() => {
                selection.mutate(product);
              }}
            >
              {product.name} · {product.sku}
            </Button>
          ))}
        </div>
        {previews.map(({ item, unit, base }) => (
          <div key={item.key} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
            <p className="font-medium sm:col-span-3">{item.product.name}</p>
            <Field label={t('catalog.unitCode')}>
              <Select
                value={item.unitId}
                disabled={!writable}
                onChange={(e) => setItems(items.map((row) => (row.key === item.key ? { ...row, unitId: e.target.value } : row)))}
              >
                {item.product.units
                  ?.filter((row) => row.is_active)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('inventory.quantity')}>
              <Input
                type="number"
                min="0.001"
                step={unit?.allow_fraction ? '0.001' : '1'}
                value={item.quantity}
                disabled={!writable}
                onChange={(e) => setItems(items.map((row) => (row.key === item.key ? { ...row, quantity: e.target.value } : row)))}
              />
            </Field>
            <Button variant="ghost" disabled={receive.isPending} onClick={() => setItems(items.filter((row) => row.key !== item.key))}>
              {t('inventory.remove')}
            </Button>
            {base && (
              <p className="sm:col-span-3">
                +{item.quantity} {unit?.code} = +{base} {item.product.base_unit}
              </p>
            )}
          </div>
        ))}
        <Field label={t('inventory.note')}>
          <Input value={note} maxLength={2000} disabled={!writable} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button disabled={!writable || !valid || receive.isPending} onClick={() => setConfirm(true)}>
          {t('catalog.confirm')}
        </Button>
        <Feedback error={receive.error} />
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('inventory.receive')}
        description={t('inventory.confirmMovement')}
        confirmLabel={t('catalog.confirm')}
        loading={receive.isPending}
        tone="primary"
        confirmDisabled={!valid || !writable}
        onConfirm={() =>
          receive.mutate(
            {
              items: items.map((row) => ({ product_id: row.product.id, unit_id: row.unitId, quantity: row.quantity })),
              note: note || null,
            },
            { onSuccess: () => navigate('/company/warehouse/stock') },
          )
        }
      >
        {previews.map(({ item, unit, base }) => (
          <p key={item.key}>
            {item.product.name}: +{item.quantity} {unit?.code} = +{base} {item.product.base_unit}
          </p>
        ))}
        <Feedback error={receive.error} />
      </ConfirmDialog>
    </div>
  );
}

export function MovementsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <PageHeader title={t('inventory.movements')} />
      <InventoryTabs />
      <Movements />
    </div>
  );
}
function Movements({ productId }: { productId?: string }) {
  const { t } = useTranslation();
  const { orgId, membership } = useCatalogAccess('stock.view');
  const allowed = membership.permissions.includes('stock.view');
  const [type, setType] = useState(''),
    [source, setSource] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [offset, setOffset] = useState(0),
    [product, setProduct] = useState(productId ?? '');
  const query = useCatalogQuery<Page<Movement>>(
    `/inventory/movements?${new URLSearchParams({ limit: '20', offset: String(offset), ...(product ? { product_id: product } : {}), ...(type ? { type } : {}), ...(source ? { source_type: source } : {}), ...(from ? { date_from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(to ? { date_to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) })}`,
    orgId,
    allowed,
  );
  const products = useCatalogQuery<Page<Product>>('/catalog/products?limit=100', orgId, allowed && !productId);
  if (!allowed) return <ForbiddenState />;
  return (
    <section className="space-y-4">
      <h2 className="font-semibold">{t('inventory.movements')}</h2>
      <div className="flex flex-wrap gap-3">
        {!productId && (
          <Select
            aria-label={t('catalog.products')}
            value={product}
            onChange={(e) => {
              setProduct(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t('catalog.products')}</option>
            {products.data?.results.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.sku}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label={t('inventory.movementType')}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('inventory.allTypes')}</option>
          {['RECEIPT', 'ADJUSTMENT', 'WRITE_OFF', 'RESERVE', 'RELEASE', 'SHIP', 'RETURN_IN'].map((value) => (
            <option key={value} value={value}>
              {t(`inventory.types.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('inventory.source')}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('inventory.allSources')}</option>
          {['MANUAL', 'IMPORT', 'ORDER', 'RETURN'].map((value) => (
            <option key={value} value={value}>
              {t(`inventory.sources.${value}`)}
            </option>
          ))}
        </Select>
        <Input
          aria-label={t('inventory.dateFrom')}
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setOffset(0);
          }}
        />
        <Input
          aria-label={t('inventory.dateTo')}
          type="date"
          value={to}
          min={from}
          onChange={(e) => {
            setTo(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <DataTable<Movement>
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        rowKey={(row) => row.id}
        empty={{ title: t('inventory.noMovements') }}
        pagination={{ offset, limit: 20, count: query.data?.count ?? 0, onChange: setOffset }}
        columns={[
          { key: 'type', header: t('inventory.movementType'), primary: true, cell: (row) => t(`inventory.types.${row.type}`) },
          {
            key: 'product',
            header: t('catalog.products'),
            cell: (row) => (
              <Link className="text-primary underline" to={`/company/warehouse/stock/${row.product_id}`}>
                {products.data?.results.find((product) => product.id === row.product_id)?.name ?? row.product_id}
              </Link>
            ),
          },
          { key: 'delta', header: t('inventory.difference'), numeric: true, cell: (row) => row.quantity_delta },
          { key: 'reserved', header: t('inventory.reservedDifference'), numeric: true, cell: (row) => row.reserved_delta },
          { key: 'after', header: t('inventory.quantity'), numeric: true, cell: (row) => row.quantity_after },
          { key: 'source', header: t('inventory.source'), cell: (row) => t(`inventory.sources.${row.source_type}`) },
          { key: 'reason', header: t('inventory.reason'), cell: (row) => row.reason ?? '—' },
          { key: 'created', header: t('catalog.createdAt'), cell: (row) => formatDateTime(row.created_at) },
        ]}
      />
    </section>
  );
}
