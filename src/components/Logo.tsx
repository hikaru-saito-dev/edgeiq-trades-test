'use client';

import { Box } from '@mui/material';
import Image from 'next/image';
import Link from 'next/link';
import { useAccess } from './AccessProvider';
import { useState, useEffect } from 'react';

export default function Logo() {
  const { logoUrl } = useAccess();
  const [imageError, setImageError] = useState(false);
  const logoWidth = 160;

  // Use custom logo URL if provided, otherwise use default
  const logoSrc = logoUrl && logoUrl.trim() && !imageError ? logoUrl : '/logo.webp';

  // Reset error when logoUrl changes
  useEffect(() => {
    setImageError(false);
  }, [logoUrl]);

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
          alt="App Logo"
          width={logoWidth}
          height={logoWidth}
          style={{
            objectFit: 'contain',
            position: 'absolute',
            top: -80,
            left: 0,
          }}
          priority
          onError={() => {
            // If custom logo fails to load, fallback to default
            if (logoUrl && logoUrl.trim()) {
              setImageError(true);
            }
          }}
        />
      </Box>
    </Box>
  );
}

