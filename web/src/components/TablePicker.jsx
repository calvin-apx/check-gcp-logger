import { useMemo } from 'react';

export default function TablePicker({
    tables,
    selected,
    onSelect,
    loading,
    error,
    clients = [],
    clientId,
    onClientChange
}) {
    // Group by dataset so the picker shows where each table lives.
    const grouped = useMemo(() => {
        const map = new Map();
        for (const t of tables) {
            if (!map.has(t.dataset)) map.set(t.dataset, []);
            map.get(t.dataset).push(t);
        }
        return Array.from(map.entries());
    }, [tables]);

    return (
        <aside className="flex w-72 flex-col border-r border-zinc-200 bg-white">
            <div className="space-y-2 border-b border-zinc-200 p-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Tables
                </h2>
                {/* The table views used to be pinned to one hard-coded tenant. */}
                <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        Client
                    </span>
                    <select
                        className="input w-full"
                        value={clientId || ''}
                        onChange={(e) => onClientChange && onClientChange(e.target.value)}
                        disabled={!clients.length}
                    >
                        {!clients.length && <option value="">Loading…</option>}
                        {clients.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="flex-1 overflow-y-auto">
                {loading && (
                    <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-orange-500" />
                        Loading tables…
                    </div>
                )}
                {error && (
                    <div className="p-4 text-sm text-red-600">
                        <div className="font-medium">Couldn't list tables</div>
                        <div className="mt-1 text-xs">{error}</div>
                    </div>
                )}
                {!loading && !error && grouped.map(([dataset, list]) => (
                    <div key={dataset}>
                        <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                            {dataset}
                        </div>
                        <ul>
                            {list.map((t) => {
                                const isSel = selected === t.name;
                                return (
                                    <li key={t.name}>
                                        <button
                                            type="button"
                                            onClick={() => onSelect(t.name)}
                                            className={
                                                'flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-2 text-left hover:bg-orange-50/40 ' +
                                                (isSel ? 'bg-orange-100/60' : '')
                                            }
                                        >
                                            <span className="truncate font-mono text-sm text-zinc-800">
                                                {t.name}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </aside>
    );
}
