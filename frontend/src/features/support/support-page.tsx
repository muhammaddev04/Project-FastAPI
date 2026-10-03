import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StandaloneLayout } from '@/app/shell/standalone-layout';
import { apiRequest } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { AccountMenu } from '@/shared/auth/account-menu';
import { homePath } from '@/shared/auth/context';
import type { Me } from '@/shared/auth/types';
import { useSessionStore } from '@/shared/auth/session-store';
import { Button, Card, Dialog, DialogContent, DialogHeader, DialogTrigger, PageHeader, Textarea } from '@/shared/ui';

type Ticket = {
  has_image?: boolean;
  image_count?: number;
  id: string;
  user_id: string;
  kind: string;
  subject: string;
  message: string;
  page_url: string | null;
  status: string;
  reply: string | null;
  created_at: string;
};
const PAGE_SIZE = 50;

function Screenshot({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="block cursor-zoom-in rounded-xl focus-visible:outline focus-visible:outline-2">
          <img src={url} alt={t('support.screenshot')} className="max-h-64 max-w-full rounded-xl border object-contain" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[95vw]">
        <DialogHeader title={t('support.screenshot')} />
        <img src={url} alt={t('support.screenshot')} className="mx-auto mt-4 max-h-[75vh] max-w-full object-contain" />
      </DialogContent>
    </Dialog>
  );
}

function TicketImage({ ticketId, index }: { ticketId: string; index: number }) {
  const { t } = useTranslation();
  const image = useQuery({
    queryKey: ['support-image', ticketId, index],
    queryFn: () => apiRequest<{ url: string }>(`/support/${ticketId}/image?index=${index}`),
    staleTime: 60_000,
    refetchInterval: 240_000,
  });
  if (image.isPending) return <p role="status">{t('support.loading')}</p>;
  if (image.isError)
    return (
      <Button variant="ghost" onClick={() => void image.refetch()}>
        {t('support.retry')}
      </Button>
    );
  return <Screenshot url={image.data.url} />;
}

function TicketEditor({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [status, setStatus] = useState(ticket.status);
  const [reply, setReply] = useState(ticket.reply ?? '');
  const mutation = useMutation({
    mutationFn: () => apiRequest(`/admin/support/${ticket.id}`, { method: 'PATCH', body: { status, reply } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['support'] }),
  });
  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <label className="block space-y-1">
        <span>{t('support.status')}</span>
        <select className="w-full rounded-xl border bg-surface p-2" value={status} onChange={(e) => setStatus(e.target.value)}>
          {['OPEN', 'IN_PROGRESS', 'RESOLVED'].map((value) => (
            <option key={value} value={value}>
              {t(`support.statuses.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span>{t('support.reply')}</span>
        <Textarea maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} />
      </label>
      {mutation.isError && (
        <p role="alert" className="text-danger">
          {errorMessage(mutation.error, t)}
        </p>
      )}
      {mutation.isSuccess && <p role="status">{t('support.saved')}</p>}
      <Button disabled={mutation.isPending}>{t('support.save')}</Button>
    </form>
  );
}

export function SupportContent({ admin = false }: { admin?: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState('BUG');
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [imageError, setImageError] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [images]);
  const [message, setMessage] = useState('');
  const tickets = useQuery({
    queryKey: ['support', admin, page],
    queryFn: () => apiRequest<Ticket[]>(`${admin ? '/admin/support' : '/support'}?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`),
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!images.length) return apiRequest('/support', { method: 'POST', body: { kind, message: message.trim() } });
      const body = new FormData();
      body.append('kind', kind);
      body.append('message', message.trim());
      images.forEach((image) => body.append('image', image));
      return apiRequest('/support/with-image', { method: 'POST', body });
    },
    onSuccess: () => {
      setMessage('');
      setImages([]);
      if (imageInput.current) imageInput.current.value = '';
      setPage(0);
      void client.invalidateQueries({ queryKey: ['support'] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!mutation.isPending && (message.trim() || images.length)) mutation.mutate();
  }
  return (
    <div className="space-y-6">
      <PageHeader title={t('common.support')} description={t(admin ? 'support.adminHint' : 'support.hint')} />
      {!admin && (
        <Card className="p-5">
          <form className="space-y-4" onSubmit={submit}>
            <label className="block space-y-1">
              <span>{t('support.kind')}</span>
              <select className="w-full rounded-xl border bg-surface p-2" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="BUG">{t('support.kinds.BUG')}</option>
                <option value="FEEDBACK">{t('support.kinds.FEEDBACK')}</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span>{t('support.message')}</span>
              <Textarea
                maxLength={5000}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('support.messageHint')}
              />
            </label>
            <div className="space-y-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-subtle px-3 py-2 text-sm font-medium focus-within:ring-2 focus-within:ring-ring">
                <span>{t('support.attachImage')}</span>
                <input
                  ref={imageInput}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    const valid = files.filter(
                      (file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 5 * 1024 * 1024,
                    );
                    setImageError(valid.length !== files.length);
                    setImages((current) => [...current, ...valid]);
                    event.target.value = '';
                  }}
                />
              </label>
              <p className="text-sm text-muted-foreground">{t('support.imageHint')}</p>
              {imageError && (
                <p role="alert" className="text-danger">
                  {t('support.imageError')}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {previews.map((url, index) => (
                  <div key={url} className="space-y-2">
                    <Screenshot url={url} />
                    <p className="break-all text-sm">{images[index]?.name}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={mutation.isPending}
                      onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                    >
                      {t('support.removeImage')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            {mutation.isError && (
              <p role="alert" className="text-danger">
                {errorMessage(mutation.error, t)}
              </p>
            )}
            {mutation.isSuccess && (
              <p role="status" className="text-primary">
                {t('support.sent')}
              </p>
            )}
            <Button disabled={mutation.isPending || (!message.trim() && !images.length)}>{t('support.send')}</Button>
          </form>
        </Card>
      )}
      <h2 className="text-lg font-semibold">{t(admin ? 'support.all' : 'support.mine')}</h2>
      {tickets.isPending && <p role="status">{t('support.loading')}</p>}
      {tickets.isError && (
        <div role="alert">
          <p>{errorMessage(tickets.error, t)}</p>
          <Button onClick={() => void tickets.refetch()}>{t('support.retry')}</Button>
        </div>
      )}
      {tickets.data?.length === 0 && <p>{t('support.empty')}</p>}
      {tickets.data?.map((ticket) => (
        <Card key={ticket.id} className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="break-words font-semibold">{t(`support.kinds.${ticket.kind}`)}</h3>
            <span className="rounded-lg bg-subtle px-2 py-1 text-sm">{t(`support.statuses.${ticket.status}`)}</span>
          </div>
          <p className="text-sm text-muted-foreground">{new Date(ticket.created_at).toLocaleString()}</p>
          {admin && (
            <p className="break-all text-sm text-muted-foreground">
              {t('support.author')}: {ticket.user_id}
            </p>
          )}
          <p className="whitespace-pre-wrap break-words">{ticket.message}</p>
          {ticket.has_image && (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: ticket.image_count ?? 1 }, (_, index) => (
                <TicketImage key={index} ticketId={ticket.id} index={index} />
              ))}
            </div>
          )}
          {ticket.page_url && (
            <p className="break-all text-sm">
              {t('support.page')}: {ticket.page_url}
            </p>
          )}
          {ticket.reply && (
            <div className="rounded-xl bg-subtle p-3">
              <p className="font-medium">{t('support.reply')}</p>
              <p className="whitespace-pre-wrap break-words">{ticket.reply}</p>
            </div>
          )}
          {admin && <TicketEditor ticket={ticket} />}
        </Card>
      ))}
      <div className="flex gap-2">
        <Button disabled={page === 0 || tickets.isFetching} onClick={() => setPage(page - 1)}>
          {t('support.previous')}
        </Button>
        <Button disabled={!tickets.data || tickets.data.length < PAGE_SIZE || tickets.isFetching} onClick={() => setPage(page + 1)}>
          {t('support.next')}
        </Button>
      </div>
    </div>
  );
}

export function SupportPage({ me }: { me: Me }) {
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  return (
    <StandaloneLayout back={homePath(me, activeOrgId)} actions={<AccountMenu me={me} />} className="mx-auto max-w-3xl px-4 py-8">
      <SupportContent />
    </StandaloneLayout>
  );
}
