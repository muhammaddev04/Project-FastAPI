import { Outlet } from 'react-router-dom';
import type { Area } from '@/shared/auth/context';
import { RequireArea } from '@/shared/auth/guards';
import { AppShell } from './app-shell';
import { SubscriptionBanner } from '@/features/subscriptions/subscription-page';

/** Guards an area (/company, /store, /courier) and renders its shell around the child route. */
export function AreaLayout({ area }: { area: Area }) {
  return (
    <RequireArea area={area}>
      {(context) => (
        <AppShell area={area} me={context.me} membership={context.membership}>
          {area === 'company' ? (
            <SubscriptionBanner
              orgId={context.membership.organization_id}
              canView={context.membership.permissions.includes('subscription.view')}
            />
          ) : null}
          <Outlet context={context} />
        </AppShell>
      )}
    </RequireArea>
  );
}
