'use client';

import { Card, CardContent, Box, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

export function TradeCardSkeleton() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const skeletonBg = alpha(theme.palette.primary.main, isDark ? 0.1 : 0.05);

  return (
    <Card
      sx={{
        mb: 2,
        background: 'var(--surface-bg)',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--surface-border)',
        borderRadius: 3,
      }}
    >
      <CardContent>
        <Box
          display="flex"
          flexDirection={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'start' }}
          gap={{ xs: 1, sm: 0 }}
          mb={2}
        >
          <Box flex={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            <Skeleton variant="text" width="60%" height={32} sx={{ bgcolor: skeletonBg, mb: 1 }} />
            <Skeleton variant="text" width="40%" height={20} sx={{ bgcolor: alpha(skeletonBg, 0.6) }} />
          </Box>
          <Box display="flex" gap={1}>
            <Skeleton variant="rectangular" width={80} height={32} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
            <Skeleton variant="rectangular" width={80} height={32} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
          </Box>
        </Box>

        <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
          <Box>
            <Skeleton variant="text" width={60} height={16} sx={{ bgcolor: alpha(skeletonBg, 0.6), mb: 0.5 }} />
            <Skeleton variant="text" width={80} height={24} sx={{ bgcolor: skeletonBg }} />
          </Box>
          <Box>
            <Skeleton variant="text" width={60} height={16} sx={{ bgcolor: alpha(skeletonBg, 0.6), mb: 0.5 }} />
            <Skeleton variant="text" width={80} height={24} sx={{ bgcolor: skeletonBg }} />
          </Box>
          <Box>
            <Skeleton variant="text" width={60} height={16} sx={{ bgcolor: alpha(skeletonBg, 0.6), mb: 0.5 }} />
            <Skeleton variant="text" width={80} height={24} sx={{ bgcolor: skeletonBg }} />
          </Box>
          <Box>
            <Skeleton variant="text" width={60} height={16} sx={{ bgcolor: alpha(skeletonBg, 0.6), mb: 0.5 }} />
            <Skeleton variant="text" width={80} height={24} sx={{ bgcolor: skeletonBg }} />
          </Box>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Skeleton variant="rectangular" width={100} height={36} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
          <Skeleton variant="text" width={120} height={20} sx={{ bgcolor: alpha(skeletonBg, 0.6) }} />
        </Box>
      </CardContent>
    </Card>
  );
}
