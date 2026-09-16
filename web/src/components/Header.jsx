export default function Header({
    project,
    region,
    view,
    onChangeView,
    autoRefresh,
    onToggleAutoRefresh,
    onRefresh,
    isFetching
}) {
    const tabs = [
        { id: 'logs', label: 'Logs' },
        { id: 'tables', label: 'Tables' },
        // Raw dataset browser — reaches the analytics_<property_id> GA4 exports
        // that the curated Tables allowlist cannot describe.
        { id: 'datasets', label: 'Datasets' },
        { id: 'firestore', label: 'Firestore' },
        { id: 'scheduler', label: 'Scheduler' },
        { id: 'phone', label: 'Phone' }
    ];

    return (
        <header className="flex items-center justify-between border-b border-orange-500 bg-zinc-900 px-6 py-3 shadow-sm">
            <div className="flex items-center gap-6">
                <div className="text-lg font-semibold text-orange-400">check-gcp-logger</div>
                <nav className="flex items-center gap-1">
                    {tabs.map((t) => {
                        const active = view === t.id;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => onChangeView(t.id)}
                                className={
                                    'rounded px-3 py-1 text-sm font-medium transition ' +
                                    (active
                                        ? 'bg-orange-500 text-white'
                                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-orange-300')
                                }
                            >
                                {t.label}
                            </button>
                        );
                    })}
                </nav>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono">
                        project: <span className="font-semibold text-orange-300">{project || '—'}</span>
                    </span>
                    <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono">
                        region: <span className="font-semibold text-orange-300">{region || '—'}</span>
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                {view === 'logs' && (
                    <label className="flex items-center gap-1.5 text-sm text-zinc-300">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => onToggleAutoRefresh(e.target.checked)}
                            className="h-4 w-4 rounded border-zinc-500 bg-zinc-800 text-orange-500 focus:ring-orange-500"
                        />
                        auto-refresh 30s
                    </label>
                )}
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isFetching}
                    className="btn btn-primary"
                >
                    {isFetching ? 'fetching…' : 'refresh'}
                </button>
            </div>
        </header>
    );
}
