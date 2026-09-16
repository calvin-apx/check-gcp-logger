const TIME_PRESETS = [
    { label: '15m', minutes: 15 },
    { label: '1h', minutes: 60 },
    { label: '6h', minutes: 360 },
    { label: '24h', minutes: 1440 }
];

const SEVERITY_OPTIONS = [
    { label: 'All', value: '' },
    { label: 'INFO+', value: 'INFO' },
    { label: 'WARNING+', value: 'WARNING' },
    { label: 'ERROR+', value: 'ERROR' }
];

const LIMIT_OPTIONS = [50, 100, 200, 500];

export default function FilterBar({ filters, onChange, onSubmit, onCopyGcloud, disabled, lastFilter, focusedMode, onToggleFocused }) {
    function patch(part) {
        onChange({ ...filters, ...part });
    }

    return (
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col">
                <label className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Time range
                </label>
                <div className="flex overflow-hidden rounded-md border border-slate-300">
                    {TIME_PRESETS.map((p) => (
                        <button
                            key={p.label}
                            type="button"
                            onClick={() => patch({ minutesAgo: p.minutes })}
                            className={
                                'px-3 py-1.5 text-sm ' +
                                (filters.minutesAgo === p.minutes
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-white text-zinc-700 hover:bg-zinc-100')
                            }
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col">
                <label className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Severity
                </label>
                <select
                    value={filters.severityMin}
                    onChange={(e) => patch({ severityMin: e.target.value })}
                    className="input"
                >
                    {SEVERITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex flex-col">
                <label className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Limit
                </label>
                <select
                    value={filters.limit}
                    onChange={(e) => patch({ limit: Number(e.target.value) })}
                    className="input"
                >
                    {LIMIT_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                            {n}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex min-w-[16rem] flex-1 flex-col">
                <label className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Free text
                </label>
                <input
                    type="text"
                    value={filters.freeText}
                    onChange={(e) => patch({ freeText: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !disabled) onSubmit();
                    }}
                    placeholder='e.g. "duplicate_channels_filtered" or "streaming buffer"'
                    className="input w-full"
                />
            </div>

            <div className="flex items-center gap-3">
                <label
                    className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700"
                    title="Shows only key testing events per function. Toggle off to see every log line."
                >
                    <input
                        type="checkbox"
                        checked={focusedMode}
                        onChange={(e) => onToggleFocused(e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-orange-500 focus:ring-orange-500"
                    />
                    Focused mode
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-600" aria-hidden>?</span>
                </label>
                <button type="button" onClick={onSubmit} disabled={disabled} className="btn btn-primary">
                    query
                </button>
                <button
                    type="button"
                    onClick={onCopyGcloud}
                    disabled={!lastFilter}
                    className="btn"
                    title="Copy equivalent `gcloud logging read` command"
                >
                    copy as gcloud
                </button>
            </div>
        </div>
    );
}