import { Building2, Check, Store } from 'lucide-react';
import type { AccountRole } from '../lib/types';

const roles: Array<{ value: AccountRole; title: string; description: string; bullets: string[] }> = [
  { value: 'COMPANY', title: 'Distributor / supplier', description: 'For wholesale teams supplying products to retail partners.', bullets: ['Manage products and pricing', 'Coordinate stores and orders'] },
  { value: 'STORE', title: 'Retail store', description: 'For shops sourcing products and building reliable supply.', bullets: ['Browse trusted suppliers', 'Create and manage purchases'] },
];

export function RoleSelector({ value, onChange }: { value: AccountRole; onChange: (role: AccountRole) => void }) {
  return (
    <fieldset className="role-selector">
      <legend>What best describes your business?</legend>
      <div className="role-selector__grid">
        {roles.map((role) => {
          const selected = role.value === value;
          const Icon = role.value === 'COMPANY' ? Building2 : Store;
          return <button key={role.value} type="button" className={`role-card${selected ? ' role-card--selected' : ''}`} aria-pressed={selected} onClick={() => onChange(role.value)}>
            <span className="role-card__icon"><Icon size={20} /></span>
            <span className="role-card__check" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
            <strong>{role.title}</strong>
            <span>{role.description}</span>
            <small>{role.bullets.join(' · ')}</small>
          </button>;
        })}
      </div>
    </fieldset>
  );
}
