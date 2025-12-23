'use client';

import { useEffect, useMemo, useState } from 'react';
import { PaletteMode, ThemeProvider as MUIThemeProvider, useMediaQuery } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { createAppTheme } from '@/app/theme';
import { ToastProvider } from './ToastProvider';

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check system preference (only on client)
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });

  // Initialize mode - start with 'light' to prevent hydration mismatch, then update on mount
  const [mode, setMode] = useState<PaletteMode>('light');
  const [mounted, setMounted] = useState(false);

  // On client mount, determine the correct theme
  useEffect(() => {
    setMounted(true);

    // Check localStorage first (user preference)
    const savedMode = localStorage.getItem('theme') as PaletteMode | null;
    if (savedMode === 'dark' || savedMode === 'light') {
      setMode(savedMode);
      document.body.dataset.theme = savedMode;
      return;
    }

    // Fallback to system preference (check media query directly to avoid dependency)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialMode = prefersDark ? 'dark' : 'light';
    setMode(initialMode);
    document.body.dataset.theme = initialMode;
    localStorage.setItem('theme', initialMode);
  }, []); // Only run once on mount

  // Update mode when system preference changes (but only if no manual preference is set)
  useEffect(() => {
    if (!mounted) return;

    const savedMode = localStorage.getItem('theme') as PaletteMode | null;
    // Only update if no manual preference is saved
    if (!savedMode) {
      const newMode = systemPrefersDark ? 'dark' : 'light';
      setMode(newMode);
      document.body.dataset.theme = newMode;
      localStorage.setItem('theme', newMode);
    }
  }, [systemPrefersDark, mounted]);

  // Sync theme to document body and localStorage whenever mode changes
  useEffect(() => {
    if (mounted && typeof document !== 'undefined') {
      document.body.dataset.theme = mode;
      localStorage.setItem('theme', mode);
    }
  }, [mode, mounted]);

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  // Prevent flash of wrong theme by not rendering until mounted
  if (!mounted) {
    return (
      <MUIThemeProvider theme={createAppTheme('light')}>
        <CssBaseline />
        <ToastProvider>{children}</ToastProvider>
      </MUIThemeProvider>
    );
  }

  return (
    <MUIThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>{children}</ToastProvider>
    </MUIThemeProvider>
  );
}

