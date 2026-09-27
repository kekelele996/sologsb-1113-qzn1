import type { Instrument, MaintenanceWindow, ObsNight, ObsSession, ObsTarget, Telescope } from '../types';
import { axisRangeOf, formatMinutes, minutesToTime, nightSpanAxis, overlapRange, subtractRanges } from './astro';

export interface PlanContext {
  night?: ObsNight;
  sessions: ObsSession[];
  targets: ObsTarget[];
  telescopes: Telescope[];
  instruments: Instrument[];
  /** 本夜设备维护时段（可选，传入后导出受影响目标与夜间可用时间） */
  maintenance?: MaintenanceWindow[];
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 生成当晚观测清单文本（目标、时刻、滤镜、帧数） */
export function buildNightPlanText(context: PlanContext): string {
  const { night, sessions, targets, telescopes, instruments, maintenance = [] } = context;
  const lines: string[] = [];
  lines.push('天文观测夜编排表');
  lines.push(`观测夜：${night?.date ?? '-'}　站点：${night?.siteName ?? '-'}　值班人：${night?.dutyOfficer ?? '-'}`);
  lines.push(
    `月相：${night ? `${night.moonPhasePct}%（${night.moonrise} 月出 / ${night.moonset} 月落）` : '-'}　日落日出：${
      night ? `${night.sunset} / ${night.sunrise}` : '-'
    }　云量预报：${night?.cloudText ?? '-'}`,
  );
  lines.push('-'.repeat(96));
  lines.push('序 时段           目标            望远镜   终端            滤镜  帧数  状态      备注');
  const ordered = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
  ordered.forEach((session, index) => {
    const target = targets.find((item) => item.id === session.targetId);
    const telescope = telescopes.find((item) => item.id === session.telescopeId);
    const instrument = instruments.find((item) => item.id === session.instrumentId);
    lines.push(
      [
        pad(index + 1),
        `${session.startTime}-${session.endTime}`.padEnd(14, ' '),
        `${target?.name ?? '未知目标'}（${target?.catalog ?? '-'}）`.padEnd(24, ' '),
        (telescope?.code ?? '-').padEnd(8, ' '),
        (instrument?.model ?? '-').padEnd(16, ' '),
        session.filterSlot.padEnd(6, ' '),
        pad(session.plannedFrames, 4),
        session.status.padEnd(8, ' '),
        session.rescheduleReason ?? '',
      ].join(' '),
    );
  });
  lines.push('-'.repeat(96));
  const totalFrames = ordered.reduce((sum, session) => sum + session.plannedFrames, 0);
  const totalExposure = ordered.reduce((sum, session) => {
    const target = targets.find((item) => item.id === session.targetId);
    return sum + (target ? (session.plannedFrames * target.exposureSec) / 60 : 0);
  }, 0);
  lines.push(`合计排程段 ${ordered.length} 段，计划帧数 ${totalFrames} 帧，预计曝光 ${totalExposure.toFixed(1)} 分钟`);

  // 设备维护时段：受影响目标与重叠时间 + 扣除维护后的夜间可用时间
  const windows = night ? maintenance.filter((window) => window.nightId === night.id) : [];
  if (night && windows.length > 0) {
    lines.push('-'.repeat(96));
    lines.push(`设备维护时段（本夜 ${windows.length} 段）`);
    windows.forEach((window) => {
      const telescope = telescopes.find((item) => item.id === window.telescopeId);
      lines.push(`■ ${telescope?.code ?? window.telescopeId} ${window.startTime}-${window.endTime}　原因：${window.reason}`);
      const hits = ordered
        .filter((session) => session.telescopeId === window.telescopeId)
        .map((session) => ({ session, overlap: overlapRange(window.startTime, window.endTime, session.startTime, session.endTime) }))
        .filter((item): item is { session: ObsSession; overlap: NonNullable<ReturnType<typeof overlapRange>> } => item.overlap !== null);
      if (hits.length === 0) {
        lines.push('　未影响本夜任何排程段');
      } else {
        hits.forEach(({ session, overlap }) => {
          const target = targets.find((item) => item.id === session.targetId);
          lines.push(
            `　受影响目标：${target?.name ?? '未知目标'}（${target?.catalog ?? '-'}）排程 ${session.startTime}-${session.endTime}，重叠 ${overlap.startText}-${overlap.endText}（${overlap.minutes} 分钟）`,
          );
        });
      }
    });
    const span = nightSpanAxis(night);
    lines.push(`夜间可用时间（${minutesToTime(span.start)} → ${minutesToTime(span.end)}，扣除维护时段）`);
    telescopes
      .filter((telescope) => windows.some((window) => window.telescopeId === telescope.id))
      .forEach((telescope) => {
        const blocks = windows.filter((window) => window.telescopeId === telescope.id).map((window) => axisRangeOf(window.startTime, window.endTime));
        const free = subtractRanges(span, blocks);
        const total = free.reduce((sum, range) => sum + (range.end - range.start), 0);
        lines.push(
          `■ ${telescope.code}：${free.length > 0 ? free.map((range) => `${minutesToTime(range.start)}-${minutesToTime(range.end)}`).join('、') : '无可用时段'}（合计 ${formatMinutes(total)}）`,
        );
      });
    const unaffected = telescopes.filter((telescope) => !windows.some((window) => window.telescopeId === telescope.id));
    if (unaffected.length > 0) {
      lines.push(`■ ${unaffected.map((telescope) => telescope.code).join('、')}：无维护安排，${minutesToTime(span.start)}-${minutesToTime(span.end)} 整夜可用`);
    }
  }

  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  return lines.join('\n');
}

/** 生成 CSV */
export function buildPlanCsv(context: PlanContext): string {
  const { sessions, targets, telescopes, instruments, maintenance = [] } = context;
  const header = ['观测夜', '时段', '目标名', '星表编号', '类型', '视星等', '望远镜', '终端', '滤镜', '帧数', '单帧曝光(s)', '状态', '改期原因', '维护封锁'];
  const rows = [...sessions]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((session) => {
      const target = targets.find((item) => item.id === session.targetId);
      const telescope = telescopes.find((item) => item.id === session.telescopeId);
      const instrument = instruments.find((item) => item.id === session.instrumentId);
      const maintenanceNote = maintenance
        .filter((window) => window.nightId === session.nightId && window.telescopeId === session.telescopeId)
        .map((window) => {
          const overlap = overlapRange(window.startTime, window.endTime, session.startTime, session.endTime);
          return overlap ? `维护 ${window.startTime}-${window.endTime}（${window.reason}）重叠 ${overlap.startText}-${overlap.endText} ${overlap.minutes}分钟` : '';
        })
        .filter(Boolean)
        .join('；');
      return [
        session.nightId,
        `${session.startTime}-${session.endTime}`,
        target?.name ?? '',
        target?.catalog ?? '',
        target?.type ?? '',
        target ? String(target.magnitude) : '',
        telescope?.code ?? '',
        instrument?.model ?? '',
        session.filterSlot,
        String(session.plannedFrames),
        target ? String(target.exposureSec) : '',
        session.status,
        session.rescheduleReason ?? '',
        maintenanceNote,
      ];
    });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return `\ufeff${csv}`;
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 打印当前视图（打印视图） */
export function printPage(): void {
  window.print();
}
