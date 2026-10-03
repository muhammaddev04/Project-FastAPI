/**
 * The visual assets the public site is composed for (Phase E4).
 *
 * The Daylight-inspired redesign includes generated illustrations of wholesale distribution and delivery.
 * These depict the business context, not actual customers or a working product screen. Slots without an asset
 * retain their existing interface composition.
 *
 * This file holds no components, so it can be imported by anything without costing a hot reload.
 */
export type AssetSlot = {
  /** The file to drop into `public/media/`, which is all that is needed to light this slot up. */
  file: string;
  /** What the photograph has to show. Written for whoever sources it. */
  subject: string;
  aspect: '21/9' | '16/9' | '4/5';
  /** Where it appears, so the brief can be judged against the page. */
  placement: string;
};

/** The list to hand a photographer or picture editor. */
export const ASSET_MANIFEST: AssetSlot[] = [
  {
    file: 'media/wholesale-floor.jpg',
    subject:
      'A real Tajik wholesale depot or distributor floor: stacked cases and pallets, shelving, a loaded hand truck. Working space, no posed people, no faces needed, natural light.',
    aspect: '21/9',
    placement: 'Home, full-bleed band between the agreement and the trio.',
  },
  {
    file: 'media/shop-counter.jpg',
    subject:
      'The buying side: a neighbourhood shop counter or small retail interior in Dushanbe, stock on shelves behind it. Shot at the shopkeeper’s eye level, ordinary trading day.',
    aspect: '4/5',
    placement: 'How it works, inset beside the store’s path.',
  },
  {
    file: 'media/delivery-run.jpg',
    subject:
      'Goods in motion: a van or loaded vehicle at a kerb mid-delivery, crates being carried in. Daylight, documentary rather than advertising.',
    aspect: '16/9',
    placement: 'How it works, full-bleed band before the order pipeline.',
  },
];

/** Explicit slot-to-file mapping; absent assets keep the designed fallback. */
const AVAILABLE = new Map<string, string>([
  ['media/shop-counter.jpg', '/media/tezfarmo-distribution.png'],
  ['media/delivery-run.jpg', '/media/tezfarmo-delivery.png'],
]);

export function assetSrc(file: string): string | undefined {
  return AVAILABLE.get(file);
}

