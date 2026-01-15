'use client';

import { Box, Paper, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

export function UsersTableSkeleton() {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const skeletonBg = alpha(theme.palette.primary.main, isDark ? 0.1 : 0.05);

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 3, overflow: 'hidden', background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}>
            <Table>
                <TableHead>
                    <TableRow>
                        <TableCell>
                            <Skeleton variant="text" width={100} height={24} sx={{ bgcolor: skeletonBg }} />
                        </TableCell>
                        <TableCell>
                            <Skeleton variant="text" width={120} height={24} sx={{ bgcolor: skeletonBg }} />
                        </TableCell>
                        <TableCell>
                            <Skeleton variant="text" width={100} height={24} sx={{ bgcolor: skeletonBg }} />
                        </TableCell>
                        <TableCell>
                            <Skeleton variant="text" width={100} height={24} sx={{ bgcolor: skeletonBg }} />
                        </TableCell>
                        <TableCell>
                            <Skeleton variant="text" width={80} height={24} sx={{ bgcolor: skeletonBg }} />
                        </TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {[...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                            <TableCell>
                                <Box display="flex" alignItems="center" gap={1.5}>
                                    <Skeleton variant="circular" width={40} height={40} sx={{ bgcolor: skeletonBg }} />
                                    <Box>
                                        <Skeleton variant="text" width={120} height={20} sx={{ bgcolor: skeletonBg, mb: 0.5 }} />
                                        <Skeleton variant="text" width={80} height={16} sx={{ bgcolor: alpha(skeletonBg, 0.6) }} />
                                    </Box>
                                </Box>
                            </TableCell>
                            <TableCell>
                                <Skeleton variant="text" width={100} height={20} sx={{ bgcolor: skeletonBg }} />
                            </TableCell>
                            <TableCell>
                                <Skeleton variant="rectangular" width={100} height={28} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
                            </TableCell>
                            <TableCell>
                                <Skeleton variant="rectangular" width={120} height={32} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
                            </TableCell>
                            <TableCell>
                                <Box display="flex" gap={1}>
                                    <Skeleton variant="rectangular" width={60} height={32} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
                                    <Skeleton variant="rectangular" width={60} height={32} sx={{ borderRadius: 1, bgcolor: skeletonBg }} />
                                </Box>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
