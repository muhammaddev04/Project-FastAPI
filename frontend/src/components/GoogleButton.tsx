import { Chrome } from 'lucide-react';
import { AuthButton } from './AuthButton';

export function GoogleButton({ busy, onClick }: { busy?: boolean; onClick: () => void }) {
  return <AuthButton type="button" variant="secondary" busy={busy} onClick={onClick}><Chrome size={17} /> Continue with Google</AuthButton>;
}
