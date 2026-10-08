import type { components } from '@/shared/api/schema';

export type Delivery = components['schemas']['DeliveryOut'];
export type DeliveryDetail = components['schemas']['DeliveryDetailOut'];
export type Run = components['schemas']['RunOut'];
export type RunDetail = components['schemas']['RunDetailOut'];
export type CourierToday = components['schemas']['CourierTodayOut'];
export type CourierStop = components['schemas']['CourierStopOut'];
export type StoreDelivery = components['schemas']['StoreDeliveryOut'];
export type SyncResult = components['schemas']['SyncResultOut'];

export const deliveryStatuses = ['PLANNED', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;
export const runStatuses = ['DRAFT', 'STARTED', 'FINISHED', 'CANCELLED'] as const;
export const failureReasons = ['STORE_CLOSED', 'REFUSED', 'ADDRESS_NOT_FOUND', 'NO_CONTACT', 'VEHICLE_ISSUE', 'OTHER'] as const;

export type DeliveryStatus = (typeof deliveryStatuses)[number];
export type FailureReason = (typeof failureReasons)[number];

/** A stop that is still going somewhere, which is what the board and the courier screen care about. */
export const openStatuses: readonly DeliveryStatus[] = ['PLANNED', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED'];

export function isOpen(status: string): boolean {
  return (openStatuses as readonly string[]).includes(status);
}

export function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * DEL-016: navigation hands off to the phone's own map app rather than embedding a provider.
 * Coordinates win when the store set them; otherwise the address string has to do.
 */
export function mapsUrl(stop: { address: string; latitude?: string | null; longitude?: string | null }): string {
  const destination = stop.latitude && stop.longitude ? `${stop.latitude},${stop.longitude}` : stop.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
