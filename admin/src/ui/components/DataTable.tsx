// Unified data table: sticky header, sortable columns, dense Vercel-like rows.
import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';

export type Column<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'right';
  value?: (row: T) => string | number | null; // sort accessor
  render: (row: T) => React.ReactNode;
};

export function DataTable<T extends { [k: string]: any }>({
  columns,
  rows,
  rowKey,
  onRowClick,
  maxHeight,
  empty = 'No data.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  maxHeight?: string;
  empty?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const acc = col.value || ((r: T) => r[col.key]);
    return [...rows].sort((a, b) => {
      const av = acc(a) ?? '';
      const bv = acc(b) ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
  }, [rows, sort, columns]);

  return (
    <div className={cn('overflow-auto', maxHeight)} style={maxHeight ? undefined : undefined}>
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr className="bg-panel">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  'whitespace-nowrap border-b border-hairline px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint',
                  c.align === 'right' && 'text-right',
                  c.sortable && 'cursor-pointer select-none hover:text-muted'
                )}
                onClick={
                  c.sortable
                    ? () => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: -1 }))
                    : undefined
                }
              >
                {c.label}
                {sort?.key === c.key && <span className="ml-1 text-gold">{sort.dir === 1 ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('transition-colors hover:bg-white/[0.025]', onRowClick && 'cursor-pointer')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2', c.align === 'right' && 'text-right')}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!sorted.length && <p className="py-10 text-center text-[13px] text-muted">{empty}</p>}
    </div>
  );
}
