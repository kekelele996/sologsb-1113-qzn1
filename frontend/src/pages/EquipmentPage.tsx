import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
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
import { useMaintenanceCheck } from '../hooks/useMaintenanceCheck';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { NIGHT_TOTAL_MINUTES, TARGET_COLOR, type MaintenanceHit, type MaintenanceWindow } from '../types';
import { axisMinutes, axisRangeOf, durationMinutes, minutesToTime } from '../utils/astro';

const SLOT_MINUTES = 30;

/** 望远镜与终端分配视图：行 = 设备、列 = 30 分钟时段，冲突格标红并可一键跳转；支持登记设备维护时段 */
export default function EquipmentPage() {
  usePersistentStore();
  const navigate = useNavigate();
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const fieldOfView = useEquipmentStore((s) => s.fieldOfView);
  const sessions = useSessionStore((s) => s.sessions);
  const nights = useNightStore((s) => s.nights);
  const currentNightId = useNightStore((s) => s.currentNightId);
  const setCurrentNight = useNightStore((s) => s.setCurrentNight);
  const targets = useTargetStore((s) => s.targets);
  const addWindow = useMaintenanceStore((s) => s.addWindow);
  const removeWindow = useMaintenanceStore((s) => s.removeWindow);
  const { conflictsOfNight } = useConflictCheck();
  const { windowsOf, sessionsHitBy, hitsOfNight } = useMaintenanceCheck();

  const [nightId, setNightId] = useState(currentNightId);
  const activeNightId = nightId || currentNightId;
  const night = nights.find((item) => item.id === activeNightId);
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === activeNightId), [sessions, activeNightId]);
  const conflicts = useMemo(() => conflictsOfNight(activeNightId), [conflictsOfNight, activeNightId]);
  const nightWindows = useMemo(() => windowsOf(activeNightId), [windowsOf, activeNightId]);
  const maintenanceHits = useMemo(() => hitsOfNight(activeNightId), [hitsOfNight, activeNightId]);
  const slots = useMemo(() => Array.from({ length: NIGHT_TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index), []);

  /** 维护登记表单与保存结果 */
  const [mntForm, setMntForm] = useState({ telescopeId: '', startTime: '21:00', endTime: '22:00', reason: '' });
  const [mntError, setMntError] = useState('');
  const [mntResult, setMntResult] = useState<{ window: MaintenanceWindow; hits: MaintenanceHit[] } | null>(null);

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const telescopeById = (id: string) => telescopes.find((item) => item.id === id);
  const sessionById = (id: string) => sessions.find((session) => session.id === id);
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

  /** 某望远镜在某时段内覆盖的维护窗口 */
  const maintenanceAt = (telescopeId: string, slot: number) => {
    const slotStart = slot * SLOT_MINUTES;
    const slotEnd = slotStart + SLOT_MINUTES;
    return nightWindows.find((window) => {
      if (window.telescopeId !== telescopeId) return false;
      const range = axisRangeOf(window.startTime, window.endTime);
      return Math.min(range.end, slotEnd) - Math.max(range.start, slotStart) > 0;
    });
  };

  /** 登记维护时段：保存后立即找出同夜撞上的排程段 */
  async function saveWindow() {
    const telescopeId = mntForm.telescopeId || telescopes[0]?.id || '';
    if (!telescopeId) {
      setMntError('请选择望远镜');
      return;
    }
    if (durationMinutes(mntForm.startTime, mntForm.endTime) <= 0) {
      setMntError('结束时刻必须晚于开始时刻');
      return;
    }
    if (!mntForm.reason.trim()) {
      setMntError('请填写维护原因');
      return;
    }
    const window = await addWindow({
      nightId: activeNightId,
      telescopeId,
      startTime: mntForm.startTime,
      endTime: mntForm.endTime,
      reason: mntForm.reason,
    });
    setMntResult({ window, hits: sessionsHitBy(window) });
    setMntError('');
    setMntForm((prev) => ({ ...prev, reason: '' }));
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        望远镜与终端分配视图
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        以行 = 设备、列 = 30 分钟时段的占用网格呈现；同一望远镜在同一时段排入多段即标红，点击格子可一键跳转到对应排程段。夜间临时检修可在此登记维护时段，维护格以橙色斜纹标出，撞上维护的排程格标橙。
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
            setMntResult(null);
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

      {maintenanceHits.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          本夜设备维护时段撞上 {maintenanceHits.length} 处排程：{' '}
          {maintenanceHits
            .map((hit) => {
              const session = sessionById(hit.sessionId);
              return `${telescopeById(hit.telescopeId)?.code ?? hit.telescopeId} 维护 ${hit.windowStart}-${hit.windowEnd}（${hit.reason}）↔ ${
                targetById(session?.targetId ?? '')?.name ?? hit.sessionId
              }（${hit.overlapText}）`;
            })
            .join('；')}
        </Alert>
      ) : null}

      {mntResult ? (
        <Alert severity={mntResult.hits.length > 0 ? 'warning' : 'success'} sx={{ mb: 2 }} onClose={() => setMntResult(null)}>
          已登记 {telescopeById(mntResult.window.telescopeId)?.code ?? mntResult.window.telescopeId} 维护时段 {mntResult.window.startTime}-
          {mntResult.window.endTime}（{night?.date ?? ''}）。
          {mntResult.hits.length > 0
            ? `同夜撞上 ${mntResult.hits.length} 段排程：${mntResult.hits
                .map((hit) => {
                  const session = sessionById(hit.sessionId);
                  return `${targetById(session?.targetId ?? '')?.name ?? hit.sessionId}（${hit.overlapText}）`;
                })
                .join('；')}`
            : '同夜无排程与该维护时段相撞。'}
        </Alert>
      ) : null}

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
                    const isConflict = items.length > 1;
                    const maint = maintenanceAt(telescope.id, slot);
                    const isBlocked = Boolean(maint) && items.length === 1;
                    const target = items[0] ? targetById(items[0].targetId) : undefined;
                    return (
                      <TableCell
                        key={slot}
                        align="center"
                        sx={{
                          px: 0.25,
                          py: 0.5,
                          bgcolor: isConflict
                            ? 'error.main'
                            : isBlocked
                              ? 'warning.main'
                              : items.length === 1
                                ? TARGET_COLOR[target?.type ?? '星云']
                                : 'transparent',
                          background:
                            maint && items.length === 0
                              ? 'repeating-linear-gradient(45deg, rgba(237,108,2,0.28) 0 6px, rgba(237,108,2,0.08) 6px 12px)'
                              : undefined,
                          color: items.length ? '#fff' : maint ? 'warning.dark' : 'text.secondary',
                          cursor: items.length ? 'pointer' : 'default',
                          borderLeft: '1px solid',
                          borderColor: 'divider',
                        }}
                        onClick={() => {
                          if (items.length === 0) return;
                          navigate(`/sessions?highlight=${items[0].id}&night=${activeNightId}`);
                        }}
                      >
                        {items.length === 0 ? (
                          maint ? (
                            <Tooltip title={`维护时段 ${maint.startTime}-${maint.endTime}｜${maint.reason}`}>
                              <Typography variant="caption" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                                维护
                              </Typography>
                            </Tooltip>
                          ) : (
                            <Typography variant="caption">·</Typography>
                          )
                        ) : isConflict ? (
                          <Tooltip title={items.map((item) => `${item.startTime}-${item.endTime} ${targetById(item.targetId)?.name ?? ''}`).join(' ｜ ')}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              冲突 {items.length}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Tooltip
                            title={`${items[0].startTime}-${items[0].endTime} ${target?.name ?? ''} · ${items[0].status}${
                              maint ? `｜撞上维护时段 ${maint.startTime}-${maint.endTime}（${maint.reason}）` : ''
                            }`}
                          >
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                              {target?.name ?? '已排'}
                              {isBlocked ? '·维护' : ''}
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

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        设备维护时段登记（{night?.date ?? '未选择观测夜'}）
      </Typography>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }} alignItems="center">
          <TextField
            select
            size="small"
            label="望远镜"
            value={mntForm.telescopeId || telescopes[0]?.id || ''}
            onChange={(event) => setMntForm({ ...mntForm, telescopeId: event.target.value })}
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
            value={mntForm.startTime}
            onChange={(event) => setMntForm({ ...mntForm, startTime: event.target.value })}
            placeholder="21:00"
            sx={{ width: 110 }}
          />
          <TextField
            size="small"
            label="结束时刻"
            value={mntForm.endTime}
            onChange={(event) => setMntForm({ ...mntForm, endTime: event.target.value })}
            placeholder="22:30"
            sx={{ width: 110 }}
          />
          <TextField
            size="small"
            label="维护原因"
            value={mntForm.reason}
            onChange={(event) => setMntForm({ ...mntForm, reason: event.target.value })}
            placeholder="如：主镜散热风扇更换"
            sx={{ minWidth: 260, flexGrow: 1 }}
          />
          <Button variant="contained" color="warning" onClick={() => void saveWindow()}>
            登记维护时段
          </Button>
        </Stack>
        {mntError ? (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            {mntError}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            时刻格式 HH:mm，可跨零点；保存后自动检测同夜撞上的排程段并列出目标与重叠时间
          </Typography>
        )}
      </Paper>

      {nightWindows.length > 0 ? (
        <Stack spacing={1} sx={{ mb: 3 }}>
          {nightWindows.map((window) => {
            const hits = sessionsHitBy(window);
            return (
              <Paper key={window.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Chip size="small" color="warning" variant="outlined" label={`${window.startTime}-${window.endTime}`} />
                  <Chip size="small" variant="outlined" label={telescopeById(window.telescopeId)?.code ?? window.telescopeId} />
                  <Typography variant="body2">{window.reason}</Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <Button size="small" color="error" onClick={() => void removeWindow(window.id)}>
                    删除
                  </Button>
                </Stack>
                {hits.length > 0 ? (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    撞上 {hits.length} 段排程：
                    {hits
                      .map((hit) => {
                        const session = sessionById(hit.sessionId);
                        return `${targetById(session?.targetId ?? '')?.name ?? hit.sessionId}（${hit.overlapText}）`;
                      })
                      .join('；')}
                  </Alert>
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    未影响本夜任何排程段
                  </Typography>
                )}
              </Paper>
            );
          })}
        </Stack>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          本夜暂无设备维护时段登记
        </Alert>
      )}

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
