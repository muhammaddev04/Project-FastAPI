import type { ReactNode } from 'react';
import { ArrowUpRight, Boxes, Store, Truck } from 'lucide-react';
import { BrandMark } from './BrandMark';

export function AuthLayout({ children, eyebrow, title, subtitle }: { children: ReactNode; eyebrow: string; title: string; subtitle: string }) {
  return (
    <main className="auth-layout">
      <section className="auth-visual" aria-label="TezFarmo wholesale network">
        <div className="auth-visual__topline">
          <BrandMark />
          <span className="auth-visual__badge">Built for the everyday trade</span>
        </div>
        <div className="auth-visual__copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="route-scene" aria-hidden="true">
          <div className="route-scene__line" />
          <div className="scene-node scene-node--warehouse"><Boxes /><span>Supplier</span></div>
          <div className="scene-node scene-node--truck"><Truck /></div>
          <div className="scene-node scene-node--store"><Store /><span>Retail store</span></div>
          <div className="route-scene__spark route-scene__spark--one" />
          <div className="route-scene__spark route-scene__spark--two" />
        </div>
        <div className="auth-visual__footnote"><span>One connected supply route</span><ArrowUpRight size={16} /></div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel__mobile-brand"><BrandMark compact /></div>
        <div className="auth-card">{children}</div>
      </section>
    </main>
  );
}
