import { useMemo, useState } from 'react';

export default function FunctionPicker({ functions, selected, onChange, loading, error, focusConfig }) {
    const [filter, setFilter] = useState('');

    const visible = useMemo(() => {
        const f = filter.trim().toLowerCase();
        if (!f) return functions;
        return functions.filter((fn) => fn.name.toLowerCase().includes(f));
    }, [functions, filter]);

    const allVisibleSelected =
        visible.length > 0 && visible.every((fn) => selected.has(fn.name));

    function toggle(name) {
        const next = new Set(selected);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        onChange(next);
    }

    function toggleAllVisible() {
        const next = new Set(selected);
        if (allVisibleSelected) {
            visible.forEach((fn) => next.delete(fn.name));
        } else {
            visible.forEach((fn) => next.add(fn.name));
        }
        onChange(next);
    }

    function clearAll() {
        onChange(new Set());
    }

    return (
        <aside className="flex w-72 flex-col border-r border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                        Functions
                    </h2>
                    <span className="text-xs text-slate-500">
                        {selected.size}/{functions.length}
                    </span>
                </div>
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="filter by name…"
                    className="input w-full"
                />
                <div className="mt-2 flex items-center gap-2 text-xs">
                    <button
                        type="button"
                        onClick={toggleAllVisible}
                        className="text-orange-600 hover:underline disabled:text-zinc-400"
                        disabled={visible.length === 0}
                    >
                        {allVisibleSelected ? 'unselect visible' : 'select visible'}
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                        type="button"
                        onClick={clearAll}
                        className="text-orange-600 hover:underline disabled:text-zinc-400"
                        disabled={selected.size === 0}
                    >
                        clear all
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading && (
                    <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-orange-500" />
                        Loading functions…
                    </div>
                )}
                {error && (
                    <div className="p-4 text-sm text-red-600">
                        <div className="font-medium">Couldn't list functions</div>
                        <div className="mt-1 text-xs">{error}</div>
                    </div>
                )}
                {!loading && !error && visible.length === 0 && (
                    <div className="p-4 text-sm text-slate-500">No functions match.</div>
                )}
                {!loading && !error && visible.length > 0 && (
                    <ul>
                        {visible.map((fn) => {
                            const isSel = selected.has(fn.name);
                            return (
                                <li key={fn.name}>
                                    <label
                                        className={
                                            'flex cursor-pointer items-start gap-2 border-b border-zinc-100 px-3 py-2 hover:bg-orange-50/40 ' +
                                            (isSel ? 'bg-orange-100/60' : '')
                                        }
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSel}
                                            onChange={() => toggle(fn.name)}
                                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                                        />
                                        <div className="min-w-0">
                                            <div className="truncate font-mono text-sm text-slate-800">
                                                {fn.name}
                                            </div>
                                            {focusConfig && focusConfig[fn.name] && (
                                                <div
                                                    className="truncate text-[11px] text-zinc-500"
                                                    title={focusConfig[fn.name].label}
                                                >
                                                    {focusConfig[fn.name].label}
                                                </div>
                                            )}
                                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                                                <span className="rounded bg-slate-100 px-1 py-px font-mono">
                                                    {fn.generation === 'GEN_2' ? 'gen2' : fn.generation === 'GEN_1' ? 'gen1' : '?'}
                                                </span>
                                                {fn.runtime && (
                                                    <span className="rounded bg-slate-100 px-1 py-px font-mono">
                                                        {fn.runtime}
                                                    </span>
                                                )}
                                                {fn.state && fn.state !== 'ACTIVE' && (
                                                    <span className="rounded bg-amber-100 px-1 py-px font-mono text-amber-700">
                                                        {fn.state}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </aside>
    );
}