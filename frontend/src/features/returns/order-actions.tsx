import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCatalogMutation, useCatalogQuery } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import type { OrderView } from '@/features/orders/api';
import { Alert, Button, Dialog, DialogContent, DialogHeader, Input, Select, Skeleton, Textarea } from '@/shared/ui';
import {
  deadlinePassed,
  disputeTypes,
  hoursLeft,
  returnReasons,
  validQuantity,
  type DisputeDetail,
  type Returnable,
  type ReturnDetail,
  type ReturnReason,
} from './api';
import { useReturnsAccess } from './access';
import { AttachmentsInput, type AttachmentFile } from './attachments';

/** RET-001: a return can only be asked for once the goods have arrived. */
const RETURNABLE_STATUSES = ['DELIVERED', 'DISPUTED', 'COMPLETED'];

/**
 * P10 §9 store actions on an order. Both buttons are their own window of time: the return closes at
 * `delivered_at + return_days` and the dispute at `delivered_at + dispute_window_hours`, so each hides
 * itself when its window has passed rather than letting someone fill a form the server will refuse.
 */
export function OrderReturnActions({ order }: { order: OrderView }) {
  const { t } = useTranslation();
  const { company, has } = useReturnsAccess();
  const [open, setOpen] = useState<'return' | 'dispute' | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  // The warehouse view carries no money and no terms, and the company never asks for a return of its own.
  if (company || !('terms_snapshot' in order)) return null;
  const returnDays = Number(order.terms_snapshot?.return_days ?? 0);
  const returnDeadline =
    order.delivered_at && returnDays > 0 ? new Date(new Date(order.delivered_at).getTime() + returnDays * 86_400_000).toISOString() : null;
  const returnable =
    has('returns.request') && RETURNABLE_STATUSES.includes(order.status) && !!returnDeadline && !deadlinePassed(returnDeadline, now);
  const windowHours = Number(order.terms_snapshot?.dispute_window_hours ?? 0);
  const disputeDeadline =
    order.delivered_at && windowHours > 0 ? new Date(new Date(order.delivered_at).getTime() + windowHours * 3_600_000).toISOString() : null;
  const disputeClosed = deadlinePassed(disputeDeadline, now);
  const left = Math.max(1, hoursLeft(disputeDeadline, now));
  const disputable = has('disputes.open') && order.status === 'DELIVERED' && !disputeClosed;
  if (!returnable && !disputable) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {returnable && (
        <Button variant="outline" onClick={() => setOpen('return')}>
          {t('returns.request')}
        </Button>
      )}
      {disputable && (
        <Button variant="outline" onClick={() => setOpen('dispute')}>
          {t('returns.openDispute')} · {t('returns.hoursLeft', { hours: left })}
        </Button>
      )}
      {open === 'return' && <ReturnDialog order={order} close={() => setOpen(null)} />}
      {open === 'dispute' && <DisputeDialog order={order} closed={disputeClosed} close={() => setOpen(null)} />}
    </div>
  );
}

function ReturnDialog({ order, close }: { order: OrderView; close: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const navigate = useNavigate();
  const [reason, setReason] = useState<ReturnReason>('DAMAGED');
  const [note, setNote] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const lines = useCatalogQuery<Returnable[]>(`/orders/${order.id}/returnable`, orgId);
  const mutation = useCatalogMutation<ReturnDetail>('/returns', orgId, 'POST', true);
  const available = (lines.data ?? []).filter((line) => Number(line.max_returnable) > 0);
  const chosen = available.filter((line) => (quantities[line.order_item_id] ?? '').trim() !== '');
  const valid =
    (reason !== 'OTHER' || note.trim().length > 0) &&
    chosen.length > 0 &&
    chosen.every((line) => validQuantity(quantities[line.order_item_id] ?? '', line.max_returnable, line.allow_fraction));
  const closed = available.length > 0 && deadlinePassed(available[0]!.return_deadline);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent>
        <DialogHeader title={t('returns.request')} />
        {lines.isLoading && <Skeleton className="h-24" />}
        <Feedback error={lines.error || mutation.error} />
        {closed && <Alert tone="warning">{t('returns.windowClosed')}</Alert>}
        {!closed && available.length === 0 && !lines.isLoading && <Alert tone="warning">{t('returns.nothingReturnable')}</Alert>}
        {!closed && available.length > 0 && !confirming && (
          <div className="space-y-3">
            <Field label={t('returns.reason')}>
              <Select value={reason} onChange={(event) => setReason(event.target.value as ReturnReason)}>
                {returnReasons.map((value) => (
                  <option key={value} value={value}>
                    {t(`returns.reasons.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {available.map((line) => (
              <Field
                key={line.order_item_id}
                label={`${line.product_name} · ${line.unit_code} (${t('returns.max')} ${line.max_returnable})`}
              >
                <Input
                  inputMode="decimal"
                  value={quantities[line.order_item_id] ?? ''}
                  invalid={
                    (quantities[line.order_item_id] ?? '') !== '' &&
                    !validQuantity(quantities[line.order_item_id] ?? '', line.max_returnable, line.allow_fraction)
                  }
                  onChange={(event) => setQuantities((current) => ({ ...current, [line.order_item_id]: event.target.value }))}
                />
              </Field>
            ))}
            <Field label={t('returns.note')}>
              <Textarea value={note} maxLength={5000} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <Button disabled={!valid} onClick={() => setConfirming(true)}>
              {t('returns.review')}
            </Button>
          </div>
        )}
        {confirming && (
          <div className="space-y-3">
            {/* The review step restates what will be sent: the request is the store's own claim, and the
                credit is only decided when the company completes the return (RET-010). */}
            <p className="font-semibold">{t(`returns.reasons.${reason}`)}</p>
            <ul className="space-y-1">
              {chosen.map((line) => (
                <li key={line.order_item_id}>
                  {line.product_name}: {quantities[line.order_item_id]} {line.unit_code}
                </li>
              ))}
            </ul>
            {note && <p className="break-words text-muted-foreground">{note}</p>}
            <Alert tone="info">{t('returns.creditLater')}</Alert>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t('common.back')}
              </Button>
              <Button
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate(
                    {
                      order_id: order.id,
                      reason_code: reason,
                      ...(note.trim() ? { note } : {}),
                      items: chosen.map((line) => ({
                        order_item_id: line.order_item_id,
                        quantity: quantities[line.order_item_id],
                      })),
                    },
                    { onSuccess: (data) => navigate(`/store/returns/${data.id}`) },
                  )
                }
              >
                {t('returns.send')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisputeDialog({ order, closed, close }: { order: OrderView; closed: boolean; close: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const navigate = useNavigate();
  const [type, setType] = useState('QUANTITY');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<AttachmentFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const mutation = useCatalogMutation<DisputeDetail>('/disputes', orgId, 'POST', true);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent>
        <DialogHeader title={t('returns.openDispute')} />
        {closed && <Alert tone="warning">{t('returns.disputeWindowClosed')}</Alert>}
        <div className="space-y-3">
          <Field label={t('returns.type')}>
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              {disputeTypes
                .filter((value) => value !== 'PAYMENT')
                .map((value) => (
                  <option key={value} value={value}>
                    {t(`returns.types.${value}`)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('returns.description')}>
            <Textarea value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <AttachmentsInput files={files} onChange={setFiles} onBusyChange={setUploading} />
        </div>
        <Feedback error={mutation.error} />
        <Button
          className="mt-4"
          disabled={closed || mutation.isPending || uploading || description.trim().length < 10}
          onClick={() =>
            mutation.mutate(
              {
                target_type: 'ORDER',
                order_id: order.id,
                type,
                description,
                ...(files.length ? { file_ids: files.map((file) => file.id) } : {}),
              },
              { onSuccess: (data) => navigate(`/store/disputes/${data.id}`) },
            )
          }
        >
          {t('returns.send')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
