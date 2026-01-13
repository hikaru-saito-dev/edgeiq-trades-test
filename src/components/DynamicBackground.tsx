'use client';

import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useBranding } from './BrandingProvider';

export function DynamicBackground({ children }: { children: React.ReactNode }) {
    const theme = useTheme();
    const { palette } = useBranding();
    const isDark = theme.palette.mode === 'dark';

    return (
        <Box
            sx={{
                minHeight: '100vh',
                background: isDark
                    ? palette.gradients.backgroundGradientDark
                    : palette.gradients.backgroundGradient,
                color: 'var(--app-text)',
                position: 'relative',
                overflow: 'hidden',
                transition: 'background 0.3s ease',
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'var(--background-overlay)',
                    zIndex: 0,
                },
            }}
        >
            {children}
        </Box>
    );
}
