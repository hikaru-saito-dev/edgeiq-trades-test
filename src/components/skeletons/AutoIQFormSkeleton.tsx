'use client';

import { Box, Paper, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

export function AutoIQFormSkeleton() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const skeletonBg = alpha(theme.palette.primary.main, isDark ? 0.1 : 0.05);

  return (
    <Paper
      sx={{
        p: 4,
        bgcolor: 'var(--surface-bg)',
        backdropFilter: 'blur(6px)',
        borderRadius: 2,
        border: '1px solid var(--surface-border)',
      }}
    >
      <Skeleton variant="text" width="40%" height={32} sx={{ bgcolor: skeletonBg, mb: 3 }} />

      {/* Radio group skeleton */}
      <Box mb={4}>
        <Skeleton variant="rectangular" width={200} height={40} sx={{ borderRadius: 1, bgcolor: skeletonBg, mb: 2 }} />
        <Box display="flex" flexDirection="column" gap={1.5}>
          <Box display="flex" alignItems="center" gap={1}>
            <Skeleton variant="circular" width={20} height={20} sx={{ bgcolor: skeletonBg }} />
            <Skeleton variant="text" width={150} height={24} sx={{ bgcolor: skeletonBg }} />
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <Skeleton variant="circular" width={20} height={20} sx={{ bgcolor: skeletonBg }} />
            <Skeleton variant="text" width={150} height={24} sx={{ bgcolor: skeletonBg }} />
          </Box>
        </Box>
      </Box>

      {/* Select skeleton */}
      <Box mb={4}>
        <Skeleton variant="text" width="30%" height={20} sx={{ bgcolor: alpha(skeletonBg, 0.6), mb: 1.5 }} />
        <Skeleton variant="rectangular" width="100%" height={56} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
      </Box>

      {/* Button skeleton */}
      <Box display="flex" justifyContent="flex-end" gap={2}>
        <Skeleton variant="rectangular" width={100} height={40} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
        <Skeleton variant="rectangular" width={120} height={40} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
      </Box>
    </Paper>
  );
}
