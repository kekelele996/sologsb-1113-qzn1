/** 设备维护时段（某观测夜某台望远镜的停机封锁区间） */
export interface MaintenanceWindow {
  id: string;
  /** 观测夜 ID */
  nightId: string;
  /** 望远镜 ID */
  telescopeId: string;
  /** 开始时刻 HH:mm */
  startTime: string;
  /** 结束时刻 HH:mm（可跨零点） */
  endTime: string;
  /** 维护原因 */
  reason: string;
  /** 数据结构版本 */
  schemaVersion: number;
}

/** 维护时段与排程段的碰撞结果 */
export interface MaintenanceHit {
  /** 维护时段 ID */
  windowId: string;
  /** 被撞上的排程段 ID（候选时段校验时为空串） */
  sessionId: string;
  nightId: string;
  telescopeId: string;
  /** 维护窗口开始时刻 HH:mm */
  windowStart: string;
  /** 维护窗口结束时刻 HH:mm */
  windowEnd: string;
  /** 维护原因 */
  reason: string;
  /** 重叠分钟数 */
  overlapMinutes: number;
  /** 重叠区间开始 HH:mm */
  overlapStart: string;
  /** 重叠区间结束 HH:mm */
  overlapEnd: string;
  /** 重叠区间文案 */
  overlapText: string;
}
