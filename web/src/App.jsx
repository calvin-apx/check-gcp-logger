import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    fetchClients,
    fetchFocusConfig,
    fetchFunctions,
    fetchHealth,
    fetchLogs,
    fetchTableList
} from './lib/api.js';
import { applyFocus, compileFocusConfig } from './lib/focusMatcher.js';
import Header from './components/Header.jsx';
import FunctionPicker from './components/FunctionPicker.jsx';
import FilterBar from './components/FilterBar.jsx';
import LogTable from './components/LogTable.jsx';
import TablePicker from './components/TablePicker.jsx';
import TableView from './components/TableView.jsx';
import SchedulerView from './components/SchedulerView.jsx';
import PhoneMirrorView from './components/PhoneMirrorView.jsx';
import FirestoreView from './components/FirestoreView.jsx';
import DatasetView from './components/DatasetView.jsx';

const DEFAULT_FILTERS = {
    minutesAgo: 60,
    severityMin: '',
    freeText: '',
    limit: 200
};

export default function App() {
    // Server health: project/region + initial sanity check.
    const [health, setHealth] = useState(null);

    // Which top-level view: 'logs' or 'tables'.
    const [view, setView] = useState('logs');

    // Function picker state.
    const [functions, setFunctions] = useState([]);
    const [functionsLoading, setFunctionsLoading] = useState(true);
    const [functionsError, setFunctionsError] = useState(null);
    const [selected, setSelected] = useState(new Set());

    // Query state.
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [entries, setEntries] = useState([]);
    const [fetching, setFetching] = useState(false);
    const [lastError, setLastError] = useState(null);
    const [lastFilter, setLastFilter] = useState(null);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const autoRefreshRef = useRef(null);

    // BigQuery tables state.
    const [tables, setTables] = useState([]);
    const [tablesLoading, setTablesLoading] = useState(false);
    const [tablesError, setTablesError] = useState(null);
    const [selectedTable, setSelectedTable] = useState(null);
    const [tablesRefreshKey, setTablesRefreshKey] = useState(0);
    const [tableViewFetching, setTableViewFetching] = useState(false);

    // Which tenant the table views read from. Previously hard-coded server-side,
    // so only one client could ever be inspected.
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useState(null);

    // Scheduler state.
    const [schedulerRefreshKey, setSchedulerRefreshKey] = useState(0);
    const [schedulerFetching, setSchedulerFetching] = useState(false);

    // Firestore + raw dataset browsers. Both are self-contained: they fetch
    // their own data and only take a refresh key, like SchedulerView.
    const [firestoreRefreshKey, setFirestoreRefreshKey] = useState(0);
    const [firestoreFetching, setFirestoreFetching] = useState(false);
    const [datasetsRefreshKey, setDatasetsRefreshKey] = useState(0);
    const [datasetsFetching, setDatasetsFetching] = useState(false);

    // Phone mirror — refresh button re-prompts for capture source.
    const [phoneRefreshKey, setPhoneRefreshKey] = useState(0);

    // Focused-mode config + toggle (default ON).
    const [focusConfig, setFocusConfig] = useState(null);
    const [focusedMode, setFocusedMode] = useState(true);

    // Health check + functions list on mount.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const h = await fetchHealth();
                if (!cancelled) setHealth(h);
            } catch (err) {
                if (!cancelled) setHealth({ ok: false, error: err.message });
            }
            try {
                const { functions: list } = await fetchFunctions();
                if (!cancelled) setFunctions(list);
            } catch (err) {
                if (!cancelled) {
                    const hint = err.body && err.body.hint ? ` (${err.body.hint})` : '';
                    setFunctionsError(err.message + hint);
                }
            } finally {
                if (!cancelled) setFunctionsLoading(false);
            }
            try {
                const { functions: cfg } = await fetchFocusConfig();
                if (!cancelled) setFocusConfig(cfg);
            } catch (_err) {
                // Focus config is non-critical — Focused mode just becomes a no-op
                // if it fails to load. Don't surface to the user.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Lazy-load the table list the first time the Tables tab is opened.
    useEffect(() => {
        if (view !== 'tables') return;
        let cancelled = false;
        setTablesLoading(true);
        setTablesError(null);
        (async () => {
            try {
                // Resolve the tenant list once, then the tables for the active one.
                let active = clientId;
                if (!clients.length) {
                    const { clients: list, default_client_id: fallback } = await fetchClients();
                    if (cancelled) return;
                    setClients(list);
                    active = active || (list.includes(fallback) ? fallback : list[0]);
                    setClientId(active);
                }

                const { tables: list } = await fetchTableList(active);
                if (!cancelled) {
                    setTables(list);
                    setSelectedTable((prev) =>
                        list.some((t) => t.name === prev) ? prev : (list[0] ? list[0].name : null)
                    );
                }
            } catch (err) {
                if (!cancelled) {
                    const hint = err.body && err.body.hint ? ` (${err.body.hint})` : '';
                    setTablesError(err.message + hint);
                }
            } finally {
                if (!cancelled) setTablesLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [view, clientId, clients.length]);

    const runQuery = useCallback(async () => {
        if (selected.size === 0) {
            setEntries([]);
            setLastError('Pick at least one function from the left rail.');
            return;
        }
        setFetching(true);
        setLastError(null);
        try {
            const params = {
                functionNames: Array.from(selected),
                minutesAgo: filters.minutesAgo,
                severityMin: filters.severityMin || null,
                freeText: filters.freeText,
                limit: filters.limit
            };
            const result = await fetchLogs(params);
            setEntries(result.entries || []);
            setLastFilter(result.filter || null);
        } catch (err) {
            const hint = err.body && err.body.hint ? `\n${err.body.hint}` : '';
            setLastError(err.message + hint);
        } finally {
            setFetching(false);
        }
    }, [selected, filters]);

    // Auto-refresh every 30 s while toggled on. Pauses while a fetch is in flight.
    useEffect(() => {
        if (view !== 'logs') return;
        if (autoRefresh && selected.size > 0) {
            autoRefreshRef.current = setInterval(() => {
                if (!fetching) runQuery();
            }, 30000);
            return () => clearInterval(autoRefreshRef.current);
        }
    }, [view, autoRefresh, selected, fetching, runQuery]);

    function copyGcloud() {
        if (!lastFilter || !health?.project) return;
        const command =
            `gcloud logging read '${lastFilter.replace(/'/g, "'\\''")}' ` +
            `--project=${health.project} ` +
            `--limit=${filters.limit} ` +
            `--format=json`;
        navigator.clipboard.writeText(command);
    }

    function onHeaderRefresh() {
        if (view === 'logs') {
            runQuery();
        } else if (view === 'tables') {
            setTablesRefreshKey((k) => k + 1);
        } else if (view === 'scheduler') {
            setSchedulerRefreshKey((k) => k + 1);
        } else if (view === 'phone') {
            setPhoneRefreshKey((k) => k + 1);
        } else if (view === 'datasets') {
            setDatasetsRefreshKey((k) => k + 1);
        } else if (view === 'firestore') {
            setFirestoreRefreshKey((k) => k + 1);
        }
    }

    // Pre-compile matchers when focusConfig changes (memoized so we don't
    // recompile regexes on every render).
    const focusMatchers = useMemo(() => compileFocusConfig(focusConfig), [focusConfig]);

    const focusResult = useMemo(() => {
        if (!focusedMode || !focusConfig) {
            return { visible: entries, hiddenCount: 0, hiddenFails: 0 };
        }
        return applyFocus(entries, focusMatchers);
    }, [focusedMode, focusConfig, focusMatchers, entries]);

    const headerFetching =
        view === 'logs' ? fetching :
        view === 'tables' ? tableViewFetching :
        view === 'scheduler' ? schedulerFetching :
        view === 'datasets' ? datasetsFetching :
        view === 'firestore' ? firestoreFetching :
        false;

    return (
        <div className="flex h-full flex-col">
            <Header
                project={health?.project}
                region={health?.region}
                view={view}
                onChangeView={setView}
                autoRefresh={autoRefresh}
                onToggleAutoRefresh={setAutoRefresh}
                onRefresh={onHeaderRefresh}
                isFetching={headerFetching}
            />

            {view === 'logs' && (
                <div className="flex min-h-0 flex-1">
                    <FunctionPicker
                        functions={functions}
                        selected={selected}
                        onChange={setSelected}
                        loading={functionsLoading}
                        error={functionsError}
                        focusConfig={focusConfig}
                    />

                    <main className="flex min-w-0 flex-1 flex-col">
                        <FilterBar
                            filters={filters}
                            onChange={setFilters}
                            onSubmit={runQuery}
                            onCopyGcloud={copyGcloud}
                            disabled={fetching || selected.size === 0}
                            lastFilter={lastFilter}
                            focusedMode={focusedMode}
                            onToggleFocused={setFocusedMode}
                        />

                        <LogTable
                            entries={focusResult.visible}
                            totalCount={entries.length}
                            focusedMode={focusedMode}
                            hiddenFails={focusResult.hiddenFails}
                            onDisableFocus={() => setFocusedMode(false)}
                            isFetching={fetching}
                            lastError={lastError}
                            emptyHint={
                                selected.size === 0
                                    ? 'Pick one or more functions on the left, then hit "query".'
                                    : focusedMode && entries.length > 0
                                        ? 'Focused mode hid every line. Toggle it off or widen the time range.'
                                        : 'No entries matched. Try widening the time range or relaxing the severity filter.'
                            }
                        />

                        <footer className="border-t border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-500">
                            {focusResult.visible.length} / {entries.length} entries · {selected.size} function{selected.size === 1 ? '' : 's'} selected
                            {lastFilter && (
                                <span className="ml-2 text-slate-400">
                                    · filter: <span className="font-mono">{lastFilter.replace(/\n/g, ' AND ').slice(0, 140)}{lastFilter.length > 140 ? '…' : ''}</span>
                                </span>
                            )}
                        </footer>
                    </main>
                </div>
            )}

            {view === 'tables' && (
                <div className="flex min-h-0 flex-1">
                    <TablePicker
                        clients={clients}
                        clientId={clientId}
                        onClientChange={setClientId}
                        tables={tables}
                        selected={selectedTable}
                        onSelect={setSelectedTable}
                        loading={tablesLoading}
                        error={tablesError}
                    />
                    <main className="flex min-w-0 flex-1 flex-col">
                        <TableView
                        clientId={clientId}
                            tableConfig={tables.find((t) => t.name === selectedTable) || null}
                            refreshKey={tablesRefreshKey}
                            onFetchingChange={setTableViewFetching}
                        />
                    </main>
                </div>
            )}

            {view === 'datasets' && (
                <DatasetView
                    refreshKey={datasetsRefreshKey}
                    onFetchingChange={setDatasetsFetching}
                />
            )}

            {view === 'firestore' && (
                <FirestoreView
                    refreshKey={firestoreRefreshKey}
                    onFetchingChange={setFirestoreFetching}
                />
            )}

            {view === 'scheduler' && (
                <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <SchedulerView
                        refreshKey={schedulerRefreshKey}
                        onFetchingChange={setSchedulerFetching}
                    />
                </main>
            )}

            {view === 'phone' && (
                <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <PhoneMirrorView refreshKey={phoneRefreshKey} />
                </main>
            )}
        </div>
    );
}
