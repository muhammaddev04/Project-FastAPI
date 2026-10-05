import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  ErrorState,
  ForbiddenState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '@/shared/ui';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import { useCatalogMutation, useCatalogQuery, type Category, type Page, type Product, type PriceList, type Unit } from './api';
import { CatalogTabs, Feedback, Field } from './shared';
import { useCatalogAccess } from './api';

export function ProductPage() {
  const { productId } = useParams();
  const { membership } = useAreaContext();
  return <ProductEditor key={`${membership.organization_id}:${productId ?? 'new'}`} id={productId} />;
}

function ProductEditor({ id }: { id?: string }) {
  const { t } = useTranslation();
  const { orgId, membership, writable } = useCatalogAccess();
  const canView = membership.permissions.includes('catalog.view');
  const [tab, setTab] = useState('main');
  const query = useCatalogQuery<Product>(`/catalog/products/${id}`, orgId, !!id && canView);
  if (!canView || (!id && !membership.permissions.includes('catalog.manage'))) return <ForbiddenState />;
  if (id && query.isPending) return <Skeleton className="h-64" />;
  if (id && !query.data) return <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />;
  return (
    <div className="space-y-5">
      <PageHeader title={query.data?.name ?? t('catalog.addProduct')} />
      <CatalogTabs />
      {query.data && (
        <nav className="flex gap-2" aria-label={t('catalog.products')}>
          <Button variant={tab === 'main' ? 'primary' : 'outline'} onClick={() => setTab('main')}>
            {t('catalog.description')}
          </Button>
          <Button variant={tab === 'units' ? 'primary' : 'outline'} onClick={() => setTab('units')}>
            {t('catalog.units')}
          </Button>
          {membership.permissions.includes('pricing.view') && (
            <Button variant={tab === 'prices' ? 'primary' : 'outline'} onClick={() => setTab('prices')}>
              {t('catalog.kindPRICES')}
            </Button>
          )}
        </nav>
      )}
      {tab === 'main' && <ProductForm key={`${id}:${query.data?.version ?? 0}`} product={query.data} orgId={orgId} writable={writable} />}
      {tab === 'units' && query.data && <UnitPanel product={query.data} writable={writable} orgId={orgId} />}
      {tab === 'prices' && query.data && membership.permissions.includes('pricing.view') && (
        <ProductPrices product={query.data} orgId={orgId} />
      )}
    </div>
  );
}

function ProductForm({ product, orgId, writable }: { product?: Product; orgId: string; writable: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const categories = useCatalogQuery<Category[]>('/catalog/categories?flat=true', orgId);
  const mutation = useCatalogMutation<Product>(
    product ? `/catalog/products/${product.id}` : '/catalog/products',
    orgId,
    product ? 'PATCH' : 'POST',
    !product,
  );
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [category, setCategory] = useState(product?.category_id ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [unit, setUnit] = useState(product?.base_unit ?? 'PCS');
  const [active, setActive] = useState(product?.is_active ?? true);
  const [imageId, setImageId] = useState(product?.image_file_id ?? '');
  const imageUpload = useCatalogMutation<{ id: string }>('/files', orgId);
  const image = useCatalogQuery<{ url: string }>(`/files/${imageId}/url`, orgId, !!imageId);
  return (
    <Card className="p-5">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(
            {
              sku,
              name,
              category_id: category || null,
              barcode: barcode || null,
              description: description || null,
              base_unit: unit,
              is_active: active,
              image_file_id: imageId || null,
              ...(product ? { version: product.version } : {}),
            },
            { onSuccess: (result) => navigate(`/company/catalog/products/${result.id}`) },
          );
        }}
      >
        <Field label="SKU">
          <Input
            required
            maxLength={64}
            pattern="[A-Za-z0-9._-]+"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            disabled={!writable}
          />
        </Field>
        <Field label={t('catalog.name')}>
          <Input required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} disabled={!writable} />
        </Field>
        <Field label={t('catalog.category')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} disabled={!writable}>
            <option value="">—</option>
            {categories.data
              ?.filter((row) => row.is_active || row.id === category)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('catalog.baseUnit')}>
          <Select value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!writable}>
            {['PCS', 'KG', 'G', 'L', 'ML', 'M', 'PACK'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('catalog.barcode')}>
          <Input maxLength={32} value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={!writable} />
        </Field>
        <Field label={t('catalog.description')}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!writable} />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} disabled={!writable} onChange={(e) => setActive(e.target.checked)} />
          {t('catalog.active')}
        </label>
        <Field label={t('catalog.image')}>
          <Input
            type="file"
            accept="image/png,image/jpeg"
            disabled={!writable || imageUpload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const body = new FormData();
              body.append('file', file);
              body.append('category', 'PRODUCT_IMAGE');
              imageUpload.mutate(body, { onSuccess: (result) => setImageId(result.id) });
            }}
          />
        </Field>
        {image.data && <img src={image.data.url} alt={name} className="h-24 w-24 rounded-lg object-cover" />}
        <Feedback error={imageUpload.error} />
        {writable && (
          <Button disabled={mutation.isPending || imageUpload.isPending} type="submit">
            {t('catalog.save')}
          </Button>
        )}
        <Feedback error={mutation.error} success={mutation.isSuccess} />
      </form>
    </Card>
  );
}

function UnitPanel({ product, orgId, writable }: { product: Product; orgId: string; writable: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('BOX24');
  const [coefficient, setCoefficient] = useState('24');
  const [names, setNames] = useState({ tg: '', ru: '', en: '' });
  const [minimum, setMinimum] = useState('1');
  const [fraction, setFraction] = useState(false);
  const mutation = useCatalogMutation<Unit>(`/catalog/products/${product.id}/units`, orgId);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex justify-between">
        <h2 className="font-semibold">{t('catalog.units')}</h2>
        {writable && (
          <Button variant="outline" onClick={() => setOpen(!open)}>
            {t('catalog.addUnit')}
          </Button>
        )}
      </div>
      <div className="divide-y">
        {product.units?.map((unit) => (
          <div key={unit.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p>
              {unit.name[i18n.language] ?? unit.code} · 1 {unit.code} = {unit.coefficient} {product.base_unit} ·{' '}
              {t(unit.is_active ? 'catalog.active' : 'catalog.inactive')}
            </p>
            {unit.is_base ? (
              <span>{t('catalog.baseUnit')}</span>
            ) : (
              <DeactivateUnit productId={product.id} unit={unit} orgId={orgId} writable={writable} />
            )}
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader title={t('catalog.addUnit')} />
          <form
            aria-label={t('catalog.addUnit')}
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate(
                { code, coefficient, name: names, min_order_qty: minimum, allow_fraction: fraction },
                { onSuccess: () => setOpen(false) },
              );
            }}
          >
            <Field label={t('catalog.unitCode')}>
              <Input required maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label={t('catalog.coefficient')}>
              <Input required type="number" min="0.001" step="0.001" value={coefficient} onChange={(e) => setCoefficient(e.target.value)} />
            </Field>
            {(['tg', 'ru', 'en'] as const).map((lang) => (
              <Field key={lang} label={`${t('catalog.name')} (${lang})`}>
                <Input required maxLength={120} value={names[lang]} onChange={(e) => setNames({ ...names, [lang]: e.target.value })} />
              </Field>
            ))}
            <Field label={t('catalog.minimum')}>
              <Input required type="number" min="0.001" step="0.001" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
            </Field>
            <label>
              <input type="checkbox" checked={fraction} onChange={(e) => setFraction(e.target.checked)} /> {t('catalog.fraction')}
            </label>
            <p aria-live="polite">
              1 {code} = {coefficient || '0'} {product.base_unit}
            </p>
            <Button type="submit" disabled={!writable || mutation.isPending}>
              {t('catalog.save')}
            </Button>
            <Feedback error={mutation.error} />
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DeactivateUnit({ productId, unit, orgId, writable }: { productId: string; unit: Unit; orgId: string; writable: boolean }) {
  const { t } = useTranslation();
  const mutation = useCatalogMutation<Unit>(`/catalog/products/${productId}/units/${unit.id}/deactivate`, orgId);
  return (
    <div>
      <Button variant="outline" disabled={!writable || !unit.is_active || mutation.isPending} onClick={() => mutation.mutate(undefined)}>
        {t('catalog.deactivate')}
      </Button>
      <Feedback error={mutation.error} />
    </div>
  );
}

function ProductPrices({ product, orgId }: { product: Product; orgId: string }) {
  const { t } = useTranslation();
  const lists = useCatalogQuery<Page<PriceList>>('/pricing/price-lists?limit=100', orgId);
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">{t('catalog.priceHistory')}</h2>
      {lists.data?.results.map((list) => (
        <div key={list.id}>
          <a className="text-primary underline" href={`/company/pricing/lists/${list.id}`}>
            {list.name}
          </a>
          {product.units?.map((unit) => (
            <div key={unit.id} className="py-2">
              <strong>{unit.code}</strong>
              {product.prices
                ?.filter((price) => price.product_unit_id === unit.id && price.price_list_id === list.id)
                .map((price) => (
                  <p key={price.id}>
                    {price.price} TJS · {formatDateTime(price.valid_from)} → {price.valid_to ? formatDateTime(price.valid_to) : '∞'}
                  </p>
                ))}
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}
