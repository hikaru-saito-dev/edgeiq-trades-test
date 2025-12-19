'use client';

import { Box } from '@mui/material';
import LeaderboardTable from '@/components/LeaderboardTable';

export default function LeaderboardPage() {
  return (
    <Box sx={{ p: { xs: 1, md: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <LeaderboardTable />
    </Box>
  );
}

