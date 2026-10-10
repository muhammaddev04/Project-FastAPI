import Decimal from 'decimal.js';
import { AlertTriangle, BadgeDollarSign, Boxes, ClipboardList, Gavel, Truck, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useCatalogQuery } from '@/features/catalog/api';
import { Feedback } from '@/features/catalog/shared';
import type { StoreDelivery } from '@/features/delivery/api';
import { useDashboard, type CompanyDashboard, type StoreDashboard } from '@/features/reports/api';
import { useAreaContext } from '@/app/shell/use-area-context';
import { Badge, Button, Card, Skeleton } from '@/shared/ui';

/**
 * P12 §1.3: the figures of the active organization, each one a link to the screen that acts on it. A figure the
 * member may not read is absent from the answer, so it is simply not rendered - there is no "0" standing in for
 * "not allowed to see".
 */
type Figure = { key: string; value: string | number | null | undefined; to: string; icon: LucideIcon; tone?: 'danger' };

function FigureCards({ figures }: { figures: Figure[] }) {
  const { t } = useTranslation();
  const shown = figures.filter((figure) => figure.value !== null && figure.value !== undefined);
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {shown.map(({ key, value, to, icon: Icon, tone }) => (
        <Card key={key} className="flex flex-col gap-2 p-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
            {t(`dashboard.figures.${key}`)}
          </p>
          <strong className="text-2xl tabular-nums">{value}</strong>
          <Button asChild size="sm" variant="ghost" className="w-fit px-0">
            <Link to={to}>{t('dashboard.figures.open')}</Link>
          </Button>
          {tone === 'danger' && new Decimal(String(value).split(' ')[0] ?? '0').gt(0) ? (
            <Badge tone="danger">{t('dashboard.figures.attention')}</Badge>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

export function CompanyFigures() {
  const { t } = useTranslation();
  const dashboard = useDashboard();
  if (dashboard.isLoading) return <Skeleton className="h-28" />;
  if (dashboard.error) return <Feedback error={dashboard.error} />;
  const data = dashboard.data as CompanyDashboard | undefined;
  if (!data || data.type !== 'COMPANY') return null;
  return (
    <section className="space-y-3" aria-label={t('dashboard.figures.title')}>
      <FigureCards
        figures={[
          { key: 'newOrders', value: data.new_orders, to: '/company/orders', icon: ClipboardList },
          { key: 'deliveriesToday', value: data.deliveries_today, to: '/company/delivery', icon: Truck },
          {
            key: 'salesThisMonth',
            value: data.sales_this_month ? `${data.sales_this_month} TJS` : data.sales_this_month,
            to: '/company/reports/sales_summary',
            icon: BadgeDollarSign,
          },
          {
            key: 'receivables',
            value: data.receivables ? `${data.receivables} TJS` : data.receivables,
            to: '/company/finance',
            icon: Wallet,
          },
          {
            key: 'overdue',
            value: data.overdue ? `${data.overdue} TJS` : data.overdue,
            to: '/company/reports/receivables_aging',
            icon: AlertTriangle,
            tone: 'danger',
          },
          { key: 'lowStock', value: data.low_stock_products, to: '/company/warehouse/stock', icon: Boxes },
          { key: 'paymentsToConfirm', value: data.payments_to_confirm, to: '/company/finance/payments', icon: Wallet },
          { key: 'openDisputes', value: data.open_disputes, to: '/company/disputes', icon: Gavel },
        ]}
      />
    </section>
  );
}

/**
 * DEL-012: the handover code is returned by the order's own delivery endpoint, to a store member, and only
 * while the stop is in flight. The dashboard asks for it per stop rather than keeping it in a list payload,
 * so a code never travels in a response that anybody else could read.
 */
function HandoverCode({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const query = useCatalogQuery<StoreDelivery>(`/orders/${orderId}/delivery`, membership.organization_id, true, 30_000);
  if (!query.data?.code) return null;
  return (
    <span className="font-mono text-base font-semibold tracking-widest" aria-label={t('delivery.code')}>
      {query.data.code}
    </span>
  );
}

export function StoreFigures() {
  const { t } = useTranslation();
  const dashboard = useDashboard();
  if (dashboard.isLoading) return <Skeleton className="h-28" />;
  if (dashboard.error) return <Feedback error={dashboard.error} />;
  const data = dashboard.data as StoreDashboard | undefined;
  if (!data || data.type !== 'STORE') return null;
  return (
    <section className="space-y-3" aria-label={t('dashboard.figures.title')}>
      <FigureCards
        figures={[
          { key: 'activeOrders', value: data.active_orders, to: '/store/orders', icon: ClipboardList },
          { key: 'debt', value: data.debt ? `${data.debt} TJS` : data.debt, to: '/store/finance', icon: Wallet },
          {
            key: 'overdue',
            value: data.overdue ? `${data.overdue} TJS` : data.overdue,
            to: '/store/reports/store_debt',
            icon: AlertTriangle,
            tone: 'danger',
          },
        ]}
      />
      {(data.deliveries_today ?? []).length > 0 ? (
        <Card className="space-y-2 p-5">
          <h2 className="font-semibold">{t('dashboard.figures.deliveriesToday')}</h2>
          <ul className="space-y-2 text-sm">
            {(data.deliveries_today ?? []).map((delivery) => (
              <li key={delivery.delivery_id} className="flex flex-wrap items-center justify-between gap-3">
                <Link className="underline-offset-2 hover:underline" to={`/store/orders/${delivery.order_id}`}>
                  {delivery.order_number}
                </Link>
                <span className="flex items-center gap-3">
                  <HandoverCode orderId={delivery.order_id} />
                  <span className="text-muted-foreground">{t(`delivery.statuses.${delivery.status}`, delivery.status)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('dashboard.figures.codeHint')}</p>
        </Card>
      ) : null}
    </section>
  );
}
