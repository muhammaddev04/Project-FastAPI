/**
 * The visual assets the public site is composed for (Phase E4).
 *
 * The repository ships no photography, and inventing it is not an option: a stock photo of strangers in a
 * warehouse is the generic corporate filler this redesign exists to avoid, and a fabricated product screenshot
 * would be a lie a visitor could catch after signing up. So each slot below has a designed graphic composition
 * standing in for it, and dropping the named file into `public/media/` is the only work needed to light it up.
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

/** A slot is lit when the asset exists; absent, the designed fallback is the composition. */
const AVAILABLE = new Set<string>();

export function assetSrc(file: string): string | undefined {
  return AVAILABLE.has(file) ? `/${file}` : undefined;
}

