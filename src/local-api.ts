import { useMutation, useQuery } from '@tanstack/react-query';

export const ExpenseCategory = {
  Food: 'Food', Transport: 'Transport', Shopping: 'Shopping', Bills: 'Bills',
  Health: 'Health', Entertainment: 'Entertainment', Other: 'Other',
} as const;
export type ExpenseCategory = typeof ExpenseCategory[keyof typeof ExpenseCategory];
export const PaymentMethod = { Cash: 'Cash', UPI: 'UPI', Card: 'Card', Other: 'Other' } as const;
export type PaymentMethod = typeof PaymentMethod[keyof typeof PaymentMethod];

export interface Expense {
  id: number;
  amount: number;
  category: ExpenseCategory;
  item?: string | null;
  payment: PaymentMethod;
  spentAt: string;
}
export interface ExpenseInput {
  amount: number;
  category: ExpenseCategory;
  item?: string;
  payment: PaymentMethod;
  spentAt?: string;
}
export type ListExpensesParams = { from?: string; to?: string; category?: ExpenseCategory; payment?: PaymentMethod; limit?: number };
export type GetExpenseSummaryParams = { date?: string; from?: string; to?: string; category?: ExpenseCategory; payment?: PaymentMethod };
export interface Summary {
  date: string;
  total: number;
  count: number;
  byCategory: { category: ExpenseCategory; total: number; count: number }[];
  byPayment: { payment: PaymentMethod; total: number; count: number }[];
}

const DB_NAME = 'kharcha-khata-local';
const DB_VERSION = 1;
const STORE_NAME = 'expenses';

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser does not support local offline storage.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local expense storage.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    work(tx.objectStore(STORE_NAME), resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local database operation failed.')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local database operation was cancelled.')); };
  });
}

export async function getAllExpenses(): Promise<Expense[]> {
  return withStore<Expense[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as Expense[]).sort((a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime() || b.id - a.id));
    request.onerror = () => reject(request.error);
  });
}

export async function addExpense(input: ExpenseInput): Promise<Expense> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Enter an amount greater than zero.');
  return withStore<Expense>('readwrite', (store, resolve, reject) => {
    const record = { amount: Number(input.amount), category: input.category, item: input.item?.trim() || null, payment: input.payment, spentAt: input.spentAt ? new Date(input.spentAt).toISOString() : new Date().toISOString() };
    const request = store.add(record);
    request.onsuccess = () => resolve({ ...record, id: Number(request.result) });
    request.onerror = () => reject(request.error);
  });
}

export async function removeExpense(id: number): Promise<void> {
  return withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function removeExpensesBulk(from: string, to: string): Promise<{ deletedCount: number }> {
  const all = await getAllExpenses();
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const ids = all.filter((expense) => new Date(expense.spentAt).getTime() >= start && new Date(expense.spentAt).getTime() < end).map((expense) => expense.id);
  await withStore<void>('readwrite', (store, resolve, reject) => {
    let remaining = ids.length;
    if (!remaining) { resolve(undefined as never); return; }
    for (const id of ids) {
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { remaining -= 1; if (!remaining) resolve(undefined as never); };
    }
  });
  return { deletedCount: ids.length };
}

function dateKey(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
function filterExpenses(expenses: Expense[], params: ListExpensesParams | GetExpenseSummaryParams = {}): Expense[] {
  return expenses.filter((expense) => {
    const day = dateKey(expense.spentAt);
    return (!params.from || day >= params.from.slice(0, 10)) && (!params.to || day <= params.to.slice(0, 10)) && (!params.category || expense.category === params.category) && (!params.payment || expense.payment === params.payment);
  });
}

export async function getExpenseSummary(params: GetExpenseSummaryParams = {}): Promise<Summary> {
  const all = await getAllExpenses();
  let filtered: Expense[];
  if (params.from || params.to) filtered = filterExpenses(all, params);
  else if (params.date) filtered = filterExpenses(all, { from: params.date, to: params.date, category: params.category, payment: params.payment });
  else filtered = filterExpenses(all, { from: dateKey(new Date().toISOString()), to: dateKey(new Date().toISOString()), category: params.category, payment: params.payment });
  const byCategory = new Map<ExpenseCategory, { category: ExpenseCategory; total: number; count: number }>();
  const byPayment = new Map<PaymentMethod, { payment: PaymentMethod; total: number; count: number }>();
  for (const expense of filtered) {
    const category = byCategory.get(expense.category) ?? { category: expense.category, total: 0, count: 0 };
    category.total += expense.amount; category.count += 1; byCategory.set(expense.category, category);
    const payment = byPayment.get(expense.payment) ?? { payment: expense.payment, total: 0, count: 0 };
    payment.total += expense.amount; payment.count += 1; byPayment.set(expense.payment, payment);
  }
  return { date: params.from ?? params.date ?? dateKey(new Date().toISOString()), total: filtered.reduce((sum, e) => sum + e.amount, 0), count: filtered.length, byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total), byPayment: [...byPayment.values()].sort((a, b) => b.total - a.total) };
}

export async function exportExpensesBackup(): Promise<Blob> {
  const expenses = await getAllExpenses();
  const backup = { app: 'Kharcha Khata', formatVersion: 1, exportedAt: new Date().toISOString(), expenses };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

export async function importExpensesBackup(raw: unknown): Promise<number> {
  const value = raw as { app?: unknown; formatVersion?: unknown; expenses?: unknown };
  if (!value || value.app !== 'Kharcha Khata' || value.formatVersion !== 1 || !Array.isArray(value.expenses)) throw new Error('This is not a supported Kharcha Khata backup file.');
  const allowedCategories = Object.values(ExpenseCategory) as string[];
  const allowedPayments = Object.values(PaymentMethod) as string[];
  const validated = value.expenses.map((entry: any) => {
    if (!entry || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0 || !allowedCategories.includes(entry.category) || !allowedPayments.includes(entry.payment) || typeof entry.spentAt !== 'string' || Number.isNaN(new Date(entry.spentAt).getTime())) throw new Error('The backup contains an invalid expense entry. No data was imported.');
    return { amount: Number(entry.amount), category: entry.category as ExpenseCategory, item: typeof entry.item === 'string' ? entry.item.slice(0, 500) : null, payment: entry.payment as PaymentMethod, spentAt: new Date(entry.spentAt).toISOString() };
  });
  await withStore<number>('readwrite', (store, resolve, reject) => {
    const clear = store.clear();
    clear.onerror = () => reject(clear.error);
    clear.onsuccess = () => {
      if (!validated.length) { resolve(0); return; }
      let remaining = validated.length;
      for (const entry of validated) {
        const request = store.add(entry);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { remaining -= 1; if (!remaining) resolve(validated.length); };
      }
    };
  });
  return validated.length;
}

export const getListExpensesQueryKey = (_params?: ListExpensesParams) => ['local-expenses'] as const;
export const getGetExpenseSummaryQueryKey = (_params?: GetExpenseSummaryParams) => ['local-expense-summary'] as const;
export function useListExpenses(params: ListExpensesParams = {}) {
  return useQuery({ queryKey: [...getListExpensesQueryKey(), params], queryFn: async () => filterExpenses(await getAllExpenses(), params) });
}
export function useGetExpenseSummary(params: GetExpenseSummaryParams = {}) {
  return useQuery({ queryKey: [...getGetExpenseSummaryQueryKey(), params], queryFn: () => getExpenseSummary(params) });
}
export function useCreateExpense() {
  return useMutation({ mutationFn: ({ data }: { data: ExpenseInput }) => addExpense(data) });
}
export function useDeleteExpense() {
  return useMutation({ mutationFn: ({ id }: { id: number }) => removeExpense(id) });
}
export function useDeleteExpensesBulk() {
  return useMutation({ mutationFn: ({ data }: { data: { from: string; to: string } }) => removeExpensesBulk(data.from, data.to) });
}
