'use client';

import { useEffect, useMemo, useState } from 'react';
import { PaletteMode, ThemeProvider as MUIThemeProvider, useMediaQuery } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { createAppTheme } from '@/app/theme';
import { ToastProvider } from './ToastProvider';
import { CompanyThemeProvider, useCompanyTheme } from './CompanyThemeProvider';

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

// Inner component that can use CompanyThemeProvider context
function ThemedContent({ children }: { children: React.ReactNode }) {
    const companyTheme = useCompanyTheme();
    const [mode, setMode] = useState<PaletteMode>(getInitialTheme());
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

    const theme = useMemo(() => {
        const currentPalette = mode === 'dark' ? companyTheme.paletteDark : companyTheme.paletteLight;
        return createAppTheme(mode, currentPalette);
    }, [mode, companyTheme.paletteLight, companyTheme.paletteDark]);

    return (
        <MUIThemeProvider theme={theme}>
            <CssBaseline />
            <ToastProvider>{children}</ToastProvider>
        </MUIThemeProvider>
    );
}

export default function ThemeProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <CompanyThemeProvider>
            <ThemedContent>{children}</ThemedContent>
        </CompanyThemeProvider>
    );
}
