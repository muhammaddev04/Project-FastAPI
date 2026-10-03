import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@/shared/i18n';
import { renderWithProviders } from '@/test/render';
import { Avatar, CodeInput, ConfirmDialog, DataTable, FormField, LinkTabs, StatusBadge, Tabs, toast } from './index';

type Row = { id: string; name: string; role: string };
const ROWS: Row[] = [
  { id: '1', name: 'Dilshod Rahimov', role: 'Owner' },
  { id: '2', name: 'Madina Saidova', role: 'Manager' },
];
const COLUMNS = [
  { key: 'name', header: 'Member', cell: (row: Row) => row.name, primary: true },
  { key: 'role', header: 'Role', cell: (row: Row) => row.role },
];

describe('design system components (FND-035, CR-002)', () => {
  beforeEach(() => setLanguage('en'));

  it('StatusBadge words each status family with its existing translations', () => {
    render(
      <>
        <StatusBadge kind="verification" value="PENDING" />
        <StatusBadge kind="request" value="UNDER_REVIEW" />
        <StatusBadge kind="member" value="SUSPENDED" />
      </>,
    );
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('Under review')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('Avatar shows initials for a person and no initials for an organization', () => {
    const { container } = render(
      <>
        <Avatar name="Dilshod Rahimov" />
        <Avatar kind="store" />
      </>,
    );
    expect(screen.getByText('DR')).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('DataTable renders one table with labelled cells, empty state and paging', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        caption="Team"
        empty={{ title: 'No members' }}
        pagination={{ offset: 0, limit: 2, count: 3, onChange }}
      />,
    );
    const table = screen.getByRole('table', { name: 'Team' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Manager').closest('td')).toHaveAttribute('data-label', 'Role');
    expect(screen.getByText('1–2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onChange).toHaveBeenCalledWith(2);

    rerender(<DataTable columns={COLUMNS} rows={[]} rowKey={(row) => row.id} empty={{ title: 'No members' }} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No members')).toBeInTheDocument();
  });

  it('ConfirmDialog asks before acting and can be cancelled', async () => {
    const onConfirm = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Remove
          </button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            tone="danger"
            title="Remove member?"
            confirmLabel="Remove member"
            onConfirm={onConfirm}
          />
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove member?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove member' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('Tabs are keyboard operable; LinkTabs mark the current route', async () => {
    function Harness() {
      const [value, setValue] = useState<'a' | 'b'>('a');
      return (
        <Tabs
          label="Sections"
          value={value}
          onChange={setValue}
          items={[
            { value: 'a', label: 'First' },
            { value: 'b', label: 'Second' },
          ]}
        />
      );
    }
    render(<Harness />);
    screen.getByRole('tab', { name: 'First' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');

    render(
      <MemoryRouter initialEntries={['/company/settings/profile']}>
        <LinkTabs
          label="Settings"
          items={[
            { to: '/company/settings/profile', label: 'Profile' },
            { to: '/company/settings/verification', label: 'Verification' },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  });

  it('CodeInput keeps digits only (paste-friendly), at most six, and shows them in the slots', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <FormField label="Verification code">
        <CodeInput onChange={onChange} />
      </FormField>,
    );
    const input = screen.getByLabelText('Verification code');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    await userEvent.click(input);
    await userEvent.paste('code: 482 913 7');
    expect(input).toHaveValue('482913');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ target: input }));
    const slots = container.querySelectorAll('[aria-hidden="true"] > div');
    expect([...slots].map((slot) => slot.textContent).join('')).toBe('482913');
    await userEvent.type(input, '{backspace}{backspace}');
    expect(input).toHaveValue('4829');
  });

  it('toast shows a dismissible result message', async () => {
    renderWithProviders(<p>page</p>);
    act(() => toast({ tone: 'success', title: 'Organization profile saved.' }));
    expect(await screen.findByText('Organization profile saved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Organization profile saved.')).not.toBeInTheDocument();
  });
});
