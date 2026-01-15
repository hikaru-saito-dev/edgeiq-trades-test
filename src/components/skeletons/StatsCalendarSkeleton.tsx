'use client';

import { Box, Card, CardContent, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

export function StatsCalendarSkeleton() {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const skeletonBg = alpha(theme.palette.primary.main, isDark ? 0.1 : 0.05);

    return (
        <Card
            sx={{
                border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.12 : 0.1)}`,
                background: alpha(theme.palette.background.default, isDark ? 0.5 : 0.09),
                borderRadius: 1,
                boxShadow: 'none',
            }}
        >
            <CardContent>
                <Box
                    display="grid"
                    gridTemplateColumns={{
                        xs: 'repeat(2, minmax(0, 1fr))',
                        sm: 'repeat(4, minmax(0, 1fr))',
                        md: 'repeat(7, minmax(0, 1fr))',
                    }}
                    gap={1}
                >
                    {/* Day headers */}
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                        <Box key={d} sx={{ display: { xs: 'none', md: 'block' } }}>
                            <Skeleton variant="text" width={40} height={20} sx={{ bgcolor: alpha(skeletonBg, 0.6), mx: 'auto' }} />
                        </Box>
                    ))}

                    {/* Calendar days */}
                    {[...Array(35)].map((_, i) => (
                        <Box
                            key={i}
                            sx={{
                                aspectRatio: '1',
                                p: 1,
                                borderRadius: 1,
                                border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.1 : 0.08)}`,
                            }}
                        >
                            <Skeleton variant="text" width={30} height={16} sx={{ bgcolor: alpha(skeletonBg, 0.6), mb: 0.5 }} />
                            <Skeleton variant="rectangular" width="100%" height={40} sx={{ borderRadius: 0.5, bgcolor: skeletonBg }} />
                        </Box>
                    ))}
                </Box>
            </CardContent>
        </Card>
    );
}
