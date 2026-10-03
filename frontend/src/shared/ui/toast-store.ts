import type { ReactNode } from 'react';
import { create } from 'zustand';

export type Tone = 'success' | 'info' | 'warning' | 'danger';
export type ToastItem = { id: number; tone: Tone; title: ReactNode; description?: ReactNode };

export const useToasts = create<{ items: ToastItem[]; push: (item: Omit<ToastItem, 'id'>) => void; dismiss: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (item) => {
      const id = Date.now() + Math.random();
      set((state) => ({ items: [...state.items.slice(-2), { ...item, id }] }));
      window.setTimeout(() => set((state) => ({ items: state.items.filter((toast) => toast.id !== id) })), 5000);
    },
    dismiss: (id) => set((state) => ({ items: state.items.filter((toast) => toast.id !== id) })),
  }),
);

/** FE-002 result feedback: `toast({ tone: 'success', title })` after a mutation. */
export function toast(item: Omit<ToastItem, 'id'>) {
  useToasts.getState().push(item);
}
