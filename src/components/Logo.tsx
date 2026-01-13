'use client';

import { Box } from '@mui/material';
import Image from 'next/image';
import Link from 'next/link';
import { useBranding } from './BrandingProvider';

export default function Logo() {
  const { logoUrl } = useBranding();
  const logoWidth = 160;
  const logoSrc = logoUrl || '/logo.webp';
  const isExternalUrl = logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'));

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
          src={logoSrc}
          alt="Company Logo"
          width={logoWidth}
          height={logoWidth}
          style={
            logoUrl
              ? {
                width: 64,
                height: 64,
              }: {
                objectFit: 'contain',
                position: 'absolute',
                top: -80,
                left: 0,
              }
          }
          priority
          unoptimized={!!isExternalUrl} // Disable optimization for external URLs to avoid issues
        />
      </Box>
    </Box>
  );
}

