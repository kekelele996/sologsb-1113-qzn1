import { useCallback } from 'react';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { useSessionStore } from '../stores/sessionStore';
import type { MaintenanceHit, MaintenanceWindow } from '../types';
import { overlapRange } from '../utils/astro';

export interface MaintenanceCheckInput {
  nightId: string;
  telescopeId: string;
  startTime: string;
  endTime: string;
}

export interface MaintenanceCheckApi {
  /** 候选排程时段撞上的维护窗口（新增 / 编辑排程段时校验封锁） */
  windowsHitBy: (input: MaintenanceCheckInput) => MaintenanceHit[];
  /** 某维护窗口撞上的排程段（登记维护后列出受影响目标） */
  sessionsHitBy: (window: MaintenanceWindow) => MaintenanceHit[];
  /** 某一观测夜内全部维护 × 排程碰撞 */
  hitsOfNight: (nightId: string) => MaintenanceHit[];
  /** 被维护封锁命中的排程段 id 集合（可传观测夜过滤） */
  blockedSessionIds: (nightId?: string) => Set<string>;
  /** 某观测夜（可选某台望远镜）的维护窗口 */
  windowsOf: (nightId: string, telescopeId?: string) => MaintenanceWindow[];
}

function toHit(window: MaintenanceWindow, sessionId: string, overlap: { startText: string; endText: string; minutes: number }): MaintenanceHit {
  return {
    windowId: window.id,
    sessionId,
    nightId: window.nightId,
    telescopeId: window.telescopeId,
    windowStart: window.startTime,
    windowEnd: window.endTime,
    reason: window.reason,
    overlapMinutes: overlap.minutes,
    overlapStart: overlap.startText,
    overlapEnd: overlap.endText,
    overlapText: `${overlap.startText}-${overlap.endText} 重叠 ${overlap.minutes} 分钟`,
  };
}

/** 维护时段 × 排程段碰撞检测；被设备分配视图、排程段列表、总览与导出页消费 */
export function useMaintenanceCheck(): MaintenanceCheckApi {
  const windows = useMaintenanceStore((s) => s.windows);
  const sessions = useSessionStore((s) => s.sessions);

  const windowsHitBy = useCallback(
    (input: MaintenanceCheckInput): MaintenanceHit[] => {
      return windows
        .filter((window) => window.nightId === input.nightId && window.telescopeId === input.telescopeId)
        .map((window) => {
          const overlap = overlapRange(input.startTime, input.endTime, window.startTime, window.endTime);
          return overlap ? toHit(window, '', overlap) : null;
        })
        .filter((hit): hit is MaintenanceHit => hit !== null);
    },
    [windows],
  );

  const sessionsHitBy = useCallback(
    (window: MaintenanceWindow): MaintenanceHit[] => {
      return sessions
        .filter((session) => session.nightId === window.nightId && session.telescopeId === window.telescopeId)
        .map((session) => {
          const overlap = overlapRange(window.startTime, window.endTime, session.startTime, session.endTime);
          return overlap ? toHit(window, session.id, overlap) : null;
        })
        .filter((hit): hit is MaintenanceHit => hit !== null);
    },
    [sessions],
  );

  const hitsOfNight = useCallback(
    (nightId: string): MaintenanceHit[] => {
      return windows.filter((window) => window.nightId === nightId).flatMap((window) => sessionsHitBy(window));
    },
    [windows, sessionsHitBy],
  );

  const blockedSessionIds = useCallback(
    (nightId?: string): Set<string> => {
      const scoped = nightId ? windows.filter((window) => window.nightId === nightId) : windows;
      const ids = new Set<string>();
      scoped.forEach((window) => sessionsHitBy(window).forEach((hit) => ids.add(hit.sessionId)));
      return ids;
    },
    [windows, sessionsHitBy],
  );

  const windowsOf = useCallback(
    (nightId: string, telescopeId?: string): MaintenanceWindow[] => {
      return windows.filter((window) => window.nightId === nightId && (!telescopeId || window.telescopeId === telescopeId));
    },
    [windows],
  );

  return { windowsHitBy, sessionsHitBy, hitsOfNight, blockedSessionIds, windowsOf };
}
