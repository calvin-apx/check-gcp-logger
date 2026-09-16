import { useState } from 'react';

import LogDetailModal from './LogDetailModal.jsx';

const SEVERITY_STYLES = {
    DEBUG: 'bg-slate-100 text-slate-600',
    INFO: 'bg-blue-100 text-blue-700',
    NOTICE: 'bg-blue-100 text-blue-700',
    WARNING: 'bg-amber-100 text-amber-800',
    ERROR: 'bg-red-100 text-red-700',
    CRITICAL: 'bg-red-200 text-red-800',
    ALERT: 'bg-red-200 text-red-800',
    EMERGENCY: 'bg-red-300 text-red-900',
    DEFAULT: 'bg-slate-100 text-slate-500'
};

function severityClass(sev) {
    return SEVERITY_STYLES[sev] || SEVERITY_STYLES.DEFAULT;
}

function formatTimestamp(ts) {
    if (!ts) return '—';
    try {
        const d = new Date(ts);
        const pad = (n) => String(n).padStart(2, '0');
        return (
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
        );
    } catch (_e) {
        return String(ts);
    }
}

export default function LogTable({
    entries,
    isFetching,
    lastError,
    emptyHint,
    totalCount,
    focusedMode,
    hiddenFails,
    onDisableFocus
}) {
    const [openEntry, setOpenEntry] = useState(null);

    if (isFetching && entries.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-zinc-500">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-orange-500" />
                    <div className="text-sm">Loading logs…</div>
                </div>
            </div>
        );
    }

    if (lastError) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="text-lg font-semibold text-red-600">Query failed</div>
                <div className="max-w-2xl text-sm text-slate-600">{lastError}</div>
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center text-slate-500">
                {emptyHint || 'No entries.'}
            </div>
        );
    }

    const showFocusedStrip =
        focusedMode &&
        typeof totalCount === 'number' &&
        totalCount > 0;
    const filteredOut = showFocusedStrip ? Math.max(0, totalCount - entries.length) : 0;

    return (
        <>
            {showFocusedStrip && (
                <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-xs">
                    <span className="text-zinc-600">
                        Showing <span className="font-semibold text-zinc-800">{entries.length.toLocaleString()}</span>
                        {' / '}{totalCount.toLocaleString()} logs{' '}
                        <span className="text-zinc-400">(focused — {filteredOut.toLocaleString()} hidden)</span>
                    </span>
                    {hiddenFails > 0 && (
                        <span className="flex items-center gap-2 rounded bg-red-100 px-2 py-0.5 text-red-700">
                            <span>
                                <strong>{hiddenFails}</strong> hidden error{hiddenFails === 1 ? '' : 's'}/warnings — toggle off to see
                            </span>
                            <button
                                type="button"
                                onClick={onDisableFocus}
                                className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
                            >
                                show all
                            </button>
                        </span>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-auto bg-white">
                <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <tr>
                            <th className="px-3 py-2 w-44">Timestamp</th>
                            <th className="px-3 py-2 w-24">Severity</th>
                            <th className="px-3 py-2 w-56">Function</th>
                            <th className="px-3 py-2">Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((e) => (
                            <tr
                                key={e.insert_id || `${e.timestamp}-${Math.random()}`}
                                onClick={() => setOpenEntry(e)}
                                className="cursor-pointer border-b border-zinc-100 hover:bg-orange-50/50"
                            >
                                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-slate-700">
                                    {formatTimestamp(e.timestamp)}
                                </td>
                                <td className="px-3 py-1.5">
                                    <span className={`badge ${severityClass(e.severity)}`}>
                                        {e.severity || 'DEFAULT'}
                                    </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-slate-700">
                                    {e.function_name || '—'}
                                </td>
                                <td className="px-3 py-1.5 text-slate-800">
                                    <div className="line-clamp-2 break-words">{e.message}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {openEntry && (
                <LogDetailModal entry={openEntry} onClose={() => setOpenEntry(null)} />
            )}
        </>
    );
}