import { create } from 'zustand';
import { db, deleteRow, persistRow, SCHEMA_VERSION } from '../hooks/usePersistentStore';
import { uid } from '../utils/id';
import type { MaintenanceWindow } from '../types';

export interface MaintenanceInput {
  nightId: string;
  telescopeId: string;
  startTime: string;
  endTime: string;
  reason: string;
}

interface MaintenanceState {
  windows: MaintenanceWindow[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addWindow: (input: MaintenanceInput) => Promise<MaintenanceWindow>;
  updateWindow: (id: string, patch: Partial<MaintenanceInput>) => Promise<void>;
  removeWindow: (id: string) => Promise<void>;
}

/** 设备维护时段（某夜某台望远镜的停机封锁），持久化到 IndexedDB */
export const useMaintenanceStore = create<MaintenanceState>()((set, get) => ({
  windows: [],
  hydrated: false,

  hydrate: async () => {
    const windows = await db.maintenance.orderBy('startTime').toArray();
    set({ windows, hydrated: true });
  },

  addWindow: async (input) => {
    const window: MaintenanceWindow = {
      id: uid('mnt'),
      nightId: input.nightId,
      telescopeId: input.telescopeId,
      startTime: input.startTime,
      endTime: input.endTime,
      reason: input.reason.trim(),
      schemaVersion: SCHEMA_VERSION,
    };
    await persistRow('maintenance', window);
    set({ windows: [...get().windows, window] });
    return window;
  },

  updateWindow: async (id, patch) => {
    const current = get().windows.find((window) => window.id === id);
    if (!current) return;
    const next: MaintenanceWindow = { ...current, ...patch, schemaVersion: SCHEMA_VERSION };
    await persistRow('maintenance', next);
    set({ windows: get().windows.map((window) => (window.id === id ? next : window)) });
  },

  removeWindow: async (id) => {
    await deleteRow('maintenance', id);
    set({ windows: get().windows.filter((window) => window.id !== id) });
  },
}));
