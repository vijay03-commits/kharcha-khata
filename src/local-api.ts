import { useMutation, useQuery } from '@tanstack/react-query';

export const ExpenseCategory = {
  Food: 'Food', Transport: 'Transport', Shopping: 'Shopping', Bills: 'Bills',
  Health: 'Health', Entertainment: 'Entertainment', Other: 'Other',
} as const;
export type ExpenseCategory = typeof ExpenseCategory[keyof typeof ExpenseCategory];
export const PaymentMethod = { Cash: 'Cash', UPI: 'UPI', Card: 'Card', Other: 'Other' } as const;
export type PaymentMethod = typeof PaymentMethod[keyof typeof PaymentMethod];
export type BalanceTransactionType = 'credit' | 'debit';

export interface BalanceTransaction {
  id: number;
  type: BalanceTransactionType;
  amount: number;
  description: string;
  person?: string | null;
  payment: PaymentMethod;
  createdAt: string;
  /** Set only for debit entries automatically created from a new expense. */
  sourceExpenseId?: number | null;
}

export interface BalanceTransactionInput {
  type: BalanceTransactionType;
  amount: number;
  description: string;
  person?: string;
  payment: PaymentMethod;
  createdAt?: string;
}
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
const DB_VERSION = 2;
const STORE_NAME = 'expenses';
const BALANCE_STORE_NAME = 'balance-transactions';

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser does not support local offline storage.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(BALANCE_STORE_NAME)) db.createObjectStore(BALANCE_STORE_NAME, { keyPath: 'id', autoIncrement: true });
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
async function withBalanceStore<T>(
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void
  ) => void
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(BALANCE_STORE_NAME, mode);
    work(tx.objectStore(BALANCE_STORE_NAME), resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Balance storage operation failed.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Balance storage operation was cancelled.'));
    };
  });
}
export async function getAllBalanceTransactions(): Promise<BalanceTransaction[]> {
  return withBalanceStore<BalanceTransaction[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      resolve(
        (request.result as BalanceTransaction[]).sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
            b.id - a.id
        )
      );
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addBalanceTransaction(
  input: BalanceTransactionInput
): Promise<BalanceTransaction> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }

  if (!['credit', 'debit'].includes(input.type)) {
    throw new Error('Choose received or spent.');
  }

  if (!input.description.trim()) {
    throw new Error('Enter a description.');
  }

  const record = {
    type: input.type,
    amount: Number(input.amount),
    description: input.description.trim().slice(0, 500),
    person: input.person?.trim().slice(0, 200) || null,
    payment: input.payment,
    createdAt: input.createdAt
      ? new Date(input.createdAt).toISOString()
      : new Date().toISOString(),
  };

  return withBalanceStore<BalanceTransaction>('readwrite', (store, resolve, reject) => {
    const request = store.add(record);
    request.onsuccess = () => resolve({ ...record, id: Number(request.result) });
    request.onerror = () => reject(request.error);
  });
}

export async function removeBalanceTransaction(id: number): Promise<void> {
  return withBalanceStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getCurrentBalance(): Promise<number> {
  const transactions = await getAllBalanceTransactions();

  return transactions.reduce(
    (balance, transaction) =>
      balance + (transaction.type === 'credit' ? transaction.amount : -transaction.amount),
    0
  );
}
export async function getAllExpenses(): Promise<Expense[]> {
  return withStore<Expense[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as Expense[]).sort((a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime() || b.id - a.id));
    request.onerror = () => reject(request.error);
  });
}

export async function addExpense(input: ExpenseInput): Promise<Expense> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }

  const db = await openDb();
  return new Promise<Expense>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BALANCE_STORE_NAME], 'readwrite');
    const expenseStore = tx.objectStore(STORE_NAME);
    const balanceStore = tx.objectStore(BALANCE_STORE_NAME);
    const spentAt = input.spentAt
      ? new Date(input.spentAt).toISOString()
      : new Date().toISOString();
    const record = {
      amount: Number(input.amount),
      category: input.category,
      item: input.item?.trim() || null,
      payment: input.payment,
      spentAt,
    };
    let savedExpense: Expense | undefined;

    const request = expenseStore.add(record);
    request.onsuccess = () => {
      const expenseId = Number(request.result);
      savedExpense = { ...record, id: expenseId };
      balanceStore.add({
        type: 'debit',
        amount: record.amount,
        description: record.item ? `${record.category}: ${record.item}` : record.category,
        person: null,
        payment: record.payment,
        createdAt: record.spentAt,
        sourceExpenseId: expenseId,
      });
    };
    request.onerror = () => reject(request.error ?? new Error('Could not save the expense.'));
    tx.oncomplete = () => {
      db.close();
      if (savedExpense) resolve(savedExpense);
      else reject(new Error('Could not save the expense.'));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Could not save the expense and update the balance.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Could not save the expense and update the balance.'));
    };
  });
}

export async function removeExpense(id: number): Promise<ExpenseDeleteSnapshot> {
  const db = await openDb();
  try {
    return await new Promise<ExpenseDeleteSnapshot>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, BALANCE_STORE_NAME], 'readwrite');
      const expenseStore = tx.objectStore(STORE_NAME);
      const balanceStore = tx.objectStore(BALANCE_STORE_NAME);
      let snapshot: ExpenseDeleteSnapshot | undefined;
      const expenseRequest = expenseStore.get(id);
      expenseRequest.onsuccess = () => {
        const expense = expenseRequest.result as Expense | undefined;
        if (!expense) { tx.abort(); reject(new Error('This expense no longer exists.')); return; }
        const linkedRequest = balanceStore.getAll();
        linkedRequest.onsuccess = () => {
          const linkedTransactions = (linkedRequest.result as BalanceTransaction[]).filter((transaction) => transaction.sourceExpenseId === id);
          snapshot = { expense, linkedTransactions };
          for (const transaction of linkedTransactions) balanceStore.delete(transaction.id);
          expenseStore.delete(id);
        };
        linkedRequest.onerror = () => reject(linkedRequest.error);
      };
      expenseRequest.onerror = () => reject(expenseRequest.error);
      tx.oncomplete = () => { if (snapshot) resolve(snapshot); else reject(new Error('Could not remove the expense.')); };
      tx.onerror = () => reject(tx.error ?? new Error('Could not remove the expense.'));
      tx.onabort = () => reject(tx.error ?? new Error('Could not remove the expense.'));
    });
  } finally { db.close(); }
}

export interface ExpenseDeleteSnapshot { expense: Expense; linkedTransactions: BalanceTransaction[] }

export async function updateExpense(id: number, input: ExpenseInput): Promise<Expense> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Enter an amount greater than zero.');
  const db = await openDb();
  return new Promise<Expense>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BALANCE_STORE_NAME], 'readwrite');
    const expenses = tx.objectStore(STORE_NAME);
    const balances = tx.objectStore(BALANCE_STORE_NAME);
    const get = expenses.get(id);
    let updated: Expense | undefined;
    get.onsuccess = () => {
      const current = get.result as Expense | undefined;
      if (!current) { tx.abort(); reject(new Error('This expense no longer exists.')); return; }
      const spentAt = input.spentAt ? new Date(input.spentAt).toISOString() : current.spentAt;
      updated = { id, amount: Number(input.amount), category: input.category, item: input.item?.trim() || null, payment: input.payment, spentAt };
      expenses.put(updated);
      const linked = balances.getAll();
      linked.onsuccess = () => {
        for (const item of linked.result as BalanceTransaction[]) if (item.sourceExpenseId === id) {
          balances.put({ ...item, amount: updated!.amount, description: updated!.item ? `${updated!.category}: ${updated!.item}` : updated!.category, payment: updated!.payment, createdAt: updated!.spentAt });
        }
      };
    };
    get.onerror = () => reject(get.error);
    tx.oncomplete = () => { db.close(); if (updated) resolve(updated); else reject(new Error('Could not update the expense.')); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not update expense and balance together.')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Update cancelled.')); };
  });
}

export async function restoreDeletedExpense(snapshot: ExpenseDeleteSnapshot): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, BALANCE_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).put(snapshot.expense);
      for (const transaction of snapshot.linkedTransactions) tx.objectStore(BALANCE_STORE_NAME).put(transaction);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not undo deletion.'));
      tx.onabort = () => reject(tx.error ?? new Error('Could not undo deletion.'));
    });
  } finally { db.close(); }
}


export async function removeExpensesBulk(from: string, to: string): Promise<{ deletedCount: number }> {
  const all = await getAllExpenses();
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const ids = all
    .filter((expense) => new Date(expense.spentAt).getTime() >= start && new Date(expense.spentAt).getTime() < end)
    .map((expense) => expense.id);
  if (!ids.length) return { deletedCount: 0 };

  const idSet = new Set(ids);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BALANCE_STORE_NAME], 'readwrite');
    const expenseStore = tx.objectStore(STORE_NAME);
    const balanceStore = tx.objectStore(BALANCE_STORE_NAME);
    const linkedRequest = balanceStore.getAll();
    linkedRequest.onsuccess = () => {
      for (const transaction of linkedRequest.result as BalanceTransaction[]) {
        if (transaction.sourceExpenseId != null && idSet.has(transaction.sourceExpenseId)) {
          balanceStore.delete(transaction.id);
        }
      }
      for (const id of ids) expenseStore.delete(id);
    };
    linkedRequest.onerror = () => reject(linkedRequest.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not remove expenses.'));
    tx.onabort = () => reject(tx.error ?? new Error('Could not remove expenses.'));
  }).finally(() => db.close());

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
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, BALANCE_STORE_NAME], 'readwrite');
    const expenseStore = tx.objectStore(STORE_NAME);
    const balanceStore = tx.objectStore(BALANCE_STORE_NAME);
    const existingBalanceRequest = balanceStore.getAll();
    existingBalanceRequest.onsuccess = () => {
      // Remove only automatically generated debits for the expenses being replaced.
      // Manually entered Credits & Balance transactions remain untouched.
      for (const transaction of existingBalanceRequest.result as BalanceTransaction[]) {
        if (transaction.sourceExpenseId != null) balanceStore.delete(transaction.id);
      }
      expenseStore.clear();
      for (const entry of validated) expenseStore.add(entry);
    };
    existingBalanceRequest.onerror = () => reject(existingBalanceRequest.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not restore the expense backup.'));
    tx.onabort = () => reject(tx.error ?? new Error('Could not restore the expense backup.'));
  }).finally(() => db.close());
  return validated.length;
}

export async function exportBalanceBackup(): Promise<Blob> {
  const balanceTransactions = await getAllBalanceTransactions();
  const backup = {
    app: 'Kharcha Khata',
    backupType: 'credits-and-balance',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    balanceTransactions,
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

export async function importBalanceBackup(raw: unknown): Promise<number> {
  const value = raw as {
    app?: unknown;
    backupType?: unknown;
    formatVersion?: unknown;
    balanceTransactions?: unknown;
  };
  if (
    !value ||
    value.app !== 'Kharcha Khata' ||
    value.backupType !== 'credits-and-balance' ||
    value.formatVersion !== 1 ||
    !Array.isArray(value.balanceTransactions)
  ) {
    throw new Error('This is not a supported Credits & Balance backup file.');
  }

  const allowedPayments = Object.values(PaymentMethod) as string[];
  const validated = value.balanceTransactions.map((entry: any) => {
    if (
      !entry ||
      !['credit', 'debit'].includes(entry.type) ||
      !Number.isFinite(Number(entry.amount)) ||
      Number(entry.amount) <= 0 ||
      typeof entry.description !== 'string' ||
      !entry.description.trim() ||
      !allowedPayments.includes(entry.payment) ||
      typeof entry.createdAt !== 'string' ||
      Number.isNaN(new Date(entry.createdAt).getTime()) ||
      (entry.person != null && typeof entry.person !== 'string')
    ) {
      throw new Error('The balance backup contains an invalid transaction. No data was imported.');
    }
    return {
      type: entry.type as BalanceTransactionType,
      amount: Number(entry.amount),
      description: entry.description.trim().slice(0, 500),
      person: typeof entry.person === 'string' ? entry.person.trim().slice(0, 200) || null : null,
      payment: entry.payment as PaymentMethod,
      createdAt: new Date(entry.createdAt).toISOString(),
      sourceExpenseId: Number.isInteger(entry.sourceExpenseId) && entry.sourceExpenseId > 0
        ? entry.sourceExpenseId
        : null,
    };
  });

  await withBalanceStore<number>('readwrite', (store, resolve, reject) => {
    const clear = store.clear();
    clear.onerror = () => reject(clear.error);
    clear.onsuccess = () => {
      if (!validated.length) {
        resolve(0);
        return;
      }
      let remaining = validated.length;
      for (const entry of validated) {
        const request = store.add(entry);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          remaining -= 1;
          if (!remaining) resolve(validated.length);
        };
      }
    };
  });
  return validated.length;
}


/** Complete local backup: expenses, balance transactions, and app-level settings. */
export async function exportFullBackup(): Promise<Blob> {
  const [expenses, balanceTransactions] = await Promise.all([getAllExpenses(), getAllBalanceTransactions()]);
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(localStorage.getItem('kharcha-khata-settings') || '{}'); } catch { settings = {}; }
  const backup = { app: 'Kharcha Khata', backupType: 'full', formatVersion: 1, exportedAt: new Date().toISOString(), expenses, balanceTransactions, settings };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

export async function importFullBackup(raw: unknown): Promise<{ expenses: number; balanceTransactions: number }> {
  const value = raw as { app?: unknown; backupType?: unknown; formatVersion?: unknown; expenses?: unknown; balanceTransactions?: unknown; settings?: unknown };
  if (!value || value.app !== 'Kharcha Khata' || value.backupType !== 'full' || value.formatVersion !== 1 || !Array.isArray(value.expenses) || !Array.isArray(value.balanceTransactions)) {
    throw new Error('This is not a supported full Kharcha Khata backup. No data was changed.');
  }
  const allowedCategories = Object.values(ExpenseCategory) as string[];
  const allowedPayments = Object.values(PaymentMethod) as string[];
  const expenses = value.expenses.map((entry: any) => {
    if (!entry || !Number.isFinite(Number(entry.id)) || Number(entry.id) <= 0 || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0 || !allowedCategories.includes(entry.category) || !allowedPayments.includes(entry.payment) || typeof entry.spentAt !== 'string' || Number.isNaN(new Date(entry.spentAt).getTime())) throw new Error('The full backup contains an invalid expense. No data was changed.');
    return { id: Number(entry.id), amount: Number(entry.amount), category: entry.category as ExpenseCategory, item: typeof entry.item === 'string' ? entry.item.slice(0, 500) : null, payment: entry.payment as PaymentMethod, spentAt: new Date(entry.spentAt).toISOString() };
  });
  const balanceTransactions = value.balanceTransactions.map((entry: any) => {
    if (!entry || !Number.isFinite(Number(entry.id)) || Number(entry.id) <= 0 || !['credit', 'debit'].includes(entry.type) || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0 || typeof entry.description !== 'string' || !entry.description.trim() || !allowedPayments.includes(entry.payment) || typeof entry.createdAt !== 'string' || Number.isNaN(new Date(entry.createdAt).getTime())) throw new Error('The full backup contains an invalid balance transaction. No data was changed.');
    const sourceExpenseId = entry.sourceExpenseId == null ? null : Number(entry.sourceExpenseId);
    if (sourceExpenseId != null && (!Number.isInteger(sourceExpenseId) || !expenses.some((expense) => expense.id === sourceExpenseId))) throw new Error('The full backup contains a broken expense-to-balance link. No data was changed.');
    return { id: Number(entry.id), type: entry.type as BalanceTransactionType, amount: Number(entry.amount), description: entry.description.trim().slice(0, 500), person: typeof entry.person === 'string' ? entry.person.trim().slice(0, 200) || null : null, payment: entry.payment as PaymentMethod, createdAt: new Date(entry.createdAt).toISOString(), sourceExpenseId };
  });
  if (value.settings != null && (typeof value.settings !== 'object' || Array.isArray(value.settings))) throw new Error('The settings section in this backup is invalid. No data was changed.');
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, BALANCE_STORE_NAME], 'readwrite');
      const expenseStore = tx.objectStore(STORE_NAME);
      const balanceStore = tx.objectStore(BALANCE_STORE_NAME);
      expenseStore.clear(); balanceStore.clear();
      for (const entry of expenses) expenseStore.add(entry);
      for (const entry of balanceTransactions) balanceStore.add(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not restore the full backup.'));
      tx.onabort = () => reject(tx.error ?? new Error('Could not restore the full backup.'));
    });
  } finally { db.close(); }
  try { localStorage.setItem('kharcha-khata-settings', JSON.stringify(value.settings ?? {})); } catch { /* app data restore succeeded; settings may be unavailable in restricted storage */ }
  return { expenses: expenses.length, balanceTransactions: balanceTransactions.length };
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
export function useUpdateExpense() {
  return useMutation({ mutationFn: ({ id, data }: { id: number; data: ExpenseInput }) => updateExpense(id, data) });
}
export function useDeleteExpensesBulk() {
  return useMutation({ mutationFn: ({ data }: { data: { from: string; to: string } }) => removeExpensesBulk(data.from, data.to) });
}
export const getBalanceTransactionsQueryKey = () =>
  ['local-balance-transactions'] as const;

export const getCurrentBalanceQueryKey = () =>
  ['local-current-balance'] as const;

export function useListBalanceTransactions() {
  return useQuery({
    queryKey: getBalanceTransactionsQueryKey(),
    queryFn: getAllBalanceTransactions,
  });
}

export function useGetCurrentBalance() {
  return useQuery({
    queryKey: getCurrentBalanceQueryKey(),
    queryFn: getCurrentBalance,
  });
}

export function useCreateBalanceTransaction() {
  return useMutation({
    mutationFn: ({ data }: { data: BalanceTransactionInput }) =>
      addBalanceTransaction(data),
  });
}

export function useDeleteBalanceTransaction() {
  return useMutation({
    mutationFn: ({ id }: { id: number }) => removeBalanceTransaction(id),
  });
}
