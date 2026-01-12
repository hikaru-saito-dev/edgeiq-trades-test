'use client';

import { Box, Typography } from '@mui/material';
import Image from 'next/image';
import Link from 'next/link';
import { useAccess } from './AccessProvider';


export default function Logo() {
  const { companyBranding } = useAccess();
  const logoWidth = 160;
  const logoUrl = companyBranding.logoUrl || '/logo.webp';
  const appTitle = companyBranding.appTitle || 'EdgeIQ Trades';

  return (
    <Box
      component={Link}
      href="/"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        textDecoration: 'none',
        '&:hover': {
          opacity: 0.9,
        },
      }}
    >
      {/* Logo Image */}
      <Box
        sx={{
          width: logoWidth,
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <Image
          src={logoUrl}
          alt={`${appTitle} Logo`}
          width={logoWidth}
          height={logoWidth}
          style={{
            objectFit: 'contain',
            position: 'absolute',
            top: -80,
            left: 0,
          }}
          priority
          onError={(e) => {
            // Fallback to default logo if custom logo fails to load
            if (logoUrl !== '/logo.webp') {
              (e.target as HTMLImageElement).src = '/logo.webp';
            }
          }}
        />
      </Box>
      {/* App Title (optional, can be shown next to logo) */}
      {companyBranding.logoUrl && (
        <Typography
          variant="h6"
          sx={{
            fontWeight: 700,
            color: 'inherit',
            display: { xs: 'none', sm: 'block' },
          }}
        >
          {appTitle}
        </Typography>
      )}
    </Box>
  );
}

