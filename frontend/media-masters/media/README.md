# Public site imagery

## Daylight-inspired redesign

- `tezfarmo-distribution.png`: generated wholesale depot, box truck, store and goods handover. Used in the homepage hero, trade section, authentication background and store story.
- `tezfarmo-delivery.png`: generated box truck, shipment check and warehouse. Used in the delivery story.

These are illustrative AI-generated scenes, not photographs of real TezFarmo customers. They contain no product screenshots or business statistics. The direction is urban wholesale commerce and logistics, with warm natural light; agricultural and mountain imagery is excluded.

The `AVAILABLE` map in `src/features/public/media-assets.ts` maps the existing story slots to these files. The remaining slot descriptions below are retained as future photography briefs.

The public pages are composed around the slots below. Each one currently renders a designed graphic composition
built from real interface parts, so no page is blank or broken while they are missing.

To light a slot up: drop the named file into this directory and add its name to the `AVAILABLE` set in
`src/features/public/media-assets.ts`. No layout work is needed; the aspect ratio, crop, bleed and reveal are
already decided.

## What is needed

### `media/wholesale-floor.jpg`

- **Aspect**: 21/9
- **Placement**: Home, full-bleed band between the agreement and the trio.
- **Subject**: A real Tajik wholesale depot or distributor floor: stacked cases and pallets, shelving, a loaded hand truck. Working space, no posed people, no faces needed, natural light.

### `media/shop-counter.jpg`

- **Aspect**: 4/5
- **Placement**: How it works, inset beside the store’s path.
- **Subject**: The buying side: a neighbourhood shop counter or small retail interior in Dushanbe, stock on shelves behind it. Shot at the shopkeeper’s eye level, ordinary trading day.

### `media/delivery-run.jpg`

- **Aspect**: 16/9
- **Placement**: How it works, full-bleed band before the order pipeline.
- **Subject**: Goods in motion: a van or loaded vehicle at a kerb mid-delivery, crates being carried in. Daylight, documentary rather than advertising.

## Direction for all three

- Documentary, not advertising. Real Tajik wholesale and retail, working daylight.
- No posed models, no handshakes, no stock-photo gestures. Faces are not required.
- No screens in frame: a photograph of a monitor showing invented data is the same lie as a fake screenshot.
- Supply at 2400px on the long edge, then compress; these run full-bleed on large displays.
- Alt text lives in the `site.media.*` translation keys and must be written in tg, ru and en.
