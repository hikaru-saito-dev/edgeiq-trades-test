'use client';

import { useEffect, useMemo, useState } from 'react';
import { PaletteMode, ThemeProvider as MUIThemeProvider, useMediaQuery } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { createAppTheme } from '@/app/theme';
import { ToastProvider } from './ToastProvider';

function getInitialTheme(): PaletteMode {
    if (typeof window === 'undefined') {
        return 'light'; // SSR default
    }

    // Read from the data attribute set by the blocking script in layout.tsx
    // This prevents flash of wrong theme
    const htmlTheme = document.documentElement.getAttribute('data-theme');
    if (htmlTheme === 'dark' || htmlTheme === 'light') {
        return htmlTheme;
    }

    // Fallback: system preference
    if (window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    return 'light';
}

export default function ThemeProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    // Initialize with the theme from the blocking script (prevents flash)
    const [mode, setMode] = useState<PaletteMode>(getInitialTheme);
    const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });

    // Sync with system preference (no localStorage)
    useEffect(() => {
        setMode(systemPrefersDark ? 'dark' : 'light');
    }, [systemPrefersDark]);

    // Update body and html data attributes when mode changes
    useEffect(() => {
        if (typeof document !== 'undefined') {
            document.body.dataset.theme = mode;
            document.documentElement.setAttribute('data-theme', mode);
        }
    }, [mode]);

    const theme = useMemo(() => createAppTheme(mode), [mode]);

    return (
        <MUIThemeProvider theme={theme}>
            <CssBaseline />
            <ToastProvider>{children}</ToastProvider>
        </MUIThemeProvider>
    );
}
