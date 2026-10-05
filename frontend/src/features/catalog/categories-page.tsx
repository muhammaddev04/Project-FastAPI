import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, ForbiddenState, Input, PageHeader, Select, Skeleton } from '@/shared/ui';
import { errorMessage } from '@/shared/api/errors';
import { useCatalogMutation, useCatalogQuery, type Category } from './api';
import { CatalogTabs, Feedback, Field } from './shared';
import { useCatalogAccess } from './api';

export function CategoriesPage() {
  const { t } = useTranslation();
  const { membership, orgId, writable } = useCatalogAccess();
  const canView = membership.permissions.includes('catalog.view');
  const query = useCatalogQuery<Category[]>('/catalog/categories?flat=true', orgId, canView);
  const [editing, setEditing] = useState<Category | null>(null);
  const cache = useQueryClient();
  const reorder = useMutation({
    mutationFn: async ({ sourceId, target }: { sourceId: string; target: Category }) => {
      const source = query.data?.find((row) => row.id === sourceId);
      if (!source || source.parent_id !== target.parent_id || source.id === target.id) return;
      const siblings = (query.data ?? []).filter((row) => row.parent_id === target.parent_id && row.id !== source.id);
      siblings.splice(
        siblings.findIndex((row) => row.id === target.id),
        0,
        source,
      );
      for (const [index, row] of siblings.entries()) {
        if (row.sort_order !== index * 10)
          await apiRequest(`/catalog/categories/${row.id}`, {
            method: 'PATCH',
            headers: { 'X-Org-Id': orgId },
            body: { version: row.version, sort_order: index * 10 },
          });
      }
    },
    onSettled: () => void cache.invalidateQueries({ queryKey: ['catalog', orgId] }),
  });
  if (!canView) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('catalog.categories')} />
      <CatalogTabs />
      {query.isPending ? (
        <Skeleton className="h-32" />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : (
        query.data
          ?.filter((cat) => !cat.parent_id)
          .map((root) => (
            <Card key={root.id} className="space-y-2 p-4">
              <CategoryLine
                category={root}
                orgId={orgId}
                writable={writable && !reorder.isPending}
                onEdit={setEditing}
                onMove={(sourceId) => reorder.mutate({ sourceId, target: root })}
              />
              <div className="ml-6 border-l pl-4">
                {query.data
                  .filter((child) => child.parent_id === root.id)
                  .map((child) => (
                    <CategoryLine
                      key={child.id}
                      category={child}
                      orgId={orgId}
                      writable={writable && !reorder.isPending}
                      onEdit={setEditing}
                      onMove={(sourceId) => reorder.mutate({ sourceId, target: child })}
                    />
                  ))}
              </div>
            </Card>
          ))
      )}
      <Feedback error={reorder.error} />
      {writable && (
        <CategoryForm
          key={`${orgId}:${editing?.id}:${editing?.version}`}
          orgId={orgId}
          category={editing}
          categories={query.data ?? []}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryLine({
  category,
  orgId,
  writable,
  onEdit,
  onMove,
}: {
  category: Category;
  orgId: string;
  writable: boolean;
  onEdit: (cat: Category) => void;
  onMove: (sourceId: string) => void;
}) {
  const { t } = useTranslation();
  const mutation = useCatalogMutation<Category>(`/catalog/categories/${category.id}`, orgId, 'PATCH');
  return (
    <div
      draggable={writable}
      onDragStart={(event) => event.dataTransfer.setData('text/plain', category.id)}
      onDragOver={(event) => writable && event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!writable) return;
        const source = event.dataTransfer.getData('text/plain');
        if (source !== category.id) onMove(source);
      }}
      className="flex flex-wrap items-center gap-3 py-2"
    >
      <span className="flex-1">
        {category.name} · {t(category.is_active ? 'catalog.active' : 'catalog.inactive')}
      </span>
      {writable && (
        <>
          <Button variant="outline" onClick={() => onEdit(category)}>
            {t('catalog.edit')}
          </Button>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ version: category.version, is_active: !category.is_active })}
          >
            {t(category.is_active ? 'catalog.deactivate' : 'catalog.activate')}
          </Button>
        </>
      )}
      <Feedback error={mutation.error} />
    </div>
  );
}

function CategoryForm({
  orgId,
  category,
  categories,
  onSaved,
}: {
  orgId: string;
  category: Category | null;
  categories: Category[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(category?.name ?? '');
  const [parent, setParent] = useState(category?.parent_id ?? '');
  const [sort, setSort] = useState(category?.sort_order ?? 0);
  const mutation = useCatalogMutation<Category>(
    category ? `/catalog/categories/${category.id}` : '/catalog/categories',
    orgId,
    category ? 'PATCH' : 'POST',
  );
  return (
    <Card className="p-5">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(
            { name, parent_id: parent || null, sort_order: sort, ...(category ? { version: category.version } : {}) },
            {
              onSuccess: () => {
                setName('');
                onSaved();
              },
            },
          );
        }}
      >
        <h2 className="font-semibold sm:col-span-2">{t(category ? 'catalog.edit' : 'catalog.addCategory')}</h2>
        <Field label={t('catalog.name')}>
          <Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t('catalog.parent')}>
          <Select value={parent} onChange={(event) => setParent(event.target.value)}>
            <option value="">—</option>
            {categories
              .filter((cat) => !cat.parent_id && cat.id !== category?.id && cat.is_active)
              .map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('catalog.sortOrder')}>
          <Input type="number" value={sort} onChange={(event) => setSort(Number(event.target.value))} />
        </Field>
        <Button type="submit" disabled={mutation.isPending}>
          {t('catalog.save')}
        </Button>
        <Feedback error={mutation.error} />
      </form>
    </Card>
  );
}
