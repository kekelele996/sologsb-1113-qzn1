import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { SCHEMA_VERSION } from '../hooks/usePersistentStore';
import type { ConflictItem, MaintenanceHit, MaintenanceWindow, ObsSession } from '../types';
import { overlapMinutes, overlapRange, type OverlapRange } from '../utils/astro';

export interface ConflictCheckInput {
  nightId: string;
  telescopeId: string;
  startTime: string;
  endTime: string;
  /** 编辑时忽略自身 */
  ignoreSessionId?: string;
}

/** 某时段撞上的维护封锁（含重叠区间） */
export interface MaintenanceBlock {
  window: MaintenanceWindow;
  overlap: OverlapRange;
}

export interface ConflictCheckApi {
  findConflicts: (input: ConflictCheckInput) => ConflictItem[];
  /** 某一观测夜内的全部冲突（两两比对同一望远镜的重叠时段） */
  conflictsOfNight: (nightId: string) => ConflictItem[];
  /** 冲突排程段 id 集合（可传观测夜过滤） */
  conflictIds: (nightId?: string) => Set<string>;
  hasConflict: (sessionId: string) => boolean;
  /** 某时段撞上的维护封锁（新增 / 编辑排程段时校验） */
  findMaintenanceBlocks: (input: ConflictCheckInput) => MaintenanceBlock[];
  /** 某一观测夜内排程段 × 维护时段的全部重叠 */
  maintenanceHitsOfNight: (nightId: string) => MaintenanceHit[];
  /** 被维护封锁撞上的排程段 id 集合（可传观测夜过滤） */
  maintenanceConflictIds: (nightId?: string) => Set<string>;
}

function describe(a: ObsSession, b: ObsSession): ConflictItem | null {
  if (a.nightId !== b.nightId || a.telescopeId !== b.telescopeId || a.id === b.id) {
    return null;
  }
  const overlap = overlapMinutes(a.startTime, a.endTime, b.startTime, b.endTime);
  if (overlap <= 0) {
    return null;
  }
  const overlapStart = a.startTime > b.startTime ? a.startTime : b.startTime;
  return {
    sessionId: a.id,
    otherId: b.id,
    nightId: a.nightId,
    telescopeId: a.telescopeId,
    overlapMinutes: overlap,
    overlapText: `${overlapStart} 起重叠 ${overlap} 分钟`,
  };
}

/** 排程段与维护时段是否重叠，重叠则生成命中记录 */
function describeMaintenanceHit(session: ObsSession, window: MaintenanceWindow): MaintenanceHit | null {
  if (session.nightId !== window.nightId || session.telescopeId !== window.telescopeId) {
    return null;
  }
  const range = overlapRange(session.startTime, session.endTime, window.startTime, window.endTime);
  if (!range) {
    return null;
  }
  return {
    sessionId: session.id,
    maintenanceId: window.id,
    nightId: session.nightId,
    telescopeId: session.telescopeId,
    targetId: session.targetId,
    overlapMinutes: range.minutes,
    overlapText: `${range.startText}-${range.endText} 重叠 ${range.minutes} 分钟`,
  };
}

/** 输入设备与时段区间即返回冲突排程段数组与维护封锁；被排程段列表、设备分配视图与导出页消费 */
export function useConflictCheck(): ConflictCheckApi {
  const sessions = useSessionStore((s) => s.sessions);
  const maintenances = useEquipmentStore((s) => s.maintenances);

  const findConflicts = useCallback(
    (input: ConflictCheckInput): ConflictItem[] => {
      const candidate: ObsSession = {
        id: input.ignoreSessionId ?? '__candidate__',
        nightId: input.nightId,
        targetId: '',
        startTime: input.startTime,
        endTime: input.endTime,
        telescopeId: input.telescopeId,
        instrumentId: '',
        filterSlot: '',
        plannedFrames: 0,
        status: '待执行',
        schemaVersion: SCHEMA_VERSION,
      };
      return sessions
        .filter((session) => session.id !== input.ignoreSessionId)
        .map((session) => describe(candidate, session))
        .filter((item): item is ConflictItem => item !== null);
    },
    [sessions],
  );

  const conflictsOfNight = useCallback(
    (nightId: string): ConflictItem[] => {
      const scoped = sessions.filter((session) => session.nightId === nightId);
      const result: ConflictItem[] = [];
      scoped.forEach((a) => {
        scoped.forEach((b) => {
          const item = describe(a, b);
          if (item && !result.some((existing) => existing.sessionId === item.otherId && existing.otherId === item.sessionId)) {
            result.push(item);
          }
        });
      });
      return result;
    },
    [sessions],
  );

  const conflictIds = useCallback(
    (nightId?: string): Set<string> => {
      const ids = new Set<string>();
      const scoped = nightId ? sessions.filter((session) => session.nightId === nightId) : sessions;
      scoped.forEach((a) => {
        scoped.forEach((b) => {
          const item = describe(a, b);
          if (item) {
            ids.add(a.id);
            ids.add(b.id);
          }
        });
      });
      return ids;
    },
    [sessions],
  );

  const hasConflict = useCallback((sessionId: string) => conflictIds().has(sessionId), [conflictIds]);

  const findMaintenanceBlocks = useCallback(
    (input: ConflictCheckInput): MaintenanceBlock[] => {
      return maintenances
        .filter((window) => window.nightId === input.nightId && window.telescopeId === input.telescopeId)
        .map((window) => {
          const overlap = overlapRange(input.startTime, input.endTime, window.startTime, window.endTime);
          return overlap ? { window, overlap } : null;
        })
        .filter((item): item is MaintenanceBlock => item !== null);
    },
    [maintenances],
  );

  const maintenanceHitsOfNight = useCallback(
    (nightId: string): MaintenanceHit[] => {
      const hits: MaintenanceHit[] = [];
      const scopedSessions = sessions.filter((session) => session.nightId === nightId);
      const scopedWindows = maintenances.filter((window) => window.nightId === nightId);
      scopedSessions.forEach((session) => {
        scopedWindows.forEach((window) => {
          const hit = describeMaintenanceHit(session, window);
          if (hit) {
            hits.push(hit);
          }
        });
      });
      return hits;
    },
    [sessions, maintenances],
  );

  const maintenanceConflictIds = useCallback(
    (nightId?: string): Set<string> => {
      const ids = new Set<string>();
      const scopedSessions = nightId ? sessions.filter((session) => session.nightId === nightId) : sessions;
      const scopedWindows = nightId ? maintenances.filter((window) => window.nightId === nightId) : maintenances;
      scopedSessions.forEach((session) => {
        scopedWindows.forEach((window) => {
          if (describeMaintenanceHit(session, window)) {
            ids.add(session.id);
          }
        });
      });
      return ids;
    },
    [sessions, maintenances],
  );

  return { findConflicts, conflictsOfNight, conflictIds, hasConflict, findMaintenanceBlocks, maintenanceHitsOfNight, maintenanceConflictIds };
}
