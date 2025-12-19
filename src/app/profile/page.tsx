'use client';

import { Box } from '@mui/material';
import ProfileForm from '@/components/ProfileForm';

export default function ProfilePage() {
  return (
    <Box sx={{ p: { xs: 1, md: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <ProfileForm />
    </Box>
  );
}

