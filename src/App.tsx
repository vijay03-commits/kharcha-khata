import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  getGetExpenseSummaryQueryKey,
  getListExpensesQueryKey,
  useCreateExpense,
  useDeleteExpense,
  useUpdateExpense,
  restoreDeletedExpense,
  type ExpenseDeleteSnapshot,
  useDeleteExpensesBulk,
  useGetExpenseSummary,
  useListExpenses,
  ExpenseCategory as Categories,
  PaymentMethod as Payments,
  type Expense,
  type BalanceTransaction,
  type BalanceTransactionInput,
  type ExpenseCategory,
  type PaymentMethod,
  exportExpensesBackup,
  importExpensesBackup,
  exportBalanceBackup,
  importBalanceBackup,
  exportFullBackup,
  addExpense,
  importFullBackup,
  getBalanceTransactionsQueryKey,
  getCurrentBalanceQueryKey,
  useListBalanceTransactions,
  useGetCurrentBalance,
  useCreateBalanceTransaction,
  useDeleteBalanceTransaction,
} from './local-api';
import {
  BarChart3,
  ArrowLeftRight,
  Bike,
  Bolt,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Download,
  FileText,
  Filter,
  HeartPulse,
  IndianRupee,
  Layers3,
  Loader2,
  LockKeyhole,
  Moon,
  Sun,
  Search,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Share2,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  Utensils,
  WalletCards,
  X,
} from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
  },
});

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';
type FilterValue<T extends string> = T | 'all';
type PeriodRange = { key: PeriodKey; label: string; from: string; to: string; fromIso: string; toExclusiveIso: string };
type Summary = {
  total: number;
  count: number;
  byCategory: { category: ExpenseCategory; total: number; count: number }[];
  byPayment: { payment: PaymentMethod; total: number; count: number }[];
};

const CHART_COLORS = ['#C95A4A', '#E7A52F', '#328A87', '#25284C', '#9479A9', '#6B8E77'];

type RecurringRule = { id: string; name: string; amount: number; category: ExpenseCategory; payment: PaymentMethod; day: number; enabled: boolean; lastRunMonth?: string };
type KharchaSettings = { monthlyBudget?: number; theme?: 'light' | 'dark' | 'system'; recurringRules?: RecurringRule[] };
function readKharchaSettings(): KharchaSettings { try { const raw = localStorage.getItem('kharcha-khata-settings'); return raw ? JSON.parse(raw) as KharchaSettings : {}; } catch { return {}; } }
function saveKharchaSettings(settings: KharchaSettings) { try { localStorage.setItem('kharcha-khata-settings', JSON.stringify(settings)); } catch { throw new Error('Settings could not be saved in this browser.'); } }

function AppShell() {
  const today = useMemo(() => localDateKey(new Date()), []);
  const ranges = useMemo(() => ({
    today: makePeriod('today', today),
    week: makePeriod('week', today),
    month: makePeriod('month', today),
    year: makePeriod('year', today),
  }), [today]);
  const [location, navigate] = useLocation();
  const [periodFilter, setPeriodFilter] = useState<PeriodKey>('week');
  const [categoryFilter, setCategoryFilter] = useState<FilterValue<ExpenseCategory>>('all');
  const [paymentFilter, setPaymentFilter] = useState<FilterValue<PaymentMethod>>('all');
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<ExpenseDeleteSnapshot | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<PeriodRange | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const queryClient = useQueryClient();
  const amountRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const fullBackupInputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<KharchaSettings>(() => readKharchaSettings());
  const [darkMode, setDarkMode] = useState(() => { const theme = readKharchaSettings().theme; try { return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) || localStorage.getItem('kharcha-khata-theme') === 'dark'; } catch { return theme === 'dark'; } });
  useEffect(() => { document.documentElement.classList.toggle('dark', darkMode); try { localStorage.setItem('kharcha-khata-theme', darkMode ? 'dark' : 'light'); saveKharchaSettings({ ...readKharchaSettings(), theme: darkMode ? 'dark' : 'light' }); } catch { /* storage can be disabled */ } }, [darkMode]);
  useEffect(() => { let cancelled = false; const runRecurring = async () => { const current = readKharchaSettings(); const rules = current.recurringRules ?? []; const todayKey = localDateKey(new Date()); const month = todayKey.slice(0, 7); const day = Number(todayKey.slice(8, 10)); let changed = false; for (const rule of rules) { if (cancelled || !rule.enabled || rule.day > day || rule.lastRunMonth === month) continue; try { await addExpense({ amount: rule.amount, category: rule.category, item: `${rule.name} (recurring)`, payment: rule.payment, spentAt: new Date(`${month}-${String(rule.day).padStart(2, '0')}T12:00:00`).toISOString() }); rule.lastRunMonth = month; changed = true; } catch { /* Retry next time the app opens. */ } } if (changed) { saveKharchaSettings({ ...current, recurringRules: rules }); await invalidateLedger(); showFeedback('success', 'Due recurring expenses were added to your ledger.'); } }; void runRecurring(); return () => { cancelled = true; }; }, []);
  const activeRange = periodFilter === 'custom'
    ? makePeriod('custom', customFrom <= customTo ? customFrom : customTo, customTo)
    : ranges[periodFilter];
  const activeParams = {
    from: activeRange.from,
    to: activeRange.to,
    ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}),
    ...(paymentFilter !== 'all' ? { payment: paymentFilter } : {}),
  };

  const todaySummaryQuery = useGetExpenseSummary({ from: ranges.today.from, to: ranges.today.to });
  const weekSummaryQuery = useGetExpenseSummary({ from: ranges.week.from, to: ranges.week.to });
  const monthSummaryQuery = useGetExpenseSummary({ from: ranges.month.from, to: ranges.month.to });
  const yearSummaryQuery = useGetExpenseSummary({ from: ranges.year.from, to: ranges.year.to });
  const activeSummaryQuery = useGetExpenseSummary(activeParams);
  const listQuery = useListExpenses({ ...activeParams, limit: 500 });
  const createExpense = useCreateExpense();
  const deleteExpense = useDeleteExpense();
  const updateExpense = useUpdateExpense();
  const deleteBulk = useDeleteExpensesBulk();
  const activeSummary = activeSummaryQuery.data as Summary | undefined;
  const expenses = useMemo(
    () => [...(listQuery.data ?? [])].sort((a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime()),
    [listQuery.data],
  );
  const pageTitle = location === '/' ? 'Overview' : location === '/ledger' ? 'Ledger' : location === '/reports' ? 'Reports' : 'Add expense';

  const showFeedback = (kind: 'success' | 'error', text: string) => {
    setFeedback({ kind, text });
    window.setTimeout(() => setFeedback(null), 4200);
  };
  const invalidateLedger = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getBalanceTransactionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getCurrentBalanceQueryKey() }),
    ]);
  };
  const handleCreate = (input: { amount: number; category: ExpenseCategory; item?: string; payment: PaymentMethod; spentAt?: string }) => {
    createExpense.mutate({ data: input }, {
      onSuccess: async () => {
        await invalidateLedger();
        showFeedback('success', 'Added to your khata.');
        navigate('/ledger');
      },
      onError: () => showFeedback('error', 'Could not save that expense. Try again.'),
    });
  };
  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteExpense.mutate({ id: pendingDelete.id }, {
      onSuccess: async (snapshot) => {
        setPendingDelete(null);
        setUndoSnapshot(snapshot);
        await invalidateLedger();
        showFeedback('success', 'Expense removed. You can undo this action.');
      },
      onError: () => showFeedback('error', 'That expense could not be removed.'),
    });
  };
  const handleUpdateExpense = (input: { amount: number; category: ExpenseCategory; item?: string; payment: PaymentMethod; spentAt?: string }) => {
    if (!editingExpense) return;
    updateExpense.mutate({ id: editingExpense.id, data: input }, {
      onSuccess: async () => { setEditingExpense(null); await invalidateLedger(); showFeedback('success', 'Expense and its balance deduction were updated together.'); },
      onError: (error) => showFeedback('error', error instanceof Error ? error.message : 'Could not update this expense.'),
    });
  };
  const handleUndoDelete = async () => {
    if (!undoSnapshot) return;
    try { await restoreDeletedExpense(undoSnapshot); setUndoSnapshot(null); await invalidateLedger(); showFeedback('success', 'Expense restored and balance recalculated.'); }
    catch { showFeedback('error', 'Could not undo deletion.'); }
  };
  const handleBulkDelete = () => {
    if (!pendingBulkDelete) return;
    deleteBulk.mutate({ data: { from: pendingBulkDelete.fromIso, to: pendingBulkDelete.toExclusiveIso } }, {
      onSuccess: async (result) => {
        setPendingBulkDelete(null);
        await invalidateLedger();
        showFeedback('success', `${result.deletedCount} ${result.deletedCount === 1 ? 'entry' : 'entries'} removed.`);
      },
      onError: () => showFeedback('error', 'Those entries could not be removed.'),
    });
  };
  const handleExportBackup = async () => {
    try {
      const blob = await exportExpensesBackup();
      triggerDownload(blob, `kharcha-khata-backup-${localDateKey(new Date())}.json`);
      showFeedback('success', 'Backup exported. Keep the JSON file somewhere safe.');
    } catch {
      showFeedback('error', 'Could not export the backup.');
    }
  };
  const handleFullBackupExport = async () => {
    try { const blob = await exportFullBackup(); triggerDownload(blob, `kharcha-khata-full-backup-${localDateKey(new Date())}.json`); showFeedback('success', 'Full backup exported: expenses, balance transactions, and saved settings.'); }
    catch { showFeedback('error', 'Could not export the full backup.'); }
  };
  const handleFullBackupImport = async (file?: File) => {
    if (!file) return;
    if (!window.confirm('A full restore replaces all expenses, Credits & Balance transactions, and saved settings on this device. Export a backup of the current data first if you may need it. Continue?')) { if (fullBackupInputRef.current) fullBackupInputRef.current.value = ''; return; }
    try { const raw = JSON.parse(await file.text()); const result = await importFullBackup(raw); setSettings(readKharchaSettings()); const restoredTheme = readKharchaSettings().theme; if (restoredTheme) setDarkMode(restoredTheme === 'dark' || (restoredTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)); await invalidateLedger(); await Promise.all([queryClient.refetchQueries({ queryKey: getListExpensesQueryKey() }), queryClient.refetchQueries({ queryKey: getGetExpenseSummaryQueryKey() }), queryClient.refetchQueries({ queryKey: getBalanceTransactionsQueryKey() }), queryClient.refetchQueries({ queryKey: getCurrentBalanceQueryKey() })]); showFeedback('success', `Full restore complete: ${result.expenses} expenses and ${result.balanceTransactions} balance transactions.`); }
    catch (error) { showFeedback('error', error instanceof Error ? error.message : 'Could not restore the full backup.'); }
    finally { if (fullBackupInputRef.current) fullBackupInputRef.current.value = ''; }
  };
  const handleImportBackup = async (file?: File) => {
    if (!file) return;
    if (!window.confirm('Restoring a backup replaces all expenses currently saved on this device. Continue only if that is what you want.')) return;
    try {
      const raw = JSON.parse(await file.text());
      const count = await importExpensesBackup(raw);
      await invalidateLedger();
      await Promise.all([queryClient.refetchQueries({ queryKey: getListExpensesQueryKey() }), queryClient.refetchQueries({ queryKey: getGetExpenseSummaryQueryKey() })]);
      showFeedback('success', `Imported ${count} ${count === 1 ? 'expense' : 'expenses'}. Existing local expenses were replaced.`);
    } catch (error) {
      showFeedback('error', error instanceof Error ? error.message : 'Could not import that backup.');
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };
  const focusAmount = () => {
    navigate('/add');
    window.setTimeout(() => amountRef.current?.focus(), 80);
  };
  const shared = {
    today,
    ranges,
    activeRange,
    activeSummary,
    activeSummaryQuery,
    expenses,
    listQuery,
    periodFilter,
    setPeriodFilter,
    categoryFilter,
    setCategoryFilter,
    paymentFilter,
    setPaymentFilter,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    setPendingDelete,
    setEditingExpense,
    setPendingBulkDelete,
    focusAmount,
    duplicateExpense: (expense: Expense) => { handleCreate({ amount: expense.amount, category: expense.category, item: expense.item ?? '', payment: expense.payment, spentAt: new Date().toISOString() }); },
    downloadPdf: () => {
      const report = buildReport(activeRange, activeSummary, expenses, categoryFilter, paymentFilter);
      triggerDownload(buildPdfBlob(report.title, report.lines), report.filename);
      showFeedback('success', 'Your PDF report is downloading.');
    },
    exportBackup: handleExportBackup,
    restoreBackup: () => backupInputRef.current?.click(),
    exportFullBackup: handleFullBackupExport,
    restoreFullBackup: () => fullBackupInputRef.current?.click(),
    sharePdf: async () => {
      const report = buildReport(activeRange, activeSummary, expenses, categoryFilter, paymentFilter);
      const blob = buildPdfBlob(report.title, report.lines);
      const file = new File([blob], report.filename, { type: 'application/pdf' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ title: report.title, text: 'Kharcha Khata spending report', files: [file] });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      triggerDownload(blob, report.filename);
      showFeedback('success', 'PDF downloaded. You can attach it anywhere you want to share it.');
    },
  };

  return (
    <div className="kharcha-page paper-grain min-h-[100dvh] text-foreground">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1540px]">
        <Sidebar location={location} navigate={navigate} />
        <main className="min-w-0 flex-1 px-5 pb-24 sm:px-8 lg:px-12 lg:pb-12">
          <header className="flex items-center justify-between border-b border-border/70 py-5 md:py-7">
            <div className="md:hidden"><Brand compact /></div>
            <div className="hidden md:block"><p className="font-mono text-[10px] uppercase tracking-[.24em] text-muted-foreground">Kharcha Khata / {pageTitle}</p></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => showFeedback('success', 'Your expenses are stored on this device in IndexedDB. Export a JSON backup regularly to protect against device loss.')} className="hidden h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-card hover:text-foreground sm:grid" aria-label="Storage information"><LockKeyhole className="h-[17px] w-[17px]" /></button>
              <button type="button" onClick={() => showFeedback('success', 'Choose Reports for filters, charts, and PDF export.')} className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-card hover:text-foreground" aria-label="Help"><CircleHelp className="h-[18px] w-[18px]" /></button>
              <input ref={backupInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void handleImportBackup(event.currentTarget.files?.[0])} aria-label="Choose an expense JSON backup" />
              <input ref={fullBackupInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void handleFullBackupImport(event.currentTarget.files?.[0])} aria-label="Choose a full Kharcha Khata backup" />
              <button type="button" onClick={() => setDarkMode((value) => !value)} className="grid h-10 w-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-card hover:text-foreground" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} title={darkMode ? "Light mode" : "Dark mode"}>{darkMode ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}</button>
              <button type="button" onClick={focusAmount} className="lux-button group flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4 transition-transform group-hover:rotate-90" /><span className="hidden sm:inline">Add expense</span><span className="sm:hidden">Add</span></button>
            </div>
          </header>
          {feedback && <div className={`animate-pop mb-5 mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${feedback.kind === 'success' ? 'border-[hsl(var(--chart-3)/.3)] bg-[hsl(var(--chart-3)/.1)] text-[hsl(var(--chart-3))]' : 'border-destructive/30 bg-destructive/10 text-destructive'}`} role="status"><Check className="h-4 w-4" />{feedback.text}{undoSnapshot && feedback.kind === 'success' && <button type="button" onClick={() => void handleUndoDelete()} className="ml-auto rounded-lg border border-current/30 px-3 py-1.5 font-semibold">Undo</button>}<button type="button" className="ml-auto" aria-label="Dismiss message" onClick={() => setFeedback(null)}><X className="h-4 w-4" /></button></div>}
          <div className="page-transition pt-7">
            <Switch>
              <Route path="/"><DashboardPage {...shared} todaySummary={todaySummaryQuery.data} weekSummary={weekSummaryQuery.data} monthSummary={monthSummaryQuery.data} yearSummary={yearSummaryQuery.data} /></Route>
              <Route path="/ledger"><LedgerPage {...shared} onRetry={() => listQuery.refetch()} /></Route>
              <Route path="/reports"><ReportsPage {...shared} /></Route>
              <Route path="/balance"><BalancePage /></Route>
              <Route path="/settings"><SettingsPage settings={settings} onSave={(next) => { saveKharchaSettings(next); setSettings(next); showFeedback('success', 'Settings saved on this device.'); }} /></Route>
              <Route path="/add"><AddExpensePage onSubmit={handleCreate} isPending={createExpense.isPending} inputRef={amountRef} /></Route>
              <Route component={NotFound} />
            </Switch>
          </div>
        </main>
      </div>
      <MobileNav location={location} navigate={navigate} />
      {pendingDelete && <DeleteDialog expense={pendingDelete} isPending={deleteExpense.isPending} onCancel={() => setPendingDelete(null)} onConfirm={handleDelete} />}
      {editingExpense && <EditExpenseDialog expense={editingExpense} isPending={updateExpense.isPending} onCancel={() => setEditingExpense(null)} onSave={handleUpdateExpense} />}
      {pendingBulkDelete && <BulkDeleteDialog range={pendingBulkDelete} isPending={deleteBulk.isPending} onCancel={() => setPendingBulkDelete(null)} onConfirm={handleBulkDelete} />}
    </div>
  );
}

type SharedProps = {
  today: string;
  ranges: Record<'today' | 'week' | 'month' | 'year', PeriodRange>;
  activeRange: PeriodRange;
  activeSummary?: Summary;
  activeSummaryQuery: { isLoading: boolean; isError: boolean };
  expenses: Expense[];
  listQuery: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  periodFilter: PeriodKey;
  setPeriodFilter: (value: PeriodKey) => void;
  categoryFilter: FilterValue<ExpenseCategory>;
  setCategoryFilter: (value: FilterValue<ExpenseCategory>) => void;
  paymentFilter: FilterValue<PaymentMethod>;
  setPaymentFilter: (value: FilterValue<PaymentMethod>) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  setPendingDelete: (expense: Expense) => void;
  setEditingExpense: (expense: Expense) => void;
  setPendingBulkDelete: (range: PeriodRange) => void;
  focusAmount: () => void;
  duplicateExpense: (expense: Expense) => void;
  downloadPdf: () => void;
  sharePdf: () => Promise<void>;
  exportBackup: () => Promise<void>;
  restoreBackup: () => void;
  exportFullBackup: () => Promise<void>;
  restoreFullBackup: () => void;
};

function BalancePage() {
  const queryClient = useQueryClient();
  const transactionsQuery = useListBalanceTransactions();
  const balanceQuery = useGetCurrentBalance();
  const createTransaction = useCreateBalanceTransaction();
  const deleteTransaction = useDeleteBalanceTransaction();
  const balanceBackupInputRef = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [person, setPerson] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('Cash');
  const [createdAt, setCreatedAt] = useState(localDateKey(new Date()));
  const [error, setError] = useState('');

  const transactions = transactionsQuery.data ?? [];
  const balance = balanceQuery.data ?? 0;

  const formatMoney = (value: number) =>
    `₹${formatAmount(value)}`;

  const exportBalance = async () => {
    try {
      const blob = await exportBalanceBackup();
      triggerDownload(blob, `kharcha-khata-balance-backup-${localDateKey(new Date())}.json`);
      setError('');
    } catch {
      setError('Could not export the balance backup.');
    }
  };

  const importBalance = async (file?: File) => {
    if (!file) return;
    if (!window.confirm('Restoring a balance backup replaces only Credits & Balance transactions. Existing expenses will not be changed. Continue?')) {
      if (balanceBackupInputRef.current) balanceBackupInputRef.current.value = '';
      return;
    }
    try {
      const raw = JSON.parse(await file.text());
      const count = await importBalanceBackup(raw);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getBalanceTransactionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getCurrentBalanceQueryKey() }),
      ]);
      setError('');
      window.alert(`Restored ${count} balance transaction${count === 1 ? '' : 's'}. Expenses were not changed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore the balance backup.');
    } finally {
      if (balanceBackupInputRef.current) balanceBackupInputRef.current.value = '';
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!description.trim()) {
      setError('Enter a description.');
      return;
    }

    const input: BalanceTransactionInput = {
      type: 'credit',
      amount: value,
      description: description.trim(),
      person: person.trim() || undefined,
      payment,
      createdAt: new Date(`${createdAt}T12:00:00`).toISOString(),
    };

    createTransaction.mutate(
      { data: input },
      {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getBalanceTransactionsQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getCurrentBalanceQueryKey() }),
          ]);
          setAmount('');
          setDescription('');
          setPerson('');
          setError('');
        },
        onError: () => setError('Could not save this transaction. Try again.'),
      }
    );
  };

  const removeTransaction = (transaction: BalanceTransaction) => {
    if (!window.confirm(`Delete "${transaction.description}" (${formatMoney(transaction.amount)})?`)) return;

    deleteTransaction.mutate(
      { id: transaction.id },
      {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getBalanceTransactionsQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getCurrentBalanceQueryKey() }),
          ]);
        },
        onError: () => setError('Could not delete this transaction.'),
      }
    );
  };

  return (
    <div className="space-y-7">
      <PageIntro
        eyebrow="Money in and out"
        title="Credits & Balance"
        description="Record money received here. New expenses are deducted from your balance automatically."
        action={
          <div className="flex flex-wrap gap-2">
            <input
              ref={balanceBackupInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Choose a Credits and Balance backup"
              onChange={(event) => void importBalance(event.currentTarget.files?.[0])}
            />
            <button type="button" onClick={() => balanceBackupInputRef.current?.click()} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold">
              <Upload className="h-4 w-4" /> Restore balance
            </button>
            <button type="button" onClick={() => void exportBalance()} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold">
              <Download className="h-4 w-4" /> Backup balance
            </button>
          </div>
        }
      />

      <section className="rounded-[1.6rem] bg-primary p-6 text-primary-foreground sm:p-8">
        <p className="font-mono text-xs uppercase tracking-[.2em] text-primary-foreground/65">
          Remaining balance
        </p>
        <h2 className="mt-4 font-serif text-5xl tracking-tight">
          {formatMoney(balance)}
        </h2>
        <p className="mt-3 text-sm text-primary-foreground/65">
          Calculated from all credits minus all debits.
        </p>
      </section>

      <section className="lux-card rounded-[1.6rem] p-5 sm:p-7">
        <SectionHeading
          eyebrow="New entry"
          title="Record money received"
          icon={<WalletCards className="h-5 w-5 text-accent" />}
        />

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            Amount (₹)
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3"
              placeholder="e.g. 1000"
            />
          </label>

          <label className="block text-sm font-medium">
            Description
            <input
              required
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3"
              placeholder="e.g. Monthly allowance or groceries"
            />
          </label>

          <label className="block text-sm font-medium">
            Person or source (optional)
            <input
              maxLength={200}
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3"
              placeholder="e.g. Person A"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Payment method
              <select
                value={payment}
                onChange={(event) => setPayment(event.target.value as PaymentMethod)}
                className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3"
              >
                {Object.values(Payments).map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium">
              Date
              <input
                type="date"
                required
                value={createdAt}
                onChange={(event) => setCreatedAt(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3"
              />
            </label>
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

          <button
            type="submit"
            disabled={createTransaction.isPending}
            className="lux-button w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {createTransaction.isPending ? 'Saving...' : 'Save transaction'}
          </button>
        </form>
      </section>

      <section className="lux-card rounded-[1.6rem] p-5 sm:p-7">
        <SectionHeading
          eyebrow="Your records"
          title="Transaction history"
          icon={<Receipt className="h-5 w-5 text-accent" />}
        />

        {transactionsQuery.isLoading ? (
          <p className="py-6 text-sm text-muted-foreground">Loading transactions...</p>
        ) : transactionsQuery.isError ? (
          <p className="py-6 text-sm text-destructive">Could not load transactions. Refresh the page and try again.</p>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">No transactions yet. Add your first credit above.</p>
        ) : (
          <div className="mt-4 divide-y divide-border">
            {transactions.map((transaction) => (
              <div key={transaction.id} className="flex items-start gap-3 py-4">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${transaction.type === 'credit' ? 'bg-[hsl(var(--chart-3)/.12)] text-[hsl(var(--chart-3))]' : 'bg-destructive/10 text-destructive'}`}>
                  {transaction.type === 'credit' ? '+' : '−'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{transaction.description}</p>
                  {transaction.person && <p className="mt-1 text-xs text-muted-foreground">{transaction.person}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(transaction.createdAt)} · {transaction.payment}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`whitespace-nowrap font-semibold ${transaction.type === 'credit' ? 'text-[hsl(var(--chart-3))]' : 'text-destructive'}`}>
                    {transaction.type === 'credit' ? '+' : '−'}{formatMoney(transaction.amount)}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeTransaction(transaction)}
                    className="mt-2 text-xs text-muted-foreground underline hover:text-destructive"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DashboardPage({ today, ranges, activeSummary, expenses, focusAmount, setPeriodFilter, todaySummary, weekSummary, monthSummary, yearSummary }: SharedProps & { todaySummary?: { total: number; count: number }; weekSummary?: { total: number; count: number }; monthSummary?: { total: number; count: number }; yearSummary?: { total: number; count: number } }) {
  const summary = todaySummary;
  return <div className="space-y-7">
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]">
      <div className="relative overflow-hidden rounded-[1.8rem] bg-primary px-6 py-8 text-primary-foreground shadow-[0_20px_55px_hsl(var(--primary)/.18)] sm:px-10 sm:py-10">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border-[30px] border-secondary/15" />
        <div className="absolute -bottom-28 right-40 h-56 w-56 rounded-full border-[15px] border-accent/10" />
        <div className="relative"><p className="font-mono text-[11px] uppercase tracking-[.22em] text-primary-foreground/55">Today, {prettyDate(today)}</p><h1 className="mt-6 font-serif text-6xl leading-none tracking-[-.05em] sm:text-8xl">₹{formatAmount(summary?.total ?? 0)}</h1><p className="mt-4 text-sm text-primary-foreground/60">{summary?.count ?? 0} {summary?.count === 1 ? 'entry' : 'entries'} so far</p><div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-primary-foreground/15 pt-4 text-xs text-primary-foreground/60"><span className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-secondary" /> Spending with intention</span><span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {formatLongDate(today)}</span></div></div>
      </div>
      <div className="lux-card flex flex-col justify-between rounded-[1.8rem] p-6 sm:p-8"><div><div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.22em] text-muted-foreground">Quick note</p><h2 className="mt-3 font-serif text-3xl leading-tight">Make money<br />feel visible.</h2></div><Pencil className="h-5 w-5 text-accent" /></div><p className="mt-6 max-w-xs text-sm leading-relaxed text-muted-foreground">A tiny note today makes tomorrow’s decisions feel lighter.</p></div><button type="button" onClick={focusAmount} className="lux-button mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3.5 text-sm font-bold text-secondary-foreground"><Plus className="h-4 w-4" /> Make an entry</button></div>
    </section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <PeriodCard title="Today" summary={todaySummary} active onClick={() => setPeriodFilter('today')} />
      <PeriodCard title="This week" summary={weekSummary} active={false} onClick={() => setPeriodFilter('week')} />
      <PeriodCard title="This month" summary={monthSummary} active={false} onClick={() => setPeriodFilter('month')} />
      <PeriodCard title="This year" summary={yearSummary} active={false} onClick={() => setPeriodFilter('year')} />
    </section>
    <section className="lux-card rounded-[1.6rem] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Monthly plan</p><h2 className="mt-2 font-serif text-3xl">Spending budget</h2><p className="mt-2 text-sm text-muted-foreground">Set a monthly limit in Settings and track how much remains.</p></div><a href="/settings" className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">Set budget</a></div>{(() => { const budget = readKharchaSettings().monthlyBudget ?? 0; const spent = monthSummary?.total ?? 0; const progress = budget > 0 ? Math.min(100, spent / budget * 100) : 0; return <><div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-xs text-muted-foreground">Spent this month</p><p className="mt-1 font-serif text-2xl">₹{formatAmount(spent)}</p></div><div className="text-right"><p className="text-xs text-muted-foreground">{budget > 0 ? 'Budget' : 'No budget set'}</p><p className="mt-1 font-serif text-xl">{budget > 0 ? `₹${formatAmount(budget)}` : '—'}</p></div></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-destructive' : progress >= 80 ? 'bg-[hsl(38_92%_50%)]' : 'bg-[hsl(150_45%_38%)]'}`} style={{ width: `${progress}%` }} /></div><p className={`mt-2 text-sm ${budget > 0 && spent > budget ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{budget <= 0 ? 'Choose a monthly limit to enable budget warnings.' : spent > budget ? `Over budget by ₹${formatAmount(spent - budget)}.` : `₹${formatAmount(budget - spent)} remaining · ${Math.round(progress)}% used`}</p></>; })()}</section>
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(310px,.55fr)]">
      <div className="lux-card rounded-[1.6rem] p-5 sm:p-7"><SectionHeading eyebrow="At a glance" title="Recent spending" icon={<Receipt className="h-5 w-5 text-accent" />} action="View ledger" href="/ledger" /><ExpenseList expenses={expenses.slice(0, 5)} isLoading={false} isError={false} onRetry={() => undefined} onDelete={() => undefined} compact /></div>
      <div className="lux-card rounded-[1.6rem] p-5 sm:p-7"><SectionHeading eyebrow="A little perspective" title="Open your reports" icon={<BarChart3 className="h-5 w-5 text-accent" />} /><p className="mt-5 text-sm leading-relaxed text-muted-foreground">See your habits from four angles with interactive charts, filters, and a shareable PDF.</p><a href="/reports" className="lux-button mt-7 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground">Explore reports <TrendingUp className="h-4 w-4" /></a><div className="mt-6 grid grid-cols-2 gap-2">{[['Entries', activeSummary?.count ?? 0], ['Tracked', `₹${formatAmount(activeSummary?.total ?? 0)}`]].map(([label, value]) => <div key={label} className="rounded-xl bg-muted/65 p-3"><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">{label}</p><p className="mt-2 font-serif text-xl">{value}</p></div>)}</div></div>
    </section>
  </div>;
}

function LedgerPage(props: SharedProps & { onRetry: () => void }) {
  const { activeSummary, expenses, listQuery, setPendingDelete, setEditingExpense, setPendingBulkDelete, ranges } = props;
  const [search, setSearch] = useState('');
  const filteredExpenses = expenses.filter((expense) => `${expense.item ?? ''} ${expense.category} ${expense.payment} ${expense.amount}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="space-y-6"><PageIntro eyebrow="Your record" title="Ledger" description="Every note, kept in one calm place." action={<button type="button" onClick={props.focusAmount} className="lux-button flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-bold text-secondary-foreground"><Plus className="h-4 w-4" /> Add expense</button>} /><FilterPanel {...props} /><div className="lux-card rounded-[1.6rem] p-5 sm:p-7"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">Filtered ledger</p><h2 className="mt-2 font-serif text-3xl">Recent spending</h2></div><span className="rounded-full bg-muted px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{filteredExpenses.length} shown · ₹{formatAmount(activeSummary?.total ?? 0)} total</span></div><label className="relative my-4 block"><span className="sr-only">Search expenses</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes, category, payment, amount…" className="input-notebook h-11 w-full rounded-xl pl-10 pr-3 text-sm" /></label><ExpenseList expenses={filteredExpenses} isLoading={listQuery.isLoading} isError={listQuery.isError} onRetry={props.onRetry} onDelete={setPendingDelete} onEdit={setEditingExpense} onDuplicate={props.duplicateExpense} /></div><BulkDeletePanel period={props.periodFilter} ranges={ranges} onDelete={setPendingBulkDelete} /></div>;
}

function ReportsPage(props: SharedProps) {
  const { activeRange, activeSummary, expenses, activeSummaryQuery } = props;
  return <div className="space-y-6"><PageIntro eyebrow="Your patterns" title="Reports" description="A clearer picture of where your money goes." action={<div className="flex flex-wrap gap-2"><button type="button" onClick={props.restoreBackup} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold"><Upload className="h-4 w-4" /> Restore</button><button type="button" onClick={props.exportBackup} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold"><Download className="h-4 w-4" /> Backup</button><button type="button" onClick={props.restoreFullBackup} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold"><RotateCcw className="h-4 w-4" /> Full restore</button><button type="button" onClick={props.exportFullBackup} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold"><Download className="h-4 w-4" /> Full backup</button><button type="button" onClick={() => exportExpensesCsv(expenses)} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold"><FileText className="h-4 w-4" /> CSV</button><button type="button" onClick={props.sharePdf} className="lux-button flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-xs font-bold"><Share2 className="h-4 w-4" /> Share</button><button type="button" onClick={props.downloadPdf} className="lux-button flex items-center gap-2 rounded-xl bg-secondary px-3 py-3 text-xs font-bold text-secondary-foreground"><Download className="h-4 w-4" /> PDF</button></div>} /><FilterPanel {...props} /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Total tracked" value={`₹${formatAmount(activeSummary?.total ?? 0)}`} icon={<IndianRupee className="h-4 w-4" />} /><Kpi label="Entries" value={String(activeSummary?.count ?? 0)} icon={<Receipt className="h-4 w-4" />} /><Kpi label="Top category" value={activeSummary?.byCategory?.[0] ? categoryLabel(activeSummary.byCategory[0].category) : '—'} icon={<Layers3 className="h-4 w-4" />} /><Kpi label="Top payment" value={activeSummary?.byPayment?.[0]?.payment ?? '—'} icon={<WalletCards className="h-4 w-4" />} /></div><ReportCharts summary={activeSummary} expenses={expenses} isLoading={activeSummaryQuery.isLoading} rangeLabel={activeRange.label} /></div>;
}

function SettingsPage({ settings, onSave }: { settings: KharchaSettings; onSave: (settings: KharchaSettings) => void }) {
  const [budget, setBudget] = useState(settings.monthlyBudget ? String(settings.monthlyBudget) : '');
  const [name, setName] = useState(''); const [amount, setAmount] = useState(''); const [category, setCategory] = useState<ExpenseCategory>(Categories.Bills); const [payment, setPayment] = useState<PaymentMethod>(Payments.UPI); const [day, setDay] = useState('1'); const [error, setError] = useState(''); const rules = settings.recurringRules ?? [];
  return <div className="mx-auto max-w-4xl space-y-6"><PageIntro eyebrow="Preferences" title="Settings" description="Set your monthly budget and manage recurring expenses stored on this device."/><section className="lux-card rounded-2xl p-5 sm:p-7"><SectionHeading eyebrow="Monthly limit" title="Spending budget" icon={<IndianRupee className="h-5 w-5 text-accent"/>}/><form onSubmit={(e) => { e.preventDefault(); const value = Number(budget); if (budget && (!Number.isFinite(value) || value <= 0)) { setError('Budget must be greater than zero.'); return; } onSave({ ...settings, monthlyBudget: value || 0 }); setError(''); }} className="mt-5 flex flex-col gap-3 sm:flex-row"><label className="flex-1 text-sm font-medium">Monthly budget (₹)<input type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 15000" className="input-notebook mt-1.5 h-12 w-full rounded-xl px-3"/></label><button className="self-end rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">Save budget</button></form></section><section className="lux-card rounded-2xl p-5 sm:p-7"><SectionHeading eyebrow="Automation" title="Recurring expenses" icon={<CalendarRange className="h-5 w-5 text-accent"/>}/><p className="mt-3 text-sm text-muted-foreground">Due recurring expenses are added automatically when you open the app on or after the due day. Each rule runs once per month.</p><form onSubmit={(e) => { e.preventDefault(); const value = Number(amount); if (!name.trim() || !Number.isFinite(value) || value <= 0) { setError('Enter a name and a positive amount.'); return; } const rule: RecurringRule = { id: crypto.randomUUID(), name: name.trim(), amount: value, category, payment, day: Math.min(28, Math.max(1, Number(day) || 1)), enabled: true }; onSave({ ...settings, recurringRules: [...rules, rule] }); setName(''); setAmount(''); setError(''); }} className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, subscription…" className="input-notebook mt-1.5 h-11 w-full rounded-xl px-3"/></label><label className="text-sm font-medium">Amount (₹)<input required type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-notebook mt-1.5 h-11 w-full rounded-xl px-3"/></label><label className="text-sm font-medium">Category<select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="input-notebook mt-1.5 h-11 w-full rounded-xl px-3">{categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label><label className="text-sm font-medium">Payment method<select value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)} className="input-notebook mt-1.5 h-11 w-full rounded-xl px-3">{Object.values(Payments).map((p) => <option key={p} value={p}>{p}</option>)}</select></label><label className="text-sm font-medium">Due day (1–28)<input type="number" min="1" max="28" value={day} onChange={(e) => setDay(e.target.value)} className="input-notebook mt-1.5 h-11 w-full rounded-xl px-3"/></label><button className="self-end rounded-xl bg-secondary px-5 py-3 font-semibold text-secondary-foreground"><Plus className="mr-1 inline h-4 w-4"/> Add recurring expense</button></form>{error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}<div className="mt-5 space-y-2">{rules.length === 0 ? <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">No recurring expenses configured.</p> : rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"><div className="min-w-0 flex-1"><p className="font-semibold">{rule.name}</p><p className="mt-1 text-xs text-muted-foreground">₹{formatAmount(rule.amount)} · {rule.category} · Day {rule.day} · {rule.payment}{rule.lastRunMonth ? ` · Last added ${rule.lastRunMonth}` : ''}</p></div><button type="button" onClick={() => onSave({ ...settings, recurringRules: rules.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r) })} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">{rule.enabled ? 'Disable' : 'Enable'}</button><button type="button" onClick={() => onSave({ ...settings, recurringRules: rules.filter((r) => r.id !== rule.id) })} className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive">Delete</button></div>)}</div></section><section className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground"><p className="font-semibold text-foreground">Privacy and backups</p><p className="mt-1">Records stay in this browser's IndexedDB. Full backup and restore are available in Reports. Export backups regularly because clearing browser site data can erase local records.</p></section></div>;
}

function AddExpensePage({ onSubmit, isPending, inputRef }: { onSubmit: (input: { amount: number; category: ExpenseCategory; item?: string; payment: PaymentMethod; spentAt?: string }) => void; isPending: boolean; inputRef: RefObject<HTMLInputElement | null> }) {
  return <div className="mx-auto max-w-3xl space-y-6"><PageIntro eyebrow="New page" title="Add expense" description="Keep the detail tiny. Just enough for tomorrow-you to remember." /><Composer onSubmit={onSubmit} isPending={isPending} inputRef={inputRef} /></div>;
}

function Sidebar({ location, navigate }: { location: string; navigate: (path: string) => void }) {
  return <aside className="hidden w-[258px] shrink-0 flex-col bg-sidebar px-6 py-7 text-sidebar-foreground md:flex"><Brand /><div className="mt-14"><p className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[.22em] text-sidebar-foreground/50">Your space</p><nav className="space-y-1" aria-label="Main navigation">{[['/', 'Overview', IndianRupee], ['/ledger', 'Ledger', Receipt], ['/reports', 'Reports', BarChart3], ['/balance', 'Balance', ArrowLeftRight], ['/settings', 'Settings', LockKeyhole], ['/add', 'Add expense', Plus]].map(([path, label, Icon]) => <button type="button" key={path as string} onClick={() => navigate(path as string)} className={`nav-lift flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${location === path ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}><Icon className={`h-4 w-4 ${path === '/add' ? 'text-secondary' : ''}`} />{label as string}</button>)}</nav></div><div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/60 p-4"><Sparkles className="mb-3 h-4 w-4 text-secondary" /><p className="font-serif text-lg leading-tight">Small notes.<br />Clearer days.</p><p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/55">A little attention goes a long way.</p></div><div className="mt-5 flex items-center gap-3 border-t border-sidebar-border pt-5"><div className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">K</div><div><p className="text-sm font-semibold">My Khata</p><p className="text-[11px] text-sidebar-foreground/50">Personal ledger</p></div></div></aside>;
}

function MobileNav({ location, navigate }: { location: string; navigate: (path: string) => void }) {
  return <nav className="fixed inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 grid grid-cols-6 rounded-2xl border border-border bg-card/95 p-1.5 shadow-2xl backdrop-blur md:hidden">{[['/', 'Home', IndianRupee], ['/ledger', 'Ledger', Receipt], ['/reports', 'Reports', BarChart3], ['/balance', 'Balance', ArrowLeftRight], ['/add', 'Add', Plus]].map(([path, label, Icon]) => <button type="button" key={path as string} onClick={() => navigate(path as string)} className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold ${location === path ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}><Icon className="h-4 w-4" />{label as string}</button>)}</nav>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`flex items-center gap-3 ${compact ? '' : 'px-3'}`}><div className="relative grid h-9 w-9 place-items-center rounded-xl bg-secondary text-secondary-foreground shadow-[3px_3px_0_hsl(var(--accent)/.65)]"><Layers3 className="h-[18px] w-[18px]" /></div><div><p className={`font-serif leading-none ${compact ? 'text-[19px] text-foreground' : 'text-[22px]'}`}>Kharcha Khata</p><p className={`mt-1 font-mono text-[9px] uppercase tracking-[.18em] ${compact ? 'text-muted-foreground' : 'text-sidebar-foreground/45'}`}>daily spending, noted</p></div></div>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.24em] text-accent">{eyebrow}</p><h1 className="mt-3 font-serif text-5xl tracking-[-.04em] sm:text-6xl">{title}</h1><p className="mt-3 text-sm text-muted-foreground">{description}</p></div>{action}</div>;
}

function SectionHeading({ eyebrow, title, icon, action, href }: { eyebrow: string; title: string; icon?: ReactNode; action?: string; href?: string }) {
  return <div className="flex items-end justify-between border-b border-border pb-5"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">{eyebrow}</p><h2 className="mt-2 font-serif text-3xl">{title}</h2></div><div className="flex items-center gap-4">{action && href ? <a href={href} className="text-xs font-bold text-accent hover:underline">{action}</a> : null}{icon}</div></div>;
}

function PeriodCard({ title, summary, active, onClick }: { title: string; summary?: { total: number; count: number }; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`lux-card rounded-2xl border p-4 text-left transition-all hover:-translate-y-1 ${active ? 'border-primary bg-primary text-primary-foreground shadow-[0_10px_25px_hsl(var(--primary)/.16)]' : 'border-border bg-card'}`}><p className={`font-mono text-[10px] uppercase tracking-[.16em] ${active ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{title}</p><p className="mt-2 font-serif text-2xl">₹{formatAmount(summary?.total ?? 0)}</p><p className={`mt-1 text-xs ${active ? 'text-primary-foreground/55' : 'text-muted-foreground'}`}>{summary?.count ?? 0} {summary?.count === 1 ? 'entry' : 'entries'}</p></button>;
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="lux-card rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">{label}</p><span className="text-accent">{icon}</span></div><p className="mt-3 truncate font-serif text-2xl">{value}</p></div>;
}

function FilterPanel({ periodFilter, setPeriodFilter, categoryFilter, setCategoryFilter, paymentFilter, setPaymentFilter, customFrom, setCustomFrom, customTo, setCustomTo }: SharedProps) {
  return <div className="lux-card rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex items-center gap-2"><Filter className="h-4 w-4 text-accent" /><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Filter your record</p><p className="mt-1 text-sm font-semibold">Every chart and number updates with these choices.</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-3"><FilterSelect label="Period" value={periodFilter} onChange={(value) => setPeriodFilter(value as PeriodKey)} options={[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom range']]} /><FilterSelect label="Category" value={categoryFilter} onChange={(value) => setCategoryFilter(value as FilterValue<ExpenseCategory>)} options={[['all', 'All categories'], ...categoryOptions.map((option) => [option.value, option.label] as [string, string])]} /><FilterSelect label="Paid with" value={paymentFilter} onChange={(value) => setPaymentFilter(value as FilterValue<PaymentMethod>)} options={[['all', 'All methods'], ['UPI', 'UPI'], ['Cash', 'Cash'], ['Card', 'Card'], ['Other', 'Other']]} /></div>{periodFilter === 'custom' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><DateField label="From" value={customFrom} onChange={setCustomFrom} /><DateField label="To" value={customTo} onChange={setCustomTo} /></div>}</div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <label className="relative block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="input-notebook h-11 w-full appearance-none rounded-xl px-3 pr-9 text-sm">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-[2.1rem] h-4 w-4 text-muted-foreground" /></label>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="input-notebook h-11 w-full rounded-xl px-3 text-sm" /></label>;
}

function ExpenseList({ expenses, isLoading, isError, onRetry, onDelete, onEdit, onDuplicate, compact = false }: { expenses: Expense[]; isLoading: boolean; isError: boolean; onRetry: () => void; onDelete: (expense: Expense) => void; onEdit?: (expense: Expense) => void; onDuplicate?: (expense: Expense) => void; compact?: boolean }) {
  if (isLoading) return <div className="space-y-4 pt-5" aria-label="Loading expenses">{[1, 2, 3].map((item) => <div key={item} className="flex animate-pulse items-center gap-3 py-3"><div className="h-11 w-11 rounded-xl bg-muted" /><div className="flex-1"><div className="h-3 w-32 rounded bg-muted" /><div className="mt-2 h-2 w-20 rounded bg-muted" /></div></div>)}</div>;
  if (isError) return <div className="py-12 text-center"><p className="font-serif text-xl">The page got a little smudged.</p><p className="mt-2 text-sm text-muted-foreground">We couldn’t read these entries.</p><button type="button" onClick={onRetry} className="lux-button mt-4 rounded-full border border-border px-4 py-2 text-xs font-bold">Try again</button></div>;
  if (expenses.length === 0) return <div className="py-14 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary/25 text-primary"><Receipt className="h-6 w-6" /></div><h3 className="mt-4 font-serif text-2xl">A fresh page.</h3><p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">Nothing matches these filters yet.</p></div>;
  return <div className="pt-1">{expenses.map((expense, index) => <div key={expense.id} className="ledger-rule group flex items-center gap-3 py-4 last:bg-none animate-rise" style={{ animationDelay: `${index * 35}ms` }}><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${categoryTone(expense.category)}`}><CategoryIcon category={expense.category} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{expense.item || categoryLabel(expense.category)}</p><p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{formatDateTime(expense.spentAt)}<span className="h-1 w-1 rounded-full bg-muted-foreground/50" />{expense.payment}</p></div><p className="font-mono text-sm font-medium">₹{formatAmount(expense.amount)}</p>{!compact && <div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`Edit ${expense.item || 'expense'}`} onClick={() => onEdit?.(expense)} title="Edit" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button><button type="button" aria-label={`Duplicate ${expense.item || 'expense'}`} onClick={() => onDuplicate?.(expense)} title="Duplicate" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Layers3 className="h-4 w-4" /></button><button type="button" aria-label={`Delete ${expense.item || 'expense'}`} onClick={() => onDelete(expense)} title="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>}</div>)}</div>;
}

function ReportCharts({ summary, expenses, isLoading, rangeLabel }: { summary?: Summary; expenses: Expense[]; isLoading: boolean; rangeLabel: string }) {
  if (isLoading) return <div className="grid gap-5 lg:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-[390px] animate-pulse rounded-[1.6rem] bg-muted/60" />)}</div>;
  const categories = (summary?.byCategory ?? []).map((entry) => ({ name: categoryLabel(entry.category), size: entry.total, value: entry.total, count: entry.count, category: entry.category }));
  const payments = (summary?.byPayment ?? []).map((entry) => ({ name: entry.payment, value: entry.total, count: entry.count }));
  const bubbles = expenses.map((expense, index) => ({ x: index + 1, y: expense.amount, z: Math.max(80, Math.min(560, expense.amount * 1.8)), name: expense.item || categoryLabel(expense.category), category: categoryLabel(expense.category), payment: expense.payment, amount: expense.amount }));
  return <div className="grid gap-5 lg:grid-cols-2">
    <ChartCard eyebrow="Category weight" title="Treemap" description={`The bigger the tile, the more you spent · ${rangeLabel}`}>{categories.length ? <><ResponsiveContainer width="100%" height={280} debounce={0}><Treemap data={categories} dataKey="size" nameKey="name" stroke="hsl(var(--card))" content={<TreemapContent />} isAnimationActive={false} /></ResponsiveContainer><ChartLegend data={categories} /></> : <ChartEmpty />}</ChartCard>
    <ChartCard eyebrow="Category share" title="Pie chart" description="A simple view of your spending mix">{categories.length ? <><ResponsiveContainer width="100%" height={280} debounce={0}><PieChart><Pie data={categories} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={98} cornerRadius={3} paddingAngle={2} stroke="none" isAnimationActive={false}>{categories.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip content={<ChartTooltip />} isAnimationActive={false} /></PieChart></ResponsiveContainer><ChartLegend data={categories} /></> : <ChartEmpty />}</ChartCard>
    <ChartCard eyebrow="Payment mix" title="Doughnut chart" description="Where your money left your hands">{payments.length ? <><div className="relative"><ResponsiveContainer width="100%" height={280} debounce={0}><PieChart><Pie data={payments} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={65} outerRadius={100} cornerRadius={3} paddingAngle={3} stroke="none" isAnimationActive={false}>{payments.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[(index + 2) % CHART_COLORS.length]} />)}</Pie><Tooltip content={<ChartTooltip />} isAnimationActive={false} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Total</p><p className="mt-1 font-serif text-xl">₹{formatAmount(summary?.total ?? 0)}</p></div></div></div><ChartLegend data={payments} /></> : <ChartEmpty />}</ChartCard>
    <ChartCard eyebrow="Entry intensity" title="Bubble chart" description="Each bubble is one expense; bigger means heavier impact">{bubbles.length ? <><ResponsiveContainer width="100%" height={315} debounce={0}><ScatterChart margin={{ top: 18, right: 18, bottom: 12, left: 0 }}><XAxis dataKey="x" type="number" hide /><YAxis dataKey="y" type="number" tickFormatter={(value) => `₹${value}`} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} /><ZAxis dataKey="z" range={[70, 580]} /><Tooltip content={<ChartTooltip />} cursor={{ stroke: 'hsl(var(--border))', strokeDasharray: '3 3' }} isAnimationActive={false} /><Scatter data={bubbles} fill={CHART_COLORS[3]} isAnimationActive={false} /></ScatterChart></ResponsiveContainer><div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span className="rounded-full bg-muted px-2.5 py-1">{bubbles.length} bubbles</span><span className="rounded-full bg-muted px-2.5 py-1">vertical axis = amount</span></div></> : <ChartEmpty />}</ChartCard>
  </div>;
}

function ChartCard({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="lux-card rounded-[1.6rem] border border-border bg-card p-5 sm:p-7"><div className="mb-4"><p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">{eyebrow}</p><h2 className="mt-2 font-serif text-3xl">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{children}</div>;
}

function ChartLegend({ data }: { data: { name: string; value?: number; size?: number }[] }) {
  return <div className="flex max-h-16 flex-wrap gap-x-4 gap-y-2 overflow-hidden">{data.slice(0, 6).map((entry, index) => <div key={entry.name} className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />{entry.name}<span className="font-mono text-foreground">₹{formatAmount(entry.value ?? entry.size ?? 0)}</span></div>)}</div>;
}

function ChartEmpty() {
  return <div className="grid h-[280px] place-items-center rounded-xl bg-muted/45 px-6 text-center"><div><TrendingUp className="mx-auto h-6 w-6 text-accent/65" /><p className="mt-3 font-serif text-xl">No spending here yet</p><p className="mt-1 text-xs text-muted-foreground">Try a wider period or another filter.</p></div></div>;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload?: Record<string, unknown>; name?: string; value?: number }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const label = String(row.name ?? payload[0]?.name ?? 'Expense');
  const amount = Number(row.value ?? row.amount ?? payload[0]?.value ?? 0);
  return <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-xl"><p className="font-semibold">{label}</p><p className="mt-1 font-mono text-muted-foreground">₹{formatAmount(amount)}</p>{row.category ? <p className="mt-1 text-muted-foreground">{String(row.category)} · {String(row.payment ?? '')}</p> : null}</div>;
}

function TreemapContent({ x, y, width, height, name, index }: { x?: number; y?: number; width?: number; height?: number; name?: string; index?: number }) {
  if (!width || !height || width < 30 || height < 24) return null;
  return <g><rect x={x} y={y} width={width} height={height} rx={12} ry={12} fill={CHART_COLORS[(index ?? 0) % CHART_COLORS.length]} fillOpacity={.9} stroke="hsl(var(--card))" strokeWidth={4} /><text x={(x ?? 0) + 14} y={(y ?? 0) + 24} fill="#fff" fontSize={width > 100 ? 14 : 11} fontWeight={700}>{name}</text></g>;
}

function BulkDeletePanel({ period, ranges, onDelete }: { period: PeriodKey; ranges: Record<'today' | 'week' | 'month' | 'year', PeriodRange>; onDelete: (range: PeriodRange) => void }) {
  const [scope, setScope] = useState<'today' | 'week' | 'month' | 'year'>(period === 'custom' ? 'today' : period);
  const range = ranges[scope];
  return <div className="rounded-2xl border border-destructive/20 bg-destructive/[.035] p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-destructive/70">Careful cleanup</p><p className="mt-1 text-sm font-semibold">Delete a complete period</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">This cannot be undone. You’ll confirm the range twice.</p></div><div className="flex flex-col gap-2 sm:flex-row"><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="input-notebook h-10 rounded-xl px-3 text-xs"><option value="today">Whole day</option><option value="week">Whole week</option><option value="month">Whole month</option><option value="year">Whole year</option></select><button type="button" onClick={() => onDelete(range)} className="h-10 rounded-xl border border-destructive/25 px-3 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10">Delete period</button></div></div></div>;
}

function Composer({ onSubmit, isPending, inputRef }: { onSubmit: (input: { amount: number; category: ExpenseCategory; item?: string; payment: PaymentMethod; spentAt?: string }) => void; isPending: boolean; inputRef: RefObject<HTMLInputElement | null> }) {
  const [amount, setAmount] = useState('');
  const [item, setItem] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>(Categories.Food);
  const [payment, setPayment] = useState<PaymentMethod>(() => { try { const saved = localStorage.getItem('kharcha-khata-last-payment'); return saved && Object.values(Payments).includes(saved as PaymentMethod) ? saved as PaymentMethod : Payments.UPI; } catch { return Payments.UPI; } });
  const [spentAt, setSpentAt] = useState(() => { const now = new Date(); const offset = now.getTimezoneOffset(); return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 16); });
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) { setError('Add an amount greater than zero.'); return; }
    setError('');
    onSubmit({ amount: numericAmount, category, payment, ...(item.trim() ? { item: item.trim() } : {}), ...(spentAt ? { spentAt: new Date(spentAt).toISOString() } : {}) });
    setAmount('');
    setItem('');
  };
  return <form onSubmit={submit} className="lux-card rounded-[1.8rem] border border-border bg-card p-5 sm:p-8"><div className="grid gap-5 md:grid-cols-[1fr_1.2fr]"><div><label htmlFor="expense-amount" className="mb-2 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Amount <span className="text-destructive">*</span></label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 font-serif text-xl text-muted-foreground">₹</span><input ref={inputRef} id="expense-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" className="input-notebook h-16 w-full rounded-xl pl-10 pr-4 font-mono text-2xl text-foreground placeholder:text-muted-foreground/35" /></div>{error && <p className="mt-2 text-xs font-semibold text-destructive">{error}</p>}</div><div><label htmlFor="expense-item" className="mb-2 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">What was it for? <span className="font-normal normal-case tracking-normal text-muted-foreground/60">optional</span></label><input id="expense-item" value={item} onChange={(event) => setItem(event.target.value)} placeholder="A quick note, like chai with Riya" className="input-notebook h-16 w-full rounded-xl px-4 text-sm text-foreground placeholder:text-muted-foreground/55" /></div></div><div className="mt-6"><p className="mb-3 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Category <span className="text-destructive">*</span></p><div className="grid grid-cols-4 gap-2 sm:grid-cols-7">{categoryOptions.map((option) => <button type="button" key={option.value} onClick={() => setCategory(option.value)} className={`lux-button flex flex-col items-center gap-2 rounded-xl border px-2 py-3 text-[11px] font-semibold transition-colors ${category === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}><option.Icon className="h-4 w-4" />{option.label}</button>)}</div></div><div className="mt-6 grid gap-5 sm:grid-cols-[1fr_1fr_1.25fr]"><div><label htmlFor="expense-payment" className="mb-2 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Paid with <span className="text-destructive">*</span></label><div className="relative"><select id="expense-payment" value={payment} onChange={(event) => { const next = event.target.value as PaymentMethod; setPayment(next); try { localStorage.setItem('kharcha-khata-last-payment', next); } catch { /* storage can be disabled */ } }} className="input-notebook h-12 w-full appearance-none rounded-xl px-3 pr-9 text-sm"><option value={Payments.Cash}>Cash</option><option value={Payments.UPI}>UPI</option><option value={Payments.Card}>Debit card</option><option value={Payments.Other}>Other</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 text-muted-foreground" /></div></div><div><label htmlFor="expense-date" className="mb-2 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">When</label><input id="expense-date" type="datetime-local" value={spentAt} onChange={(event) => setSpentAt(event.target.value)} className="input-notebook h-12 w-full rounded-xl px-3 text-sm" /></div><button type="submit" disabled={isPending} className="lux-button mt-auto flex h-12 items-center justify-center gap-2 rounded-xl bg-secondary px-5 text-sm font-bold text-secondary-foreground disabled:cursor-wait disabled:opacity-60">{isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {isPending ? 'Saving…' : 'Save expense'}</button></div></form>;
}

function EditExpenseDialog({ expense, isPending, onCancel, onSave }: { expense: Expense; isPending: boolean; onCancel: () => void; onSave: (input: { amount: number; category: ExpenseCategory; item?: string; payment: PaymentMethod; spentAt?: string }) => void }) {
  const [amount, setAmount] = useState(String(expense.amount));
  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [item, setItem] = useState(expense.item ?? '');
  const [payment, setPayment] = useState<PaymentMethod>(expense.payment);
  const [spentAt, setSpentAt] = useState(() => { const d = new Date(expense.spentAt); const offset = d.getTimezoneOffset(); return new Date(d.getTime() - offset * 60000).toISOString().slice(0,16); });
  return <div className="fixed inset-0 z-40 grid place-items-center bg-primary/35 p-4 backdrop-blur-sm"><form role="dialog" aria-modal="true" aria-labelledby="edit-expense-title" onSubmit={(event) => { event.preventDefault(); const value = Number(amount); if (!Number.isFinite(value) || value <= 0) return; onSave({ amount: value, category, item, payment, spentAt: new Date(spentAt).toISOString() }); }} className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-7"><div className="flex items-center justify-between"><h2 id="edit-expense-title" className="font-serif text-2xl">Edit expense</h2><button type="button" onClick={onCancel} aria-label="Close edit dialog"><X className="h-5 w-5" /></button></div><label className="block text-sm font-medium">Amount (₹)<input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="input-notebook mt-1.5 h-12 w-full rounded-xl px-3" /></label><label className="block text-sm font-medium">Description<input maxLength={500} value={item} onChange={(e) => setItem(e.target.value)} className="input-notebook mt-1.5 h-12 w-full rounded-xl px-3" /></label><label className="block text-sm font-medium">Category<select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="input-notebook mt-1.5 h-12 w-full rounded-xl px-3">{categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label><label className="block text-sm font-medium">Payment method<select value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)} className="input-notebook mt-1.5 h-12 w-full rounded-xl px-3">{Object.values(Payments).map((p) => <option key={p} value={p}>{p}</option>)}</select></label><label className="block text-sm font-medium">Date and time<input type="datetime-local" required value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className="input-notebook mt-1.5 h-12 w-full rounded-xl px-3" /></label><div className="flex gap-2 pt-2"><button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-border px-4 py-3 font-semibold">Cancel</button><button disabled={isPending} className="flex-1 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{isPending ? 'Saving…' : 'Save changes'}</button></div></form></div>;
}

function DeleteDialog({ expense, isPending, onCancel, onConfirm }: { expense: Expense; isPending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  return <div className="fixed inset-0 z-30 grid place-items-center bg-primary/35 p-5 backdrop-blur-[2px]"><div role="dialog" aria-modal="true" className="animate-pop w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-start justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="h-5 w-5" /></div><button type="button" aria-label="Close delete confirmation" onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button></div><h2 className="mt-5 font-serif text-2xl">{step === 1 ? 'Remove this note?' : 'One last confirmation'}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step === 1 ? `“${expense.item || categoryLabel(expense.category)}” · ₹${formatAmount(expense.amount)} will be removed.` : 'This entry will be permanently deleted from your record.'}</p><div className="mt-6 flex gap-2"><button type="button" onClick={onCancel} className="lux-button flex-1 rounded-xl border border-border px-4 py-3 text-sm font-bold hover:bg-muted">Keep it</button>{step === 1 ? <button type="button" onClick={() => setStep(2)} className="lux-button flex-1 rounded-xl bg-destructive px-4 py-3 text-sm font-bold text-destructive-foreground">Continue</button> : <button type="button" disabled={isPending} onClick={onConfirm} className="lux-button flex-1 rounded-xl bg-destructive px-4 py-3 text-sm font-bold text-destructive-foreground disabled:opacity-60">{isPending ? 'Removing…' : 'Yes, remove it'}</button>}</div></div></div>;
}

function BulkDeleteDialog({ range, isPending, onCancel, onConfirm }: { range: PeriodRange; isPending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  return <div className="fixed inset-0 z-30 grid place-items-center bg-primary/35 p-5 backdrop-blur-[2px]"><div role="dialog" aria-modal="true" className="animate-pop w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-start justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><CalendarRange className="h-5 w-5" /></div><button type="button" aria-label="Close bulk delete confirmation" onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button></div><h2 className="mt-5 font-serif text-2xl">{step === 1 ? `Delete ${range.label.toLowerCase()}?` : 'Delete everything in this range?'}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step === 1 ? 'Every expense in this period will be selected for deletion.' : 'This is permanent. Your ledger entries in this period will not be recoverable.'}</p><div className="mt-6 flex gap-2"><button type="button" onClick={onCancel} className="lux-button flex-1 rounded-xl border border-border px-4 py-3 text-sm font-bold hover:bg-muted">Keep entries</button>{step === 1 ? <button type="button" onClick={() => setStep(2)} className="lux-button flex-1 rounded-xl bg-destructive px-4 py-3 text-sm font-bold text-destructive-foreground">Continue</button> : <button type="button" disabled={isPending} onClick={onConfirm} className="lux-button flex-1 rounded-xl bg-destructive px-4 py-3 text-sm font-bold text-destructive-foreground disabled:opacity-60">{isPending ? 'Deleting…' : 'Yes, delete all'}</button>}</div></div></div>;
}

const categoryOptions = [
  { value: Categories.Food, label: 'Food', Icon: Utensils },
  { value: Categories.Transport, label: 'Travel', Icon: Bike },
  { value: Categories.Shopping, label: 'Shopping', Icon: ShoppingBag },
  { value: Categories.Bills, label: 'Bills', Icon: Bolt },
  { value: Categories.Health, label: 'Health', Icon: HeartPulse },
  { value: Categories.Entertainment, label: 'Fun', Icon: Sparkles },
  { value: Categories.Other, label: 'Other', Icon: MoreHorizontal },
] as const;

function CategoryIcon({ category }: { category: ExpenseCategory }) {
  const option = categoryOptions.find((item) => item.value === category);
  const Icon = option?.Icon ?? MoreHorizontal;
  return <Icon className="h-5 w-5" />;
}
function categoryLabel(category: ExpenseCategory) { return categoryOptions.find((option) => option.value === category)?.label ?? category; }
function categoryTone(category: ExpenseCategory) { const tones: Record<string, string> = { Food: 'bg-[hsl(38_92%_62%/.25)] text-[hsl(30_68%_35%)]', Transport: 'bg-[hsl(177_35%_44%/.16)] text-[hsl(177_35%_34%)]', Shopping: 'bg-[hsl(280_27%_59%/.17)] text-[hsl(280_27%_45%)]', Bills: 'bg-[hsl(8_74%_61%/.15)] text-[hsl(8_65%_47%)]', Health: 'bg-[hsl(146_34%_55%/.17)] text-[hsl(146_34%_35%)]', Entertainment: 'bg-[hsl(235_35%_20%/.11)] text-primary', Other: 'bg-muted text-muted-foreground' }; return tones[category] ?? tones.Other; }
function formatAmount(value: number) { return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function localDateKey(value: Date) { const offset = value.getTimezoneOffset(); return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10); }
function addDays(value: string, amount: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + amount); return localDateKey(date); }
function makePeriod(key: PeriodKey, anchor: string, customEnd?: string): PeriodRange {
  let from = anchor;
  let to = customEnd ?? anchor;
  if (key === 'week') { const day = new Date(`${anchor}T12:00:00`).getDay(); from = addDays(anchor, day === 0 ? -6 : 1 - day); to = addDays(from, 6); }
  if (key === 'month') { from = `${anchor.slice(0, 7)}-01`; const date = new Date(`${from}T12:00:00`); date.setMonth(date.getMonth() + 1); to = addDays(localDateKey(date), -1); }
  if (key === 'year') { from = `${anchor.slice(0, 4)}-01-01`; to = `${anchor.slice(0, 4)}-12-31`; }
  const labels: Record<PeriodKey, string> = { today: 'Today', week: 'This week', month: 'This month', year: 'This year', custom: `${prettyDate(from)} – ${prettyDate(to)}` };
  return { key, label: labels[key], from, to, fromIso: new Date(`${from}T00:00:00`).toISOString(), toExclusiveIso: new Date(`${addDays(to, 1)}T00:00:00`).toISOString() };
}
function prettyDate(value: string) { return new Intl.DateTimeFormat('en-IN', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
function formatLongDate(value: string) { return new Intl.DateTimeFormat('en-IN', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

function buildReport(range: PeriodRange, summary: Summary | undefined, expenses: Expense[], category: FilterValue<ExpenseCategory>, payment: FilterValue<PaymentMethod>) {
  const lines = [`Period: ${range.label} (${range.from} to ${range.to})`, `Total spent: Rs ${formatAmount(summary?.total ?? 0)} | Entries: ${summary?.count ?? expenses.length}`, `Filters: ${category === 'all' ? 'All categories' : categoryLabel(category)} / ${payment === 'all' ? 'All payment methods' : payment}`, '', 'WHERE THE MONEY WENT', ...(summary?.byCategory.length ? summary.byCategory.map((entry) => `${categoryLabel(entry.category)}: Rs ${formatAmount(entry.total)} (${entry.count})`) : ['No category data']), '', 'HOW IT WAS PAID', ...(summary?.byPayment.length ? summary.byPayment.map((entry) => `${entry.payment}: Rs ${formatAmount(entry.total)} (${entry.count})`) : ['No payment data']), '', 'ENTRIES', ...(expenses.length ? expenses.map((expense) => `${formatDateTime(expense.spentAt)} | ${categoryLabel(expense.category)} | ${expense.item || 'No note'} | ${expense.payment} | Rs ${formatAmount(expense.amount)}`) : ['No entries'])];
  return { title: `Kharcha Khata — ${range.label}`, filename: `kharcha-khata-${range.from}-to-${range.to}.pdf`, lines };
}
function buildPdfBlob(title: string, lines: string[]) {
  const pageLines = 42;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLines) pages.push(lines.slice(index, index + pageLines));
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageNumbers: number[] = [];
  pages.forEach((page, index) => { const pageObject = 4 + index * 2; const contentObject = pageObject + 1; pageNumbers.push(pageObject); objects[pageObject - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`; const text = ['BT', '/F1 15 Tf', '54 748 Td', `(${pdfEscape(title)}) Tj`, '/F1 9 Tf', '0 -25 Td', ...page.map((line) => `(${pdfEscape(line)}) Tj 0 -15 Td`), 'ET'].join('\n'); objects[contentObject - 1] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`; });
  objects[1] = `<< /Type /Pages /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}
function pdfEscape(value: string) { return value.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?'); }
function exportExpensesCsv(expenses: Expense[]) {
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Category', 'Note', 'Payment method', 'Amount'], ...expenses.map((expense) => [new Date(expense.spentAt).toLocaleString('en-IN'), categoryLabel(expense.category), expense.item ?? '', expense.payment, expense.amount])];
  const csv = '\uFEFF' + rows.map((row) => row.map(quote).join(',')).join('\r\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `kharcha-khata-expenses-${localDateKey(new Date())}.csv`);
}
function triggerDownload(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }

function Router() { return <RoutedErrorBoundary><AppShell /></RoutedErrorBoundary>; }
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;