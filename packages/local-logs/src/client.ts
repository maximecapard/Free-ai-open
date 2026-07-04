import { createIndexedDbLocalLogStore } from "./indexed-db-store";
import { sanitizeLocalLogInput } from "./sanitize";
import type { LocalLogInput, LocalLogRecord, LocalLogsClientOptions, LocalLogStore } from "./types";

const DEFAULT_MAX_LOGS = 500;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `local-log-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function byTimestampAscending(left: LocalLogRecord, right: LocalLogRecord): number {
  return Date.parse(left.timestamp) - Date.parse(right.timestamp);
}

function byTimestampDescending(left: LocalLogRecord, right: LocalLogRecord): number {
  return Date.parse(right.timestamp) - Date.parse(left.timestamp);
}

export class LocalLogsClient {
  private readonly store: LocalLogStore | null;
  private readonly maxLogs: number;
  private readonly maxAgeMs: number;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: LocalLogsClientOptions = {}) {
    this.store = options.store === undefined ? createIndexedDbLocalLogStore() : options.store;
    this.maxLogs = options.maxLogs ?? DEFAULT_MAX_LOGS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? createId;
  }

  async addLocalLog(event: LocalLogInput): Promise<LocalLogRecord | null> {
    if (!this.store) return null;

    const record = sanitizeLocalLogInput(event, this.idFactory(), this.now().toISOString());
    if (!record) return null;

    try {
      await this.store.add(record);
      await this.pruneLocalLogs();
      return record;
    } catch {
      return null;
    }
  }

  async getLocalLogs(): Promise<LocalLogRecord[]> {
    if (!this.store) return [];

    try {
      return (await this.store.getAll()).sort(byTimestampAscending);
    } catch {
      return [];
    }
  }

  async getRecentLocalLogs(limit: number): Promise<LocalLogRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) return [];
    const logs = await this.getLocalLogs();
    return logs.sort(byTimestampDescending).slice(0, limit);
  }

  async clearLocalLogs(): Promise<void> {
    if (!this.store) return;

    try {
      await this.store.clear();
    } catch {
      return;
    }
  }

  async pruneLocalLogs(): Promise<number> {
    if (!this.store) return 0;

    try {
      const logs = (await this.store.getAll()).sort(byTimestampAscending);
      const cutoff = this.now().getTime() - this.maxAgeMs;
      const expiredIds = logs.filter((log) => Date.parse(log.timestamp) < cutoff).map((log) => log.id);
      const freshLogs = logs.filter((log) => !expiredIds.includes(log.id));
      const excessCount = Math.max(0, freshLogs.length - this.maxLogs);
      const excessIds = freshLogs.slice(0, excessCount).map((log) => log.id);
      const idsToDelete = [...expiredIds, ...excessIds];

      if (idsToDelete.length > 0) {
        await this.store.delete(idsToDelete);
      }

      return idsToDelete.length;
    } catch {
      return 0;
    }
  }
}

const defaultClient = new LocalLogsClient();

export function createLocalLogsClient(options: LocalLogsClientOptions = {}): LocalLogsClient {
  return new LocalLogsClient(options);
}

export function addLocalLog(event: LocalLogInput): Promise<LocalLogRecord | null> {
  return defaultClient.addLocalLog(event);
}

export function getLocalLogs(): Promise<LocalLogRecord[]> {
  return defaultClient.getLocalLogs();
}

export function getRecentLocalLogs(limit: number): Promise<LocalLogRecord[]> {
  return defaultClient.getRecentLocalLogs(limit);
}

export function clearLocalLogs(): Promise<void> {
  return defaultClient.clearLocalLogs();
}

export function pruneLocalLogs(): Promise<number> {
  return defaultClient.pruneLocalLogs();
}
