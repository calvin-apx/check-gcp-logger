import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchSchedulerJobs, runSchedulerJob } from '../lib/api.js';
import { StatusBadge, TruncatedCell } from './cells.jsx';

const AUTO_REFRESH_MS = 30000;
const COOLDOWN_MS = 30000;
const SUCCESS_FLASH_MS = 5000;

const STATE_COLORS = {
    ENABLED: 'green',
    PAUSED: 'gray',
    DISABLED: 'gray'
};

function MiniSpinner() {
    return <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-orange-500" />;
}

function relativeTime(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!t) return '—';
    const diffSec = Math.round((Date.now() - t) / 1000);
    if (diffSec < 0) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
    return `${Math.round(diffSec / 86400)}d ago`;
}

export default function SchedulerView({ refreshKey, onFetchingChange }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // jobName -> { running: bool, success: number|null, error: string|null, cooldownUntil: number|null }
    const [runState, setRunState] = useState({});

    const [confirmJob, setConfirmJob] = useState(null);

    // 1Hz tick to keep "relative time" labels and cooldown countdowns fresh
    // without re-fetching from the server.
    const [, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchSchedulerJobs();
            setJobs(result.jobs || []);
        } catch (err) {
            const hint = err.body && err.body.hint ? `\n${err.body.hint}` : '';
            setError(err.message + hint);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial load + react to header refresh.
    useEffect(() => {
        load();
    }, [load, refreshKey]);

    // Auto-refresh every 30s, but pause while the confirm modal is open.
    useEffect(() => {
        if (confirmJob) return;
        const id = setInterval(() => load(), AUTO_REFRESH_MS);
        return () => clearInterval(id);
    }, [load, confirmJob]);

    useEffect(() => {
        onFetchingChange?.(loading);
    }, [loading, onFetchingChange]);

    const sortedJobs = useMemo(
        () => [...jobs].sort((a, b) => a.name.localeCompare(b.name)),
        [jobs]
    );

    async function doRun(jobName) {
        setRunState((s) => ({
            ...s,
            [jobName]: { running: true, success: null, error: null, cooldownUntil: null }
        }));
        try {
            await runSchedulerJob(jobName);
            const successAt = Date.now();
            setRunState((s) => ({
                ...s,
                [jobName]: {
                    running: false,
                    success: successAt,
                    error: null,
                    cooldownUntil: successAt + COOLDOWN_MS
                }
            }));
            // Clear the green "Triggered ✓" flash after 5s but keep cooldown.
            setTimeout(() => {
                setRunState((s) => {
                    const cur = s[jobName];
                    if (!cur || cur.success !== successAt) return s;
                    return { ...s, [jobName]: { ...cur, success: null } };
                });
            }, SUCCESS_FLASH_MS);
            // Refresh job list so last_attempt_time updates.
            load();
        } catch (err) {
            const hint = err.body && err.body.hint ? ` (${err.body.hint})` : '';
            setRunState((s) => ({
                ...s,
                [jobName]: {
                    running: false,
                    success: null,
                    error: err.message + hint,
                    cooldownUntil: null
                }
            }));
        }
    }

    function onSetToken() {
        const current = localStorage.getItem('triggerToken') || '';
        const next = window.prompt('Trigger token (leave blank to clear):', current);
        if (next === null) return;
        if (next.trim() === '') {
            localStorage.removeItem('triggerToken');
        } else {
            localStorage.setItem('triggerToken', next.trim());
        }
    }

    if (loading && jobs.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-zinc-500">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-orange-500" />
                    <div className="text-sm">Loading scheduler jobs…</div>
                </div>
            </div>
        );
    }

    if (error && jobs.length === 0) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="text-lg font-semibold text-red-600">Couldn't list scheduler jobs</div>
                <div className="max-w-2xl whitespace-pre-line text-sm text-zinc-600">{error}</div>
            </div>
        );
    }

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            {loading && (
                <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-orange-100">
                    <div className="loading-bar h-full w-1/3 bg-orange-500" />
                </div>
            )}

            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2 text-sm">
                <div className="flex items-center gap-3">
                    <span className="text-zinc-800">Cloud Scheduler</span>
                    <span className="text-xs text-zinc-500">{sortedJobs.length} jobs</span>
                    <span className="text-xs text-zinc-400">auto-refresh 30s</span>
                </div>
                <button type="button" onClick={onSetToken} className="btn text-xs" title="Set X-Trigger-Token used for force-run">
                    set trigger token
                </button>
            </div>

            <div className="flex-1 overflow-auto bg-white">
                <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2 w-24">State</th>
                            <th className="px-3 py-2 w-44">Schedule</th>
                            <th className="px-3 py-2">Description</th>
                            <th className="px-3 py-2 w-64">Target</th>
                            <th className="px-3 py-2 w-32">Last run</th>
                            <th className="px-3 py-2 w-56 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedJobs.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                                    No scheduler jobs in this region.
                                </td>
                            </tr>
                        )}
                        {sortedJobs.map((j) => (
                            <JobRow
                                key={j.name}
                                job={j}
                                runState={runState[j.name]}
                                onRunRequest={() => setConfirmJob(j)}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {confirmJob && (
                <ConfirmRunModal
                    job={confirmJob}
                    onCancel={() => setConfirmJob(null)}
                    onConfirm={() => {
                        const name = confirmJob.name;
                        setConfirmJob(null);
                        doRun(name);
                    }}
                />
            )}
        </div>
    );
}

function JobRow({ job, runState, onRunRequest }) {
    const now = Date.now();
    const running = runState?.running;
    const succeededAt = runState?.success;
    const errorMsg = runState?.error;
    const cooldownLeft = runState?.cooldownUntil ? Math.max(0, runState.cooldownUntil - now) : 0;
    const disabled = running || cooldownLeft > 0;

    let buttonLabel;
    if (running) buttonLabel = 'Running…';
    else if (succeededAt) buttonLabel = 'Triggered ✓';
    else if (cooldownLeft > 0) buttonLabel = `Wait ${Math.ceil(cooldownLeft / 1000)}s`;
    else buttonLabel = 'Force run';

    const buttonClass =
        'btn text-xs ' +
        (succeededAt ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 ' : '') +
        (cooldownLeft > 0 && !succeededAt ? 'opacity-60 ' : '');

    return (
        <tr className="border-b border-zinc-100 align-top">
            <td className="px-3 py-2 font-mono text-xs text-zinc-800">{job.name}</td>
            <td className="px-3 py-2">
                <StatusBadge value={job.state} colorMap={STATE_COLORS} />
            </td>
            <td className="px-3 py-2">
                <div className="font-mono text-xs text-zinc-800">{job.schedule || '—'}</div>
                {job.time_zone && (
                    <div className="text-[10px] text-zinc-400">{job.time_zone}</div>
                )}
            </td>
            <td className="max-w-xs px-3 py-2 text-xs text-zinc-700">
                <div className="line-clamp-2 break-words">{job.description || '—'}</div>
            </td>
            <td className="px-3 py-2 text-xs text-zinc-700">
                <div className="text-[10px] uppercase tracking-wide text-zinc-400">
                    {job.target_type}
                </div>
                {job.target_url ? (
                    <TruncatedCell value={job.target_url} length={36} />
                ) : (
                    <span className="text-zinc-400">—</span>
                )}
            </td>
            <td className="px-3 py-2 text-xs text-zinc-700" title={job.last_attempt_time || ''}>
                {relativeTime(job.last_attempt_time)}
            </td>
            <td className="px-3 py-2 text-right">
                <div className="flex flex-col items-end gap-1">
                    <button
                        type="button"
                        onClick={onRunRequest}
                        disabled={disabled}
                        className={buttonClass}
                    >
                        {running && <MiniSpinner />}
                        {buttonLabel}
                    </button>
                    {errorMsg && (
                        <div className="max-w-[16rem] break-words text-right text-[11px] text-red-600">
                            {errorMsg}
                        </div>
                    )}
                </div>
            </td>
        </tr>
    );
}

function ConfirmRunModal({ job, onCancel, onConfirm }) {
    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') onConfirm();
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel, onConfirm]);

    return (
        <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-zinc-900/50 p-6"
            onClick={onCancel}
        >
            <div
                className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-3 text-base font-semibold text-zinc-800">Force run job?</div>
                <div className="mb-4 text-sm text-zinc-600">
                    Force run <span className="font-mono text-zinc-800">{job.name}</span>?
                    This bypasses the schedule and may kick off real deliveries.
                </div>
                <div className="mb-4 rounded bg-zinc-50 p-2 text-xs text-zinc-500">
                    <div>
                        <span className="text-zinc-400">target:</span>{' '}
                        <span className="font-mono text-zinc-700">{job.target_type}</span>
                    </div>
                    {job.target_url && (
                        <div className="mt-0.5 break-all">
                            <span className="text-zinc-400">url:</span>{' '}
                            <span className="font-mono text-zinc-700">{job.target_url}</span>
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={onCancel} className="btn">Cancel</button>
                    <button type="button" onClick={onConfirm} className="btn btn-primary">Run now</button>
                </div>
            </div>
        </div>
    );
}
