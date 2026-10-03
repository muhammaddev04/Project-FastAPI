import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setLanguage } from '@/shared/i18n';
import { DataTable, type Column, type SortState } from './data-table';

type Row = { id: string; name: string; submitted: string };
const ROWS: Row[] = [
  { id: '1', name: 'Pamir Distribution', submitted: '26.09.2026' },
  { id: '2', name: 'Corner Market', submitted: '27.09.2026' },
];
const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Organization', cell: (row) => row.name, primary: true },
  { key: 'submitted', header: 'Submitted', cell: (row) => row.submitted, sortable: true },
];

function renderTable(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      caption="Queue"
      empty={{ title: 'Nothing to review' }}
      {...props}
    />,
  );
}

describe('FND-035 DataTable: server-side sorting and pagination', () => {
  beforeEach(() => setLanguage('en'));

  it('marks the sorted column with aria-sort and only sortable columns get a sort button', () => {
    renderTable({ sort: { key: 'submitted', direction: 'asc', onChange: vi.fn() } });
    const table = screen.getByRole('table', { name: 'Queue' });
    const [organization, submitted] = within(table).getAllByRole('columnheader');
    expect(submitted).toHaveAttribute('aria-sort', 'ascending');
    expect(organization).not.toHaveAttribute('aria-sort');
    expect(within(organization!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(submitted!).getByRole('button', { name: 'Submitted' })).toBeEnabled();
  });

  it('toggles ascending -> descending -> ascending through onChange', async () => {
    const onChange = vi.fn<(sort: SortState) => void>();
    const { rerender } = renderTable({ sort: { key: 'submitted', direction: 'asc', onChange } });
    await userEvent.click(screen.getByRole('button', { name: 'Submitted' }));
    expect(onChange).toHaveBeenLastCalledWith({ key: 'submitted', direction: 'desc' });

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        caption="Queue"
        empty={{ title: 'x' }}
        sort={{ key: 'submitted', direction: 'desc', onChange }}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Submitted' })).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(screen.getByRole('button', { name: 'Submitted' }));
    expect(onChange).toHaveBeenLastCalledWith({ key: 'submitted', direction: 'asc' });
  });

  it('a sortable column that is not the current one starts ascending and shows aria-sort="none"', async () => {
    const onChange = vi.fn<(sort: SortState) => void>();
    renderTable({ sort: { key: 'other', direction: 'desc', onChange } });
    expect(screen.getByRole('columnheader', { name: 'Submitted' })).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Submitted' }));
    expect(onChange).toHaveBeenCalledWith({ key: 'submitted', direction: 'asc' });
  });

  it('offers the order as a labelled select for phones (headers are visually hidden there)', async () => {
    const onChange = vi.fn<(sort: SortState) => void>();
    renderTable({ sort: { key: 'submitted', direction: 'asc', onChange } });
    const select = screen.getByRole('combobox', { name: 'Sort order' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Submitted: ascending', 'Submitted: descending']);
    await userEvent.selectOptions(select, 'submitted:desc');
    expect(onChange).toHaveBeenCalledWith({ key: 'submitted', direction: 'desc' });
  });

  it('shows the range and the current page and moves by one page', async () => {
    const onChange = vi.fn();
    renderTable({ rows: ROWS, pagination: { offset: 20, limit: 20, count: 45, onChange } });
    expect(screen.getByText('21–22 of 45')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onChange).toHaveBeenLastCalledWith(40);
  });

  it("disables the last page's Next button and the first page's Previous button", () => {
    renderTable({ pagination: { offset: 40, limit: 20, count: 42, onChange: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
  });

  it('while busy (next page loading) keeps the rows but disables paging and sorting', () => {
    renderTable({
      busy: true,
      pagination: { offset: 20, limit: 20, count: 45, onChange: vi.fn() },
      sort: { key: 'submitted', direction: 'asc', onChange: vi.fn() },
    });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Corner Market')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submitted' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Sort order' })).toBeDisabled();
  });

  it('loading, error (with retry) and empty states replace the table and its controls', async () => {
    const onRetry = vi.fn();
    const pagination = { offset: 0, limit: 20, count: 0, onChange: vi.fn() };
    const sort = { key: 'submitted', direction: 'asc' as const, onChange: vi.fn() };
    const { rerender } = renderTable({ loading: true, rows: undefined, pagination, sort });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={undefined}
        rowKey={(row) => row.id}
        empty={{ title: 'Nothing to review' }}
        error="Could not load"
        onRetry={onRetry}
        pagination={pagination}
        sort={sort}
      />,
    );
    expect(screen.getByText('Could not load')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        empty={{ title: 'Nothing to review' }}
        pagination={pagination}
        sort={sort}
      />,
    );
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Sort order' })).not.toBeInTheDocument();
  });

  it('offers "Reset filters" only while filters differ from the default, in the toolbar and the empty state', async () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <DataTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        toolbar={<span>tools</span>}
        empty={{ title: 'Nothing to review' }}
        filters={{ changed: false, onReset }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        toolbar={<span>tools</span>}
        empty={{ title: 'Nothing to review' }}
        filters={{ changed: true, onReset }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onReset).toHaveBeenCalledTimes(1);

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        toolbar={<span>tools</span>}
        empty={{ title: 'Nothing to review' }}
        filters={{ changed: true, onReset }}
      />,
    );
    expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to review')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reset filters' })).toHaveLength(2);

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        toolbar={<span>tools</span>}
        empty={{ title: 'Nothing to review' }}
        filters={{ changed: false, onReset }}
      />,
    );
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
  });

  it('has no sort UI when the table is not given a sort state', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: 'Submitted' })).not.toHaveAttribute('aria-sort');
    expect(screen.queryByRole('button', { name: 'Submitted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
