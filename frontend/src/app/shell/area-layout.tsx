import { Outlet } from 'react-router-dom';
import type { Area } from '@/shared/auth/context';
import { RequireArea } from '@/shared/auth/guards';
import { AppShell } from './app-shell';

/** Guards an area (/company, /store, /courier) and renders its shell around the child route. */
export function AreaLayout({ area }: { area: Area }) {
  return (
    <RequireArea area={area}>
      {(context) => (
        <AppShell area={area} me={context.me} membership={context.membership}>
          <Outlet context={context} />
        </AppShell>
      )}
    </RequireArea>
  );
}
