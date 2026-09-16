import { useEffect, useMemo, useState } from 'react';

import { fetchTableRows } from '../lib/api.js';
import { renderCell } from './cells.jsx';
import RowDetailModal from './RowDetailModal.jsx';

const LIMIT_OPTIONS = [50, 100, 200, 500, 1000];

const WINDOW_OPTIONS = [
    { label: '15m', minutes: 15 },
    { label: '1h', minutes: 60 },
    { label: '2h', minutes: 120 },
    { label: '6h', minutes: 360 },
    { label: '24h', minutes: 1440 },
    { label: '7d', minutes: 10080 }
];

function Spinner({ label }) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-orange-500" />
            {label && <div className="text-sm">{label}</div>}
        </div>
    );
}

export default function TableView({ tableConfig, refreshKey, onFetchingChange, clientId }) {
    const [limit, setLimit] = useState(200);
    const [windowMinutes, setWindowMinutes] = useState(
        tableConfig?.time_window?.default_minutes ?? null
    );
    // Draft values being edited per column; applied filters are what was last
    // submitted to the server.
    const [filterDrafts, setFilterDrafts] = useState({});
    const [appliedFilters, setAppliedFilters] = useState({});
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [detailRow, setDetailRow] = useState(null);

    const filterColumns = tableConfig?.filter_columns || [];

    // Reset per-table state when the user picks a different table.
    useEffect(() => {
        setWindowMinutes(tableConfig?.time_window?.default_minutes ?? null);
        setFilterDrafts({});
        setAppliedFilters({});
        setData(null);
    }, [tableConfig?.name]);

    // Stable string key of applied filters so the effect deps work correctly.
    const appliedFiltersKey = JSON.stringify(appliedFilters);

    // Drop cached rows on any param change so we don't show stale data while loading.
    useEffect(() => {
        setData(null);
    }, [limit, windowMinutes, appliedFiltersKey, refreshKey]);

    useEffect(() => {
        if (!tableConfig) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const result = await fetchTableRows(tableConfig.name, {
                    limit,
                    windowMinutes: tableConfig.time_window ? windowMinutes : null,
                    filters: appliedFilters,
                    clientId
                });
                if (!cancelled) setData(result);
            } catch (err) {
                if (!cancelled) {
                    const hint = err.body && err.body.hint ? `\n${err.body.hint}` : '';
                    setError(err.message + hint);
                    setData(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableConfig, limit, windowMinutes, appliedFiltersKey, refreshKey, clientId]);

    useEffect(() => {
        onFetchingChange?.(loading);
    }, [loading, onFetchingChange]);

    const displayColumns = useMemo(() => data?.display_columns ?? tableConfig?.display_columns ?? [], [data, tableConfig]);

    if (!tableConfig) {
        return (
            <div className="flex flex-1 items-center justify-center text-zinc-500">
                Pick a table on the left to preview rows.
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="text-lg font-semibold text-red-600">Preview failed</div>
                <div className="max-w-2xl whitespace-pre-line text-sm text-zinc-600">{error}</div>
            </div>
        );
    }

    if (loading && !data) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <Spinner label={`Loading ${tableConfig.name}…`} />
            </div>
        );
    }

    if (!data) return null;

    const { schema, rows, total_rows, order_by } = data;

    function applyFilters(e) {
        if (e) e.preventDefault();
        const next = {};
        for (const col of filterColumns) {
            const v = (filterDrafts[col] || '').trim();
            if (v) next[col] = v;
        }
        setAppliedFilters(next);
    }

    function clearFilters() {
        setFilterDrafts({});
        setAppliedFilters({});
    }

    const hasAppliedFilter = Object.keys(appliedFilters).length > 0;
    const hasDraftChanges = filterColumns.some(
        (col) => (filterDrafts[col] || '') !== (appliedFilters[col] || '')
    );

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            {loading && (
                <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-orange-100">
                    <div className="loading-bar h-full w-1/3 bg-orange-500" />
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-zinc-800">{tableConfig.name}</span>
                    <span className="text-xs text-zinc-500">
                        showing {rows.length.toLocaleString()}
                        {total_rows > 0 && ` of ${total_rows.toLocaleString()}`}{' '}
                        row{rows.length === 1 ? '' : 's'} · {displayColumns.length} cols
                        {order_by && (
                            <span className="ml-2 text-zinc-400">
                                · <span className="font-mono">{order_by.column} {order_by.direction}</span>
                            </span>
                        )}
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {filterColumns.length > 0 && (
                        <form onSubmit={applyFilters} className="flex flex-wrap items-center gap-1">
                            {filterColumns.map((col) => (
                                <input
                                    key={col}
                                    type="text"
                                    value={filterDrafts[col] || ''}
                                    onChange={(e) =>
                                        setFilterDrafts((d) => ({ ...d, [col]: e.target.value }))
                                    }
                                    placeholder={col}
                                    className="input w-32 py-0.5 text-xs"
                                />
                            ))}
                            <button
                                type="submit"
                                disabled={!hasDraftChanges && !hasAppliedFilter}
                                className={'btn text-xs ' + (hasDraftChanges ? 'btn-primary' : '')}
                            >
                                apply
                            </button>
                            {hasAppliedFilter && (
                                <button type="button" onClick={clearFilters} className="btn text-xs">
                                    clear
                                </button>
                            )}
                        </form>
                    )}

                    {tableConfig.time_window && (
                        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                            window
                            <select
                                value={windowMinutes ?? ''}
                                onChange={(e) => setWindowMinutes(parseInt(e.target.value, 10))}
                                className="input py-0.5"
                                disabled={loading}
                            >
                                {WINDOW_OPTIONS.map((o) => (
                                    <option key={o.minutes} value={o.minutes}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                        rows
                        <select
                            value={limit}
                            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                            className="input py-0.5"
                            disabled={loading}
                        >
                            {LIMIT_OPTIONS.map((n) => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>

            <div className={'flex-1 overflow-auto bg-white transition-opacity ' + (loading ? 'opacity-60' : '')}>
                <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        <tr>
                            <th className="w-12 px-3 py-2 text-right text-zinc-400">#</th>
                            {displayColumns.map((col) => (
                                <th key={col.name} className="px-3 py-2 whitespace-nowrap">
                                    <div>{col.name}</div>
                                    {col.type && (
                                        <div className="font-mono text-[10px] font-normal lowercase text-zinc-400">
                                            {col.type.toLowerCase()}
                                        </div>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={displayColumns.length + 1}
                                    className="px-3 py-6 text-center text-zinc-500"
                                >
                                    No rows match the current filters.
                                </td>
                            </tr>
                        )}
                        {rows.map((r, i) => (
                            <tr
                                key={i}
                                onClick={() => setDetailRow(r)}
                                className="cursor-pointer border-b border-zinc-100 hover:bg-orange-50/50"
                            >
                                <td className="px-3 py-1.5 text-right font-mono text-xs text-zinc-400">
                                    {i + 1}
                                </td>
                                {displayColumns.map((col) => (
                                    <td
                                        key={col.name}
                                        className="max-w-xs px-3 py-1.5 align-top text-xs text-zinc-700"
                                    >
                                        {renderCell(r, col)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {detailRow && (
                <RowDetailModal
                    row={detailRow}
                    schema={schema}
                    tableName={tableConfig.name}
                    onClose={() => setDetailRow(null)}
                />
            )}
        </div>
    );
}
