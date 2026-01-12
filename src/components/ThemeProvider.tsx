'use client';

import { useEffect, useMemo, useState } from 'react';
import { PaletteMode, ThemeProvider as MUIThemeProvider, useMediaQuery } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { createAppTheme } from '@/app/theme';
import { ToastProvider } from './ToastProvider';
import { useAccess } from './AccessProvider';

// Helper functions to generate colors from primary
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : null;
}

function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const amount = percent / 100;
  return `rgb(${Math.round(rgb.r + (255 - rgb.r) * amount)}, ${Math.round(rgb.g + (255 - rgb.g) * amount)}, ${Math.round(rgb.b + (255 - rgb.b) * amount)})`;
}

function darkenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const amount = percent / 100;
  return `rgb(${Math.round(rgb.r * (1 - amount))}, ${Math.round(rgb.g * (1 - amount))}, ${Math.round(rgb.b * (1 - amount))})`;
}

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

  // Get company branding for dynamic theme colors
  // Note: This will be null initially, but will update when AccessProvider loads
  const { companyBranding } = useAccess();

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

  // Helper functions to generate colors from primary (moved outside to avoid dependency issues)

  // Update ALL CSS variables when company branding changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      // Always update CSS variables, even if companyBranding is not loaded yet
      // This ensures the variables are set immediately
      const primary = (companyBranding?.primaryColor && /^#[0-9A-Fa-f]{6}$/.test(companyBranding.primaryColor))
        ? companyBranding.primaryColor
        : '#22c55e'; // Default green fallback

      const secondary = (companyBranding?.secondaryColor && /^#[0-9A-Fa-f]{6}$/.test(companyBranding.secondaryColor))
        ? companyBranding.secondaryColor
        : (mode === 'light' ? darkenColor(primary, 20) : lightenColor(primary, 15));


      const rgb = hexToRgb(primary);
      if (!rgb) return;

      const { r, g, b } = rgb;
      const isDark = mode === 'dark';

      // Background colors
      const bgR = isDark ? Math.max(0, Math.round(r * 0.1)) : Math.round(r);
      const bgG = isDark ? Math.max(0, Math.round(g * 0.1)) : Math.round(g);
      const bgB = isDark ? Math.max(0, Math.round(b * 0.1)) : Math.round(b);
      const appBg = isDark ? `rgb(${bgR}, ${bgG}, ${bgB})` : `rgba(${r}, ${g}, ${b}, 0.05)`;
      const paperBg = isDark ? `rgba(${bgR}, ${bgG}, ${bgB}, 0.92)` : 'rgba(255, 255, 255, 0.94)';

      // Text colors
      const textPrimary = isDark ? lightenColor(primary, 80) : darkenColor(primary, 60);
      const textSecondary = isDark ? lightenColor(primary, 50) : darkenColor(primary, 40);
      const textMuted = isDark ? lightenColor(primary, 30) : '#6b7280';

      // Accent colors
      const accentStrong = isDark ? lightenColor(primary, 20) : darkenColor(primary, 10);
      const scrollThumbStart = primary;
      const scrollThumbEnd = secondary;

      // Border colors
      const surfaceBorder = isDark
        ? `rgba(${Math.round(r * 0.9)}, ${Math.round(g * 0.9)}, ${Math.round(b * 0.9)}, 0.15)`
        : `rgba(${r}, ${g}, ${b}, 0.2)`;

      // Scroll track
      const scrollTrack = isDark
        ? `rgba(${bgR}, ${bgG}, ${bgB}, 0.65)`
        : `rgba(${r}, ${g}, ${b}, 0.1)`;

      // Background overlay
      const overlayR = isDark ? Math.max(0, Math.round(r * 0.3)) : Math.round(r * 0.8);
      const overlayG = isDark ? Math.max(0, Math.round(g * 0.3)) : Math.round(g * 0.9);
      const overlayB = isDark ? Math.max(0, Math.round(b * 0.3)) : Math.round(b * 0.9);

      const backgroundOverlay = isDark
        ? `repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.45) 1px, rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.45) 2px), linear-gradient(180deg, rgba(${bgR}, ${bgG}, ${bgB}, 0.8) 0%, rgba(${Math.round(bgR * 1.5)}, ${Math.round(bgG * 1.5)}, ${Math.round(bgB * 1.5)}, 0.8) 100%)`
        : `repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.35) 1px, rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.35) 2px), linear-gradient(180deg, rgba(${r}, ${g}, ${b}, 0.15) 0%, rgba(${Math.round(r * 0.9)}, ${Math.round(g * 0.95)}, ${Math.round(b * 0.9)}, 0.1) 100%)`;

      // Update all CSS custom properties
      document.documentElement.style.setProperty('--primary-color', primary);
      document.documentElement.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
      document.documentElement.style.setProperty('--app-bg', appBg);
      document.documentElement.style.setProperty('--app-text', textPrimary);
      document.documentElement.style.setProperty('--text-secondary', textSecondary);
      document.documentElement.style.setProperty('--text-muted', textMuted);
      document.documentElement.style.setProperty('--accent-strong', accentStrong);
      document.documentElement.style.setProperty('--surface-bg', paperBg);
      document.documentElement.style.setProperty('--surface-border', surfaceBorder);
      document.documentElement.style.setProperty('--scroll-track', scrollTrack);
      document.documentElement.style.setProperty('--scroll-thumb-start', scrollThumbStart);
      document.documentElement.style.setProperty('--scroll-thumb-end', scrollThumbEnd);
      document.documentElement.style.setProperty('--background-overlay', backgroundOverlay);
    }
  }, [companyBranding.primaryColor, companyBranding.secondaryColor, mode]);

  const theme = useMemo(() =>
    createAppTheme(mode, companyBranding.primaryColor, companyBranding.secondaryColor),
    [mode, companyBranding.primaryColor, companyBranding.secondaryColor]
  );

  return (
    <MUIThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>{children}</ToastProvider>
    </MUIThemeProvider>
  );
}

