import type { FormEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCatalogQuery, type Page, type PriceList } from '@/features/catalog/api';
import { Field } from '@/features/catalog/shared';
import { Alert, Button, Input, Select } from '@/shared/ui';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import { initialTerms, localDateTime, termFields, type Terms, type TermsInput } from './api';

export function TermsSummary({
  terms,
  previous,
  priceListName,
}: {
  terms: Terms | TermsInput;
  previous?: Terms | null;
  priceListName?: string;
}) {
  const { t } = useTranslation();
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      {termFields.map((field) => {
        const value = terms[field];
        const before = previous?.[field];
        const changed = previous && JSON.stringify(before) !== JSON.stringify(value);
        const display = (item: typeof value, old = false) =>
          field === 'price_list_id'
            ? ((old ? previous?.price_list_name : (priceListName ?? ('price_list_name' in terms ? terms.price_list_name : null))) ??
              t('partnerships.fields.price_list_id'))
            : field === 'effective_from' && typeof item === 'string'
              ? formatDateTime(item)
              : Array.isArray(item)
                ? item.map((method) => t(`partnerships.methods.${method}`)).join(', ')
                : String(item ?? '—');
        return (
          <div key={field} className="min-w-0">
            <dt className="text-muted-foreground">{t(`partnerships.fields.${field}`)}</dt>
            <dd className="break-words">
              {changed && <del className="mr-2 text-danger">{display(before ?? null, true)}</del>}
              <span className={changed ? 'text-success' : ''}>{display(value)}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function TermsForm({
  orgId,
  current,
  canCredit,
  onSubmit,
  pending,
  error,
  buttonLabel,
}: {
  orgId: string;
  current?: Terms | null;
  canCredit: boolean;
  onSubmit: (terms: TermsInput) => void;
  pending: boolean;
  error?: unknown;
  buttonLabel: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(() => initialTerms(current));
  const [preview, setPreview] = useState(false);
  const [effectiveEdited, setEffectiveEdited] = useState(false);
  const lists = useCatalogQuery<Page<PriceList>>('/pricing/price-lists?is_active=true&limit=100', orgId);
  const set = <K extends keyof TermsInput>(field: K, next: TermsInput[K]) => {
    if (field === 'effective_from') setEffectiveEdited(true);
    setValue((old) => ({ ...old, [field]: next }));
    setPreview(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const submitted = effectiveEdited ? value : { ...value, effective_from: new Date().toISOString() };
    if (!preview) {
      setValue(submitted);
      setPreview(true);
    } else onSubmit(submitted);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {lists.error && <Alert tone="danger">{errorMessage(lists.error, t)}</Alert>}
      <Field label={t('partnerships.fields.price_list_id')}>
        <Select required value={value.price_list_id} onChange={(e) => set('price_list_id', e.target.value)}>
          <option value="">{t('partnerships.choosePriceList')}</option>
          {lists.data?.results
            .filter((list) => list.is_active)
            .map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['credit_limit', 'minimum_order_amount', 'delivery_fee'] as const).map((field) => (
          <Field key={field} label={t(`partnerships.fields.${field}`)}>
            <Input
              type="number"
              min="0"
              max="9999999999.99"
              step="0.01"
              required
              readOnly={field === 'credit_limit' && !canCredit}
              value={value[field] ?? ''}
              onChange={(e) => set(field, e.target.value)}
            />
          </Field>
        ))}
        {(['credit_days', 'return_days', 'dispute_window_hours'] as const).map((field) => (
          <Field key={field} label={t(`partnerships.fields.${field}`)}>
            <Input
              type="number"
              min={field === 'dispute_window_hours' ? 1 : 0}
              max={field === 'credit_days' ? 180 : field === 'return_days' ? 60 : 168}
              step="1"
              required
              readOnly={field === 'credit_days' && !canCredit}
              value={value[field] ?? ''}
              onChange={(e) => set(field, Number(e.target.value))}
            />
          </Field>
        ))}
        <Field label={t('partnerships.fields.free_delivery_threshold')}>
          <Input
            type="number"
            min="0.01"
            max="9999999999.99"
            step="0.01"
            value={value.free_delivery_threshold ?? ''}
            onChange={(e) => set('free_delivery_threshold', e.target.value || null)}
          />
        </Field>
        <Field label={t('partnerships.fields.effective_from')}>
          <Input
            type="datetime-local"
            required
            value={localDateTime(value.effective_from ?? new Date().toISOString())}
            onChange={(e) => {
              if (e.target.value) set('effective_from', new Date(e.target.value).toISOString());
            }}
          />
        </Field>
      </div>
      {!canCredit && <p className="text-sm text-muted-foreground">{t('partnerships.creditOwnerOnly')}</p>}
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 text-sm">{t('partnerships.fields.payment_methods')}</legend>
        {(['CASH', 'BANK_TRANSFER'] as const).map((method) => (
          <label key={method} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.payment_methods.includes(method)}
              onChange={(e) =>
                set(
                  'payment_methods',
                  e.target.checked ? [...value.payment_methods, method] : value.payment_methods.filter((item) => item !== method),
                )
              }
            />
            {t(`partnerships.methods.${method}`)}
          </label>
        ))}
      </fieldset>
      <Field label={t('partnerships.fields.note')}>
        <Input maxLength={5000} value={value.note ?? ''} onChange={(e) => set('note', e.target.value || null)} />
      </Field>
      {preview && (
        <div className="rounded-xl border p-4">
          <h3 className="mb-3 font-semibold">{t('partnerships.preview')}</h3>
          <TermsSummary
            terms={value}
            previous={current}
            priceListName={lists.data?.results.find((list) => list.id === value.price_list_id)?.name}
          />
        </div>
      )}
      {!!error && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      <Button
        type="submit"
        loading={pending}
        disabled={
          !value.price_list_id ||
          value.payment_methods.length === 0 ||
          lists.isLoading ||
          !lists.data?.results.some((list) => list.id === value.price_list_id && list.is_active)
        }
      >
        {preview ? buttonLabel : t('partnerships.preview')}
      </Button>
    </form>
  );
}
