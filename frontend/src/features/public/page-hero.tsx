import { Frame } from './primitives';

export function PageHero({ eyebrow, title, lead, image }: { eyebrow: string; title: string; lead: string; image: 'distribution' | 'delivery' | 'product' | 'journey' }) {
  return (
    <section className={`day-page-hero day-page-hero--${image}`}>
      <div className="day-page-hero-image" aria-hidden="true" />
      <Frame>
        <div className="day-page-hero-copy">
          <p className="day-kicker">{eyebrow}</p>
          <h1 className="font-serif text-hero">{title}</h1>
          <p className="day-page-hero-lead">{lead}</p>
        </div>
      </Frame>
    </section>
  );
}
