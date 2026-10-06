import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIsMutating } from '@tanstack/react-query';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useCatalogMutation, useCatalogQuery, type Page, type Category } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import type { Partnership } from '@/features/partnerships/api';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  ForbiddenState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '@/shared/ui';
import { money, type Cart, type Product, type Order } from './api';

export function BuyingPage({ cart = false, onBehalf = false }: { cart?: boolean; onBehalf?: boolean }) {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const orgId = membership.organization_id;
  const allowed = membership.permissions.includes(onBehalf ? 'orders.create' : cart ? 'cart.manage' : 'store_catalog.view');
  const [params, setParams] = useSearchParams();
  const route = useParams();
  const partners = useCatalogQuery<Page<Partnership>>('/partnerships?status=ACTIVE&limit=100', orgId, allowed);
  const selected = route.partnershipId ?? params.get('partnership') ?? partners.data?.results[0]?.id ?? '';
  if (!allowed) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t(onBehalf ? 'orders.onBehalf' : cart ? 'orders.cart' : 'orders.storeCatalog')} />
      <Feedback error={partners.error} />
      {partners.isLoading ? (
        <Skeleton className="h-12" />
      ) : (
        <Field label={t(onBehalf ? 'orders.customer' : 'orders.supplier')}>
          <Select value={selected} onChange={(e) => setParams({ partnership: e.target.value })} disabled={!!route.partnershipId}>
            <option value="">{t('orders.selectPartner')}</option>
            {partners.data?.results.map((row) => (
              <option key={row.id} value={row.id}>
                {row.partner?.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!partners.isLoading && !partners.data?.count && <Alert>{t('orders.noPartners')}</Alert>}
      {selected &&
        (cart ? (
          <CartPanel key={`${orgId}:${selected}`} orgId={orgId} partnershipId={selected} />
        ) : (
          <CatalogPanel
            key={`${orgId}:${selected}`}
            orgId={orgId}
            partnershipId={selected}
            onBehalf={onBehalf}
            partner={partners.data?.results.find((row) => row.id === selected)}
          />
        ))}
    </div>
  );
}

function CatalogPanel({
  orgId,
  partnershipId,
  onBehalf,
  partner,
}: {
  orgId: string;
  partnershipId: string;
  onBehalf: boolean;
  partner?: Partnership;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const [chosen, setChosen] = useState<Record<string, { quantity: string; product: string; unit: string; price: string }>>({});
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  const base = onBehalf ? `/orders/catalog/${partnershipId}` : `/store/catalog/${partnershipId}`;
  const categories = useCatalogQuery<Category[]>(`${base}/categories`, orgId);
  const products = useCatalogQuery<Page<Product>>(
    `${base}/products?${new URLSearchParams({ search, offset: String(offset), limit: '20', ...(category ? { category_id: category } : {}) })}`,
    orgId,
  );
  const cart = useCatalogQuery<Cart>(`/store/cart/${partnershipId}`, orgId, !onBehalf);
  const create = useCatalogMutation<Order>('/orders', orgId, 'POST', true);
  const subtotal = Object.values(chosen).reduce((sum, row) => sum + Number(money(Number(row.quantity) * Number(row.price))), 0);
  const terms = partner?.current_terms;
  const deliveryFee =
    terms?.free_delivery_threshold != null && subtotal >= Number(terms.free_delivery_threshold) ? 0 : Number(terms?.delivery_fee ?? 0);
  return (
    <div className="space-y-4">
      {!onBehalf && (
        <Button asChild>
          <Link to={`/store/cart/${partnershipId}`}>
            {t('orders.openCart')} ({cart.data?.items.length ?? 0})
          </Link>
        </Button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          aria-label={t('orders.search')}
          placeholder={t('orders.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <Select
          aria-label={t('orders.category')}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('orders.allCategories')}</option>
          {categories.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
      </div>
      <Feedback error={products.error || categories.error || cart.error} />
      {products.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.data?.results.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              orgId={orgId}
              partnershipId={partnershipId}
              existing={cart.data}
              onChoose={
                onBehalf
                  ? (unitId, quantity, code, price) =>
                      setChosen((old) => ({ ...old, [unitId]: { quantity, product: product.name, unit: code, price } }))
                  : undefined
              }
            />
          ))}
        </div>
      )}
      {!products.isLoading && !products.data?.count && <Alert>{t('orders.noProducts')}</Alert>}
      <div className="flex gap-2">
        <Button variant="outline" disabled={!offset} onClick={() => setOffset((old) => Math.max(0, old - 20))}>
          {t('table.previous')}
        </Button>
        <Button variant="outline" disabled={offset + 20 >= (products.data?.count ?? 0)} onClick={() => setOffset((old) => old + 20)}>
          {t('table.next')}
        </Button>
      </div>
      {onBehalf && (
        <Card className="space-y-3 p-4">
          <h2>{t('orders.cart')}</h2>
          {Object.entries(chosen).map(([id, row]) => (
            <div key={id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {row.product} · {row.quantity} {row.unit} · {money(Number(row.quantity) * Number(row.price))}
              </span>
              <Button
                variant="outline"
                onClick={() => setChosen((old) => Object.fromEntries(Object.entries(old).filter(([key]) => key !== id)))}
              >
                {t('orders.remove')}
              </Button>
            </div>
          ))}
          <p>
            {t('orders.subtotal')}: {money(subtotal)} TJS
          </p>
          <p>
            {t('orders.deliveryFee')}: {money(deliveryFee)} TJS
          </p>
          <Field label={t('orders.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
          </Field>
          {subtotal < Number(terms?.minimum_order_amount ?? 0) && (
            <Alert tone="warning">
              {t('orders.minimumWarning')} {terms?.minimum_order_amount}
            </Alert>
          )}
          <Button
            disabled={!Object.keys(chosen).length || subtotal < Number(terms?.minimum_order_amount ?? 0)}
            onClick={() => setPreview(true)}
          >
            {t('orders.reviewOrder')}
          </Button>
        </Card>
      )}
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent>
          <DialogHeader title={t('orders.reviewOrder')} />
          <div className="my-4 space-y-2">
            {Object.values(chosen).map((row, index) => (
              <p key={index}>
                {row.product} · {row.quantity} {row.unit} · {money(Number(row.quantity) * Number(row.price))}
              </p>
            ))}
            <p>
              {t('orders.total')}: {money(subtotal + deliveryFee)} TJS
            </p>
          </div>
          <Feedback error={create.error} />
          <Button
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                {
                  partnership_id: partnershipId,
                  items: Object.entries(chosen).map(([id, row]) => ({ product_unit_id: id, quantity: row.quantity })),
                  store_note: note || null,
                },
                { onSuccess: (order) => navigate(`/company/orders/${order.id}`) },
              )
            }
          >
            {t('orders.sendOrder')}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductCard({
  product,
  orgId,
  partnershipId,
  existing,
  onChoose,
}: {
  product: Product;
  orgId: string;
  partnershipId: string;
  existing?: Cart;
  onChoose?: (unitId: string, quantity: string, code: string, price: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [unitId, setUnitId] = useState(product.units[0]?.id ?? '');
  const unit = product.units.find((row) => row.id === unitId)!;
  const [quantity, setQuantity] = useState(String(unit?.min_order_qty ?? 1));
  const mutation = useCatalogMutation<Cart>(`/store/cart/${partnershipId}/items/${unitId}`, orgId, 'PUT');
  const valid = Number(quantity) >= Number(unit.min_order_qty) && (unit.allow_fraction || Number.isInteger(Number(quantity)));
  return (
    <Card className="min-w-0 space-y-3 p-4">
      <h2 className="break-words font-semibold">{product.name}</h2>
      <p className="text-sm text-muted-foreground">{product.sku}</p>
      <Field label={`${t('orders.unit')} · ${product.name}`}>
        <Select
          value={unitId}
          onChange={(e) => {
            setUnitId(e.target.value);
            setQuantity(String(product.units.find((row) => row.id === e.target.value)?.min_order_qty ?? 1));
          }}
        >
          {product.units.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name[i18n.language] ?? row.name.en ?? row.code}
            </option>
          ))}
        </Select>
      </Field>
      <p>
        {money(unit.price)} TJS · {t(`orders.availability.${unit.availability_status}`)}
      </p>
      <Field label={`${t('orders.quantity')} · ${product.name}`}>
        <Input
          type="number"
          min={Number(unit.min_order_qty)}
          step={unit.allow_fraction ? '0.001' : '1'}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </Field>
      <Feedback error={mutation.error} success={mutation.isSuccess} />
      <Button
        disabled={!valid || mutation.isPending}
        onClick={() =>
          onChoose
            ? onChoose(unitId, quantity, unit.code, unit.price)
            : mutation.mutate({
                quantity: String(Number(quantity) + Number(existing?.items.find((row) => row.product_unit_id === unitId)?.quantity ?? 0)),
              })
        }
      >
        {t('orders.addToCart')}
      </Button>
    </Card>
  );
}

function CartPanel({ orgId, partnershipId }: { orgId: string; partnershipId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pendingEdits = useIsMutating({ mutationKey: ['catalog', orgId] });
  const query = useCatalogQuery<Cart>(`/store/cart/${partnershipId}`, orgId);
  const clear = useCatalogMutation(`/store/cart/${partnershipId}`, orgId, 'DELETE');
  const checkout = useCatalogMutation<Order>(`/store/cart/${partnershipId}/checkout`, orgId, 'POST', true);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  if (query.isLoading) return <Skeleton className="h-40" />;
  const cart = query.data;
  return (
    <div className="space-y-4">
      <Feedback error={query.error || clear.error} />
      <Button asChild variant="outline">
        <Link to={`/store/catalog?partnership=${partnershipId}`}>{t('orders.storeCatalog')}</Link>
      </Button>
      {cart && (
        <>
          <DataTable
            rows={cart.items}
            rowKey={(row) => row.product_unit_id}
            empty={{ title: t('orders.emptyCart') }}
            columns={[
              { key: 'name', header: t('orders.product'), primary: true, cell: (row) => row.product_name },
              { key: 'unit', header: t('orders.unit'), cell: (row) => row.unit_code },
              {
                key: 'quantity',
                header: t('orders.quantity'),
                cell: (row) => (
                  <CartQuantity key={`${row.product_unit_id}:${row.quantity}`} orgId={orgId} partnershipId={partnershipId} line={row} />
                ),
              },
              { key: 'price', header: t('orders.price'), cell: (row) => (row.price ? money(row.price) : '—') },
              { key: 'total', header: t('orders.total'), cell: (row) => money(row.line_total) },
            ]}
          />
          <div className="space-y-3">
            <p>
              {t('orders.subtotal')}: {money(cart.subtotal)} TJS
            </p>
            <p>
              {t('orders.deliveryFee')}: {money(cart.delivery_fee)} TJS
            </p>
            <p>
              {t('orders.total')}: {money(Number(cart.subtotal) + Number(cart.delivery_fee))} TJS
            </p>
            <progress
              className="w-full"
              max={Math.max(Number(cart.minimum_order_amount), 1)}
              value={Number(cart.subtotal)}
              aria-label={t('orders.minimumProgress')}
            />
            <p>
              {t('orders.minimum')}: {money(cart.minimum_order_amount)} TJS
            </p>
            {cart.warnings.map((warning, index) => (
              <Alert key={index} tone="warning">
                {t(`errors.${warning.code}`)}
              </Alert>
            ))}
            <Field label={t('orders.note')}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!cart.items.length || !!cart.warnings.length || pendingEdits > 0 || query.isFetching}
                onClick={() => setPreview(true)}
              >
                {t('orders.reviewOrder')}
              </Button>
              <Button variant="outline" disabled={!cart.items.length || clear.isPending} onClick={() => clear.mutate(undefined)}>
                {t('orders.clearCart')}
              </Button>
            </div>
          </div>
          <Dialog open={preview} onOpenChange={setPreview}>
            <DialogContent>
              <DialogHeader title={t('orders.reviewOrder')} />
              <div className="my-4 space-y-2">
                {cart.items.map((row) => (
                  <p key={row.product_unit_id}>
                    {row.product_name} · {row.quantity} {row.unit_code} · {money(row.line_total)}
                  </p>
                ))}
                <p>
                  {t('orders.total')}: {money(Number(cart.subtotal) + Number(cart.delivery_fee))} TJS
                </p>
                {note && <p>{note}</p>}
              </div>
              <Feedback error={checkout.error} />
              <Button
                disabled={checkout.isPending}
                onClick={() =>
                  checkout.mutate({ store_note: note || null }, { onSuccess: (order) => navigate(`/store/orders/${order.id}`) })
                }
              >
                {t('orders.sendOrder')}
              </Button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function CartQuantity({ orgId, partnershipId, line }: { orgId: string; partnershipId: string; line: Cart['items'][number] }) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState(line.quantity);
  const mutation = useCatalogMutation<Cart>(`/store/cart/${partnershipId}/items/${line.product_unit_id}`, orgId, 'PUT');
  return (
    <div className="space-y-2">
      <Input
        aria-label={`${t('orders.quantity')} · ${line.product_name}`}
        type="number"
        min="0"
        step={line.allow_fraction ? '0.001' : '1'}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onBlur={() => {
          if (quantity !== line.quantity) mutation.mutate({ quantity });
        }}
        disabled={mutation.isPending}
      />
      <Feedback error={mutation.error} />
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ quantity: '0' })}>
        {t('orders.remove')}
      </Button>
    </div>
  );
}
