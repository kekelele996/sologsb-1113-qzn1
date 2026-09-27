import type { Instrument, MaintenanceWindow, ObsNight, ObsSession, ObsTarget, Telescope } from '../types';
import { formatMinutes, nightTotalMinutes, nightUsableWindows, overlapRange } from './astro';

export interface PlanContext {
  night?: ObsNight;
  sessions: ObsSession[];
  targets: ObsTarget[];
  telescopes: Telescope[];
  instruments: Instrument[];
  /** 本夜设备维护时段（可选，传入后导出受影响目标与夜间可用时间） */
  maintenances?: MaintenanceWindow[];
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 生成当晚观测清单文本（目标、时刻、滤镜、帧数 + 维护时段与夜间可用时间） */
export function buildNightPlanText(context: PlanContext): string {
  const { night, sessions, targets, telescopes, instruments, maintenances } = context;
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

  // 设备维护时段：受影响目标 + 夜间还能用的时间
  const windows = maintenances ?? [];
  if (night) {
    lines.push('-'.repeat(96));
    lines.push('设备维护时段（停机检修封锁）');
    if (windows.length === 0) {
      lines.push('本夜无维护时段，设备全程可用');
    } else {
      windows.forEach((window, index) => {
        const telescope = telescopes.find((item) => item.id === window.telescopeId);
        lines.push(`${pad(index + 1)} ${telescope?.code ?? '-'} ${window.startTime}-${window.endTime}　原因：${window.reason}`);
        const hits = ordered
          .filter((session) => session.telescopeId === window.telescopeId)
          .map((session) => ({ session, range: overlapRange(session.startTime, session.endTime, window.startTime, window.endTime) }))
          .filter((item): item is { session: ObsSession; range: NonNullable<ReturnType<typeof overlapRange>> } => item.range !== null);
        if (hits.length === 0) {
          lines.push('   受影响目标：无');
        } else {
          hits.forEach((hit) => {
            const target = targets.find((item) => item.id === hit.session.targetId);
            lines.push(
              `   受影响目标：${target?.name ?? '未知目标'}（${target?.catalog ?? '-'}）排程 ${hit.session.startTime}-${hit.session.endTime}，${hit.range.startText}-${hit.range.endText} 重叠 ${hit.range.minutes} 分钟`,
            );
          });
        }
      });
    }
    lines.push(`夜间可用时间（日落 ${night.sunset} → 日出 ${night.sunrise}，扣除维护时段）：`);
    const nightTotal = nightTotalMinutes(night);
    telescopes.forEach((telescope) => {
      const blocks = windows.filter((window) => window.telescopeId === telescope.id);
      const usable = nightUsableWindows(night, blocks);
      const totalUsable = usable.reduce((sum, window) => sum + window.minutes, 0);
      const blockedMinutes = nightTotal - totalUsable;
      const usableText = usable.length > 0 ? usable.map((window) => `${window.startText}-${window.endText}`).join('、') : '无（全夜维护）';
      lines.push(
        `${telescope.code}：${usableText}　可用合计 ${formatMinutes(totalUsable)}${blockedMinutes > 0 ? `，维护占用 ${formatMinutes(blockedMinutes)}` : ''}`,
      );
    });
  }

  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  return lines.join('\n');
}

/** 生成 CSV（含维护冲突标记列） */
export function buildPlanCsv(context: PlanContext): string {
  const { sessions, targets, telescopes, instruments, maintenances } = context;
  const windows = maintenances ?? [];
  const header = ['观测夜', '时段', '目标名', '星表编号', '类型', '视星等', '望远镜', '终端', '滤镜', '帧数', '单帧曝光(s)', '状态', '维护冲突', '改期原因'];
  const rows = [...sessions]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((session) => {
      const target = targets.find((item) => item.id === session.targetId);
      const telescope = telescopes.find((item) => item.id === session.telescopeId);
      const instrument = instruments.find((item) => item.id === session.instrumentId);
      const hit = windows
        .filter((window) => window.telescopeId === session.telescopeId)
        .map((window) => overlapRange(session.startTime, session.endTime, window.startTime, window.endTime))
        .find((range) => range !== null);
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
        hit ? `维护封锁 ${hit.startText}-${hit.endText}（${hit.minutes} 分钟）` : '',
        session.rescheduleReason ?? '',
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
