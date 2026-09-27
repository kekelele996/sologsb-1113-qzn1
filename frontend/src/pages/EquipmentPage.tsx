import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import ConflictBadge from '../components/common/ConflictBadge';
import { usePersistentStore } from '../hooks/usePersistentStore';
import { useConflictCheck } from '../hooks/useConflictCheck';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { NIGHT_TOTAL_MINUTES, TARGET_COLOR, type MaintenanceWindow, type ObsSession } from '../types';
import { axisMinutes, durationMinutes, minutesToTime, overlapRange, type OverlapRange } from '../utils/astro';

const SLOT_MINUTES = 30;

interface MaintenanceFormState {
  telescopeId: string;
  startTime: string;
  endTime: string;
  reason: string;
}

/** 保存维护时段后的反馈：撞上的排程段与重叠区间 */
interface MaintenanceSaveResult {
  window: MaintenanceWindow;
  hits: Array<{ session: ObsSession; range: OverlapRange }>;
}

/** 望远镜与终端分配视图：行 = 设备、列 = 30 分钟时段，冲突格标红并可一键跳转；支持登记维护时段并标出封锁区间 */
export default function EquipmentPage() {
  usePersistentStore();
  const navigate = useNavigate();
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const maintenances = useEquipmentStore((s) => s.maintenances);
  const addMaintenance = useEquipmentStore((s) => s.addMaintenance);
  const removeMaintenance = useEquipmentStore((s) => s.removeMaintenance);
  const fieldOfView = useEquipmentStore((s) => s.fieldOfView);
  const sessions = useSessionStore((s) => s.sessions);
  const nights = useNightStore((s) => s.nights);
  const currentNightId = useNightStore((s) => s.currentNightId);
  const setCurrentNight = useNightStore((s) => s.setCurrentNight);
  const targets = useTargetStore((s) => s.targets);
  const { conflictsOfNight, maintenanceHitsOfNight } = useConflictCheck();

  const [nightId, setNightId] = useState(currentNightId);
  const activeNightId = nightId || currentNightId;
  const night = nights.find((item) => item.id === activeNightId);
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === activeNightId), [sessions, activeNightId]);
  const nightMaintenances = useMemo(
    () => maintenances.filter((window) => window.nightId === activeNightId),
    [maintenances, activeNightId],
  );
  const maintenanceHits = useMemo(() => maintenanceHitsOfNight(activeNightId), [maintenanceHitsOfNight, activeNightId]);
  const conflicts = useMemo(() => conflictsOfNight(activeNightId), [conflictsOfNight, activeNightId]);
  const slots = useMemo(() => Array.from({ length: NIGHT_TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index), []);

  const [maintForm, setMaintForm] = useState<MaintenanceFormState>({ telescopeId: '', startTime: '21:00', endTime: '22:00', reason: '' });
  const [maintError, setMaintError] = useState('');
  const [maintSaved, setMaintSaved] = useState<MaintenanceSaveResult | null>(null);

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const telescopeById = (id: string) => telescopes.find((item) => item.id === id);
  const pairedInstrument = (telescopeCode: string) => instruments.find((instrument) => instrument.telescopeCode === telescopeCode);

  /** 某望远镜在某时段内的排程段 */
  const occupancy = (telescopeId: string, slot: number) => {
    const slotStart = slot * SLOT_MINUTES;
    const slotEnd = slotStart + SLOT_MINUTES;
    return nightSessions
      .filter((session) => session.telescopeId === telescopeId)
      .filter((session) => {
        const start = axisMinutes(session.startTime);
        const rawEnd = axisMinutes(session.endTime);
        const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
        return Math.min(end, slotEnd) - Math.max(start, slotStart) > 0;
      })
      .sort((a, b) => axisMinutes(a.startTime) - axisMinutes(b.startTime));
  };

  /** 某望远镜在某时段内覆盖的维护封锁 */
  const maintenanceAt = (telescopeId: string, slot: number) => {
    const slotStart = slot * SLOT_MINUTES;
    const slotEnd = slotStart + SLOT_MINUTES;
    return nightMaintenances
      .filter((window) => window.telescopeId === telescopeId)
      .filter((window) => {
        const start = axisMinutes(window.startTime);
        const rawEnd = axisMinutes(window.endTime);
        const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
        return Math.min(end, slotEnd) - Math.max(start, slotStart) > 0;
      });
  };

  /** 登记维护时段：保存后找出同夜撞上的排程，列出目标与重叠时间 */
  async function saveMaintenance() {
    const telescopeId = maintForm.telescopeId || telescopes[0]?.id || '';
    if (!telescopeId) {
      setMaintError('请选择要检修的望远镜');
      return;
    }
    if (durationMinutes(maintForm.startTime, maintForm.endTime) <= 0) {
      setMaintError('结束时刻必须晚于开始时刻');
      return;
    }
    if (!maintForm.reason.trim()) {
      setMaintError('请填写维护原因');
      return;
    }
    const created = await addMaintenance({
      nightId: activeNightId,
      telescopeId,
      startTime: maintForm.startTime,
      endTime: maintForm.endTime,
      reason: maintForm.reason,
    });
    const hits = nightSessions
      .filter((session) => session.telescopeId === created.telescopeId)
      .map((session) => ({ session, range: overlapRange(session.startTime, session.endTime, created.startTime, created.endTime) }))
      .filter((item): item is { session: ObsSession; range: OverlapRange } => item.range !== null);
    setMaintSaved({ window: created, hits });
    setMaintError('');
    setMaintForm((prev) => ({ ...prev, reason: '' }));
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        望远镜与终端分配视图
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        以行 = 设备、列 = 30 分钟时段的占用网格呈现；同一望远镜在同一时段排入多段即标红，点击格子可一键跳转到对应排程段。
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
        <TextField
          select
          size="small"
          label="观测夜"
          value={activeNightId}
          onChange={(event) => {
            setNightId(event.target.value);
            setCurrentNight(event.target.value);
          }}
          sx={{ minWidth: 240 }}
        >
          {nights.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {`${item.date} · ${item.siteName}${item.primary ? '（主夜）' : item.backup ? '（备用夜）' : ''}`}
            </MenuItem>
          ))}
        </TextField>
        <Chip size="small" label={night ? `月相 ${night.moonPhasePct}% · 云量 ${night.cloudText}` : '未选择观测夜'} />
        <ConflictBadge conflicts={conflicts} />
      </Stack>

      {conflicts.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          本夜存在 {conflicts.length} 处设备时段冲突，冲突格已在下方网格中标红：{' '}
          {conflicts.map((conflict) => `${conflict.sessionId}↔${conflict.otherId}（${conflict.overlapText}）`).join('；')}
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 2 }}>
          本夜各望远镜时段无重叠，无设备冲突
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          维护时段登记
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          登记本夜某台望远镜的停机检修时段与原因；保存后自动找出同夜撞上的排程，列出目标与重叠时间，并在下方网格中以橙色斜纹封锁。
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }} alignItems="center">
          <TextField
            select
            size="small"
            label="望远镜"
            value={maintForm.telescopeId || telescopes[0]?.id || ''}
            onChange={(event) => setMaintForm({ ...maintForm, telescopeId: event.target.value })}
            sx={{ minWidth: 200 }}
          >
            {telescopes.map((telescope) => (
              <MenuItem key={telescope.id} value={telescope.id}>
                {`${telescope.code} · ${telescope.apertureMm}mm · ${telescope.status}`}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="开始时刻"
            value={maintForm.startTime}
            onChange={(event) => setMaintForm({ ...maintForm, startTime: event.target.value })}
            placeholder="21:00"
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            label="结束时刻"
            value={maintForm.endTime}
            onChange={(event) => setMaintForm({ ...maintForm, endTime: event.target.value })}
            placeholder="22:00"
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            label="维护原因"
            value={maintForm.reason}
            onChange={(event) => setMaintForm({ ...maintForm, reason: event.target.value })}
            placeholder="例如：制冷相机真空泵巡检"
            sx={{ flexGrow: 1, minWidth: 240 }}
          />
          <Button variant="contained" color="warning" onClick={() => void saveMaintenance()}>
            保存维护时段
          </Button>
        </Stack>
        {maintError ? (
          <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setMaintError('')}>
            {maintError}
          </Alert>
        ) : null}
        {maintSaved ? (
          <Alert severity={maintSaved.hits.length > 0 ? 'warning' : 'success'} sx={{ mt: 1.5 }} onClose={() => setMaintSaved(null)}>
            <AlertTitle>
              已登记 {telescopeById(maintSaved.window.telescopeId)?.code ?? maintSaved.window.telescopeId} {maintSaved.window.startTime}-{maintSaved.window.endTime} 维护
            </AlertTitle>
            {maintSaved.hits.length > 0 ? (
              <>
                撞上本夜 {maintSaved.hits.length} 段排程：
                {maintSaved.hits
                  .map(
                    (hit) =>
                      `${targetById(hit.session.targetId)?.name ?? '未知目标'}（排程 ${hit.session.startTime}-${hit.session.endTime}，${hit.range.startText}-${hit.range.endText} 重叠 ${hit.range.minutes} 分钟）`,
                  )
                  .join('；')}
                。请调整排程或改期到备用观测夜。
              </>
            ) : (
              '该时段未与本夜任何排程重叠。'
            )}
          </Alert>
        ) : null}

        {nightMaintenances.length > 0 ? (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>望远镜</TableCell>
                <TableCell>维护时段</TableCell>
                <TableCell>原因</TableCell>
                <TableCell>撞上排程（目标 / 重叠时间）</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {nightMaintenances.map((window) => {
                const hits = maintenanceHits.filter((hit) => hit.maintenanceId === window.id);
                return (
                  <TableRow key={window.id} hover>
                    <TableCell>{telescopeById(window.telescopeId)?.code ?? window.telescopeId}</TableCell>
                    <TableCell>
                      {window.startTime}-{window.endTime}
                    </TableCell>
                    <TableCell>{window.reason}</TableCell>
                    <TableCell>
                      {hits.length > 0 ? (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap">
                          {hits.map((hit) => (
                            <Chip
                              key={hit.sessionId}
                              size="small"
                              color="warning"
                              variant="outlined"
                              label={`${targetById(hit.targetId)?.name ?? '未知目标'} · ${hit.overlapText}`}
                            />
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          未影响排程
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" color="error" onClick={() => void removeMaintenance(window.id)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            本夜尚未登记维护时段
          </Typography>
        )}
      </Paper>

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small" sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 210 }}>望远镜 / 终端 / 视场角</TableCell>
              {slots.map((slot) => (
                <TableCell key={slot} align="center" sx={{ px: 0.25 }}>
                  {minutesToTime(slot * SLOT_MINUTES)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {telescopes.map((telescope) => {
              const instrument = pairedInstrument(telescope.code);
              const fov = instrument ? fieldOfView(telescope.id, instrument.id) : undefined;
              return (
                <TableRow key={telescope.id}>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {telescope.code}
                        </Typography>
                        <Chip
                          size="small"
                          label={telescope.status}
                          color={telescope.status === '可用' ? 'success' : telescope.status === '维护中' ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {telescope.apertureMm}mm · f/{telescope.focalLengthMm}mm · {telescope.mount} · 载荷 {telescope.maxPayloadKg}kg
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {instrument ? `${instrument.model}（${instrument.terminalType}）` : '未配终端'}
                        {fov ? ` · 视场 ${fov.text}` : ''}
                      </Typography>
                    </Stack>
                  </TableCell>
                  {slots.map((slot) => {
                    const items = occupancy(telescope.id, slot);
                    const blocks = maintenanceAt(telescope.id, slot);
                    const isConflict = items.length > 1;
                    const blocked = blocks.length > 0 && items.length > 0;
                    const maintenanceOnly = blocks.length > 0 && items.length === 0;
                    const target = items[0] ? targetById(items[0].targetId) : undefined;
                    const blockTip = blocks.map((window) => `维护 ${window.startTime}-${window.endTime}：${window.reason}`).join(' ｜ ');
                    return (
                      <TableCell
                        key={slot}
                        align="center"
                        sx={{
                          px: 0.25,
                          py: 0.5,
                          bgcolor: isConflict
                            ? 'error.main'
                            : blocked
                              ? 'warning.main'
                              : items.length === 1
                                ? TARGET_COLOR[target?.type ?? '星云']
                                : 'transparent',
                          background: maintenanceOnly
                            ? 'repeating-linear-gradient(45deg, rgba(237,108,2,0.32) 0 6px, rgba(237,108,2,0.08) 6px 12px)'
                            : undefined,
                          color: items.length ? '#fff' : 'text.secondary',
                          cursor: items.length ? 'pointer' : 'default',
                          borderLeft: '1px solid',
                          borderColor: 'divider',
                        }}
                        onClick={() => {
                          if (items.length === 0) return;
                          navigate(`/sessions?highlight=${items[0].id}&night=${activeNightId}`);
                        }}
                      >
                        {maintenanceOnly ? (
                          <Tooltip title={blockTip}>
                            <Typography variant="caption" sx={{ color: 'warning.dark', fontWeight: 700 }}>
                              维护
                            </Typography>
                          </Tooltip>
                        ) : items.length === 0 ? (
                          <Typography variant="caption">·</Typography>
                        ) : isConflict ? (
                          <Tooltip title={items.map((item) => `${item.startTime}-${item.endTime} ${targetById(item.targetId)?.name ?? ''}`).join(' ｜ ')}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              冲突 {items.length}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Tooltip
                            title={`${items[0].startTime}-${items[0].endTime} ${target?.name ?? ''} · ${items[0].status}${blocked ? ` ｜ 撞上维护封锁：${blockTip}` : ''}`}
                          >
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                              {blocked ? `${target?.name ?? '已排'}⚠` : (target?.name ?? '已排')}
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 3 }}>
        图例：目标色 = 已排程；红色 = 设备冲突；橙色底 = 排程撞上维护封锁；橙色斜纹「维护」= 停机检修时段（不可排程）。
      </Typography>

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        终端清单与适配望远镜
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>型号</TableCell>
              <TableCell>类型</TableCell>
              <TableCell align="right">像元(μm)</TableCell>
              <TableCell>靶面(mm)</TableCell>
              <TableCell align="right">读出噪声(e-)</TableCell>
              <TableCell>适配望远镜</TableCell>
              <TableCell>视场角</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {instruments.map((instrument) => {
              const telescope = telescopes.find((item) => item.code === instrument.telescopeCode);
              const fov = telescope ? fieldOfView(telescope.id, instrument.id) : undefined;
              return (
                <TableRow key={instrument.id} hover>
                  <TableCell>{instrument.model}</TableCell>
                  <TableCell>{instrument.terminalType}</TableCell>
                  <TableCell align="right">{instrument.pixelSizeUm}</TableCell>
                  <TableCell>
                    {instrument.sensorWidthMm} × {instrument.sensorHeightMm}
                  </TableCell>
                  <TableCell align="right">{instrument.readNoiseE}</TableCell>
                  <TableCell>{telescope ? `${telescope.code}（${telescope.status}）` : '未适配'}</TableCell>
                  <TableCell>{fov?.text ?? '-'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => navigate('/sessions')}>
          前往排程段列表处理冲突
        </Button>
      </Box>
    </Box>
  );
}
