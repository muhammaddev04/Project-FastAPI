import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button } from './button';
import { Card } from './card';
import { SkeletonRows } from './skeleton';
import { EmptyState, ErrorState } from './states';

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Shown as the card title on phones (no label in front). */
  primary?: boolean;
};

export type Pagination = { offset: number; limit: number; count: number; onChange: (offset: number) => void };

/**
 * FND-035 DataTable: dense business table in the product's language (subtle caption header, hairline rows, hover
 * tint, status chips) inside a card, with toolbar, FE-001 states and pagination. One DOM for every width: below
 * 768px each row becomes a stacked card whose cells carry their column label.
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
  onRowClick,
  selectedKey,
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
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Card className={cn('overflow-hidden', className)}>
      {toolbar ? <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:flex-wrap sm:items-center">{toolbar}</div> : null}
      {loading ? (
        <div className="p-5">
          <SkeletonRows rows={4} label={t('common.loading')} />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : !rows || rows.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <table className="w-full text-left text-[0.8125rem] max-md:block">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="border-b bg-subtle/70 text-[0.625rem] uppercase tracking-[0.1em] text-muted-foreground max-md:sr-only">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cn('px-5 py-3 font-bold', column.className)}>
                  {column.header}
                </th>
              ))}
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
                        'px-5 py-3.5 align-middle max-md:px-0',
                        column.primary
                          ? 'max-md:block max-md:pb-2 max-md:pt-0'
                          : 'max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:py-1.5 max-md:before:text-[0.75rem] max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]',
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
      )}
      {pagination && rows && rows.length > 0 && !loading && !error ? (
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-[0.8125rem] text-muted-foreground">
          <span>
            {t('table.range', {
              from: pagination.count ? pagination.offset + 1 : 0,
              to: pagination.offset + rows.length,
              total: pagination.count,
            })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="size-9"
              disabled={pagination.offset === 0}
              onClick={() => pagination.onChange(Math.max(0, pagination.offset - pagination.limit))}
              aria-label={t('table.previous')}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="size-9"
              disabled={pagination.offset + pagination.limit >= pagination.count}
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
