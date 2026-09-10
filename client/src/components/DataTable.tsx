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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  globalFilterPlaceholder?: string;
  exportFilename?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  data,
  columns,
  globalFilterPlaceholder = 'Search…',
  exportFilename = 'export',
  pageSize = 20,
  onRowClick,
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
    const body = rows.map(row =>
      table.getVisibleFlatColumns()
        .filter(c => c.id !== 'actions')
        .map(col => {
          const val = row.getValue(col.id);
          return val == null ? '' : String(val);
        })
    );
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(12);
    doc.text(exportFilename, 14, 14);
    autoTable(doc, {
      head: [headers],
      body,
      startY: 22,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
    });
    doc.save(`${exportFilename}.pdf`);
  }, [table, exportFilename]);

  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const totalRows = table.getFilteredRowModel().rows.length;
  const from = totalRows === 0 ? 0 : pageIndex * currentPageSize + 1;
  const to = Math.min((pageIndex + 1) * currentPageSize, totalRows);

  return (
    <div className="datatable-wrapper">
      {/* Toolbar: export buttons left, search right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm btn-secondary" onClick={exportCSV} title="Export CSV">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV
          </button>
          <button className="btn btn-sm btn-secondary" onClick={exportPDF} title="Export PDF">
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
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520, borderRadius: 8, border: '1px solid var(--color-border)' }}>
        <table className="data-table" style={{ minWidth: '100%' }}>
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
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, flexWrap: 'wrap', gap: 8 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
