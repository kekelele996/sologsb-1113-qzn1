import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemText from '@mui/material/ListItemText';
import ListItem from '@mui/material/ListItem';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import type { MaintenanceHit } from '../../types';

export interface MaintenanceBadgeProps {
  hits: MaintenanceHit[];
  compact?: boolean;
}

/** 维护封锁提示徽标：排程段撞上设备维护时段时展示，点击展开明细 */
export default function MaintenanceBadge({ hits, compact = false }: MaintenanceBadgeProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  if (hits.length === 0) {
    return null;
  }

  return (
    <>
      <Chip
        label={compact ? `维护 ${hits.length}` : `维护封锁 ${hits.length} 处`}
        size="small"
        color="warning"
        onClick={(event) => setAnchorEl(event.currentTarget)}
      />
      <Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={() => setAnchorEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: 1.5, maxWidth: 380 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            维护封锁明细（与设备维护时段重叠）
          </Typography>
          <List dense disablePadding>
            {hits.map((hit) => (
              <ListItem key={`${hit.windowId}-${hit.sessionId}`} disableGutters>
                <ListItemText
                  primary={`维护 ${hit.windowStart}-${hit.windowEnd}｜${hit.reason}`}
                  secondary={`望远镜 ${hit.telescopeId} · ${hit.overlapText}`}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      </Popover>
    </>
  );
}
