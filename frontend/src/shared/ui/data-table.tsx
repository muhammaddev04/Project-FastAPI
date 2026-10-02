import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FilterX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button } from './button';
import { Card } from './card';
import { Select } from './select';
import { SkeletonRows } from './skeleton';
import { EmptyState, ErrorState, NoResultsState } from './states';

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Shown as the card title on phones (no label in front). */
  primary?: boolean;
  /** The column can be ordered by the server (the endpoint's API-003 `ordering` whitelist). */
  sortable?: boolean;
  /**
   * Money, quantities, counts. Right-aligns the column and applies tabular figures, so digits line up by
   * place value and a column of amounts can be compared by eye. Uses Inter's `tnum` rather than the
   * monospace family, which carries no Tajik glyphs.
   */
  numeric?: boolean;
};

export type Pagination = { offset: number; limit: number; count: number; onChange: (offset: number) => void };

export type SortDirection = 'asc' | 'desc';
export type SortState = { key: string; direction: SortDirection };
/** Server-side ordering: the table shows and changes the state; the caller requests the rows. */
export type Sorting = SortState & { onChange: (sort: SortState) => void };

/** API-003 filters of the list: whether any differs from the screen's default, and how to go back to it. */
export type Filtering = { changed: boolean; onReset: () => void };

/**
 * Row height. `compact` is for operational queues a person scans all day (admin review, future order and
 * ledger lists); `default` suits short tables read occasionally, such as a team of five.
 */
export type Density = 'compact' | 'default';

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/**
 * FND-035 DataTable: dense business table in the product's language (subtle caption header, hairline rows, hover
 * tint, status chips) inside a card, with toolbar, FE-001 states, pagination (API-002 limit/offset) and sorting
 * (API-003 `ordering`). Paging and sorting are server-side: the table reports the change and the caller fetches.
 * One DOM for every width: below 768px each row becomes a stacked card whose cells carry their column label, and the
 * order is chosen with a select there (the column headers are visually hidden).
 * `busy` (the next page is loading while the previous rows stay visible) disables paging and sorting.
 * `filters` adds "Reset filters" to the toolbar and to the empty state when filters hide every row.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  toolbar,
  loading = false,
  error,
  onRetry,
  empty,
  pagination,
  sort,
  filters,
  busy = false,
  onRowClick,
  selectedKey,
  density = 'default',
  className,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  caption?: string;
  toolbar?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  empty: { title: ReactNode; description?: ReactNode };
  pagination?: Pagination;
  sort?: Sorting;
  filters?: Filtering;
  busy?: boolean;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  density?: Density;
  className?: string;
}) {
  const { t } = useTranslation();
  const sortable = sort ? columns.filter((column) => column.sortable) : [];
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.count / pagination.limit)) : 1;
  const currentPage = pagination ? Math.floor(pagination.offset / pagination.limit) + 1 : 1;
  const toggle = (key: string) => {
    if (!sort) return;
    sort.onChange({ key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' });
  };
  const resetButton = filters?.changed ? (
    <Button variant="ghost" size="sm" onClick={filters.onReset} className="sm:ml-auto">
      <FilterX /> {t('table.resetFilters')}
    </Button>
  ) : null;
  return (
    <Card className={cn('overflow-hidden', className)}>
      {toolbar ? (
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:flex-wrap sm:items-center">
          {toolbar}
          {resetButton}
        </div>
      ) : null}
      {loading ? (
        <div className="p-5">
          <SkeletonRows rows={4} label={t('common.loading')} />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !rows || rows.length === 0 ? (
        /* Rows exist but none match vs nothing exists yet: different situations, different next step. */
        filters?.changed ? (
          <NoResultsState action={resetButton} compact={density === 'compact'} />
        ) : (
          <EmptyState title={empty.title} description={empty.description} compact={density === 'compact'} />
        )
      ) : (
        <>
        {sort && sortable.length > 0 ? (
          <div className="border-b p-3 md:hidden">
            <Select
              aria-label={t('table.sort')}
              value={`${sort.key}:${sort.direction}`}
              disabled={busy}
              onChange={(event) => {
                const [key = '', direction] = event.target.value.split(':');
                sort.onChange({ key, direction: direction === 'desc' ? 'desc' : 'asc' });
              }}
            >
              {sortable.flatMap((column) =>
                (['asc', 'desc'] as const).map((direction) => (
                  <option key={`${column.key}:${direction}`} value={`${column.key}:${direction}`}>
                    {t('table.sortOption', { column: column.header, direction: t(`table.${direction}`) })}
                  </option>
                )),
              )}
            </Select>
          </div>
        ) : null}
        {/* The card clips overflow, so a table wider than its container needs its own scroll region. */}
        <div className="md:overflow-x-auto">
        <table aria-busy={busy || undefined} className="w-full text-left text-label max-md:block">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="border-b bg-subtle/70 text-caption font-medium text-muted-foreground max-md:sr-only">
            <tr>
              {columns.map((column) => {
                const active = sort && column.sortable && sort.key === column.key ? sort.direction : null;
                const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ArrowUpDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={sort && column.sortable ? (active ? ARIA_SORT[active] : 'none') : undefined}
                    className={cn(
                      density === 'compact' ? 'px-4 py-2' : 'px-5 py-2.5',
                      column.numeric && 'text-right',
                      column.className,
                    )}
                  >
                    {sort && column.sortable ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(column.key)}
                        className={cn(
                          '-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60',
                          column.numeric && 'flex-row-reverse',
                          active && 'text-foreground',
                        )}
                      >
                        {column.header}
                        <Icon className="size-3.5" aria-hidden="true" />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y max-md:block max-md:space-y-3 max-md:divide-y-0 max-md:p-3">
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'transition-colors max-md:block max-md:rounded-xl max-md:border max-md:bg-surface max-md:p-3.5',
                    onRowClick && 'cursor-pointer hover:bg-primary/[0.04]',
                    !onRowClick && 'hover:bg-subtle/50',
                    selectedKey === key && 'bg-primary/[0.06] max-md:border-primary/40',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-label={column.header}
                      className={cn(
                        'align-middle max-md:px-0',
                        density === 'compact' ? 'px-4 py-2 max-md:py-1.5' : 'px-5 py-3 max-md:py-1.5',
                        column.numeric && 'text-right font-numeric max-md:text-left',
                        column.primary
                          ? 'max-md:block max-md:pb-2 max-md:pt-0'
                          : 'max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:py-1.5 max-md:before:text-caption max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]',
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        </>
      )}
      {pagination && rows && rows.length > 0 && !loading && !error ? (
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-label text-muted-foreground">
          <span>
            {t('table.range', {
              from: pagination.count ? pagination.offset + 1 : 0,
              to: pagination.offset + rows.length,
              total: pagination.count,
            })}
          </span>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap tabular-nums" aria-live="polite">
              {t('table.page', { page: currentPage, pages: pageCount })}
            </span>
            <Button
              variant="secondary"
              size="icon"
              className="size-9"
              disabled={busy || pagination.offset === 0}
              onClick={() => pagination.onChange(Math.max(0, pagination.offset - pagination.limit))}
              aria-label={t('table.previous')}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="size-9"
              disabled={busy || pagination.offset + pagination.limit >= pagination.count}
              onClick={() => pagination.onChange(pagination.offset + pagination.limit)}
              aria-label={t('table.next')}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
