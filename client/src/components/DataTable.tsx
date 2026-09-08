import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { useState, useCallback } from 'react';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  globalFilterPlaceholder?: string;
  exportFilename?: string;
  pageSize?: number;
}

export function DataTable<T>({
  data,
  columns,
  globalFilterPlaceholder = 'Search…',
  exportFilename = 'export',
  pageSize = 20,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const exportCSV = useCallback(() => {
    const rows = table.getFilteredRowModel().rows;
    const headers = table.getVisibleFlatColumns()
      .filter(c => c.id !== 'actions')
      .map(c => String(c.columnDef.header ?? c.id));
    const csvRows = rows.map(row =>
      table.getVisibleFlatColumns()
        .filter(c => c.id !== 'actions')
        .map(col => {
          const val = row.getValue(col.id);
          const str = val == null ? '' : String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(',')
    );
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportFilename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [table, exportFilename]);

  const exportPDF = useCallback(() => {
    const rows = table.getFilteredRowModel().rows;
    const headers = table.getVisibleFlatColumns()
      .filter(c => c.id !== 'actions')
      .map(c => String(c.columnDef.header ?? c.id));

    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const thCells = headers.map(h => `<th>${escape(h)}</th>`).join('');
    const trRows = rows.map(row =>
      `<tr>${table.getVisibleFlatColumns()
        .filter(c => c.id !== 'actions')
        .map(col => {
          const val = row.getValue(col.id);
          return `<td>${escape(val == null ? '' : String(val))}</td>`;
        }).join('')}</tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${exportFilename}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #f0f0f0; font-weight: bold; }
  tr:nth-child(even) { background: #f9f9f9; }
</style></head><body>
<h2 style="margin-bottom:12px">${escape(exportFilename)}</h2>
<table><thead><tr>${thCells}</tr></thead><tbody>${trRows}</tbody></table>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }, [table, exportFilename]);

  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const totalRows = table.getFilteredRowModel().rows.length;
  const from = totalRows === 0 ? 0 : pageIndex * currentPageSize + 1;
  const to = Math.min((pageIndex + 1) * currentPageSize, totalRows);

  return (
    <div className="datatable-wrapper">
      {/* Toolbar: export buttons left, search right */}
      <div className="datatable-toolbar" style={{ marginBottom: 12 }}>
        <div className="datatable-actions">
          <button className="btn btn-sm btn-secondary" onClick={exportCSV} title="Export CSV">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV
          </button>
          <button className="btn btn-sm btn-secondary" onClick={exportPDF} title="Print / PDF">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            PDF
          </button>
        </div>

        {/* Search with magnifying glass icon */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: 'absolute', left: 10, width: 15, height: 15, color: 'var(--color-text-muted)', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="datatable-search"
            placeholder={globalFilterPlaceholder}
            value={globalFilter}
            onChange={e => setGlobalFilter(e.target.value)}
            style={{ paddingLeft: 32, paddingRight: 12, paddingTop: 7, paddingBottom: 7 }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="data-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      cursor: header.column.getCanSort() ? 'pointer' : 'default',
                      userSelect: 'none',
                      background: 'var(--color-surface)',
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' ? ' ↑'
                      : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '32px 0' }}>
                  No records found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination: left = size + count, right = page controls */}
      <div className="datatable-pagination">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            className="datatable-page-size"
            value={currentPageSize}
            onChange={e => table.setPageSize(Number(e.target.value))}
          >
            {[10, 20, 50, 100].map(n => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
          <span className="datatable-info">
            {totalRows === 0 ? 'No records' : `${from}–${to} of ${totalRows}`}
          </span>
        </div>

        <div className="datatable-page-btns">
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >«</button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >‹</button>
          <span style={{ fontSize: 13, padding: '0 8px' }}>
            Page {pageIndex + 1} of {table.getPageCount() || 1}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >›</button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >»</button>
        </div>
      </div>
    </div>
  );
}
