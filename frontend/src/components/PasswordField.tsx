import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { FormField } from './FormField';

export function PasswordField(props: Omit<React.ComponentProps<typeof FormField>, 'type' | 'icon'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <FormField {...props} type={visible ? 'text' : 'password'} autoComplete={props.autoComplete ?? 'current-password'} icon={<LockKeyhole size={16} />} />
      <button type="button" className="password-field__toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Hide password' : 'Show password'}>
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
