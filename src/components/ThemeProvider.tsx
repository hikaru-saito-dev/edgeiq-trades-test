'use client';

import { useEffect, useMemo, useState } from 'react';
import { PaletteMode, ThemeProvider as MUIThemeProvider, useMediaQuery } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { createAppTheme } from '@/app/theme';
import { ToastProvider } from './ToastProvider';
import { useBranding } from './BrandingProvider';

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
    const { palette } = useBranding();

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

    // Update CSS variables dynamically based on palette
    useEffect(() => {
        if (typeof document !== 'undefined') {
            const root = document.documentElement;
            const isDark = mode === 'dark';

            // Extract RGB values from primary color for overlay generation
            const hexToRgb = (hex: string): [number, number, number] | null => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result
                    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
                    : null;
            };

            const primaryRgb = hexToRgb(palette.primary.main);

            // Generate background overlay pattern dynamically
            // Extract RGB from palette's overlay color (already calculated from brand color)
            const overlayRgbMatch = palette.backgrounds.overlay.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
            const overlayRgb = overlayRgbMatch
                ? [parseInt(overlayRgbMatch[1]), parseInt(overlayRgbMatch[2]), parseInt(overlayRgbMatch[3])]
                : primaryRgb || [200, 230, 201];

            // Light mode: repeating lines + gradient overlay
            // Pattern: repeating lines use overlay color, gradient uses lightened version
            const lightGrad1 = primaryRgb
                ? `rgba(${Math.min(255, primaryRgb[0] + 200)}, ${Math.min(255, primaryRgb[1] + 200)}, ${Math.min(255, primaryRgb[2] + 200)}, 0.6)`
                : 'rgba(240, 253, 244, 0.6)';
            const lightGrad2 = primaryRgb
                ? `rgba(${Math.min(255, primaryRgb[0] + 180)}, ${Math.min(255, primaryRgb[1] + 180)}, ${Math.min(255, primaryRgb[2] + 180)}, 0.4)`
                : 'rgba(220, 252, 231, 0.4)';

            const overlayLight = `repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(${overlayRgb[0]}, ${overlayRgb[1]}, ${overlayRgb[2]}, 0.35) 1px, rgba(${overlayRgb[0]}, ${overlayRgb[1]}, ${overlayRgb[2]}, 0.35) 2px), linear-gradient(180deg, ${lightGrad1} 0%, ${lightGrad2} 100%)`;

            // Extract first color from gradient for dark mode background (needed for overlay generation)
            const darkBgMatch = palette.gradients.backgroundGradientDark.match(/#[0-9A-Fa-f]{6}/);
            const darkBg = darkBgMatch ? darkBgMatch[0] : '#02150B';
            const darkBgRgb = hexToRgb(darkBg) || [4, 32, 24];

            // Dark mode: darker repeating lines + darker gradient overlay
            // Extract all colors from dark gradient
            const darkBgMatches = palette.gradients.backgroundGradientDark.match(/#[0-9A-Fa-f]{6}/g) || [];
            const darkBg1Hex = darkBgMatches[0] || darkBg;
            const darkBg3Hex = darkBgMatches[2] || '#1a3a2a';

            const darkBg1Rgb = hexToRgb(darkBg1Hex) || [4, 32, 24];
            const darkBg3Rgb = hexToRgb(darkBg3Hex) || [26, 58, 42];

            // Dark overlay: slightly lighter than darkBg1 for lines, use darkBg1 and darkBg3 for gradient
            const overlayDark = `repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(${Math.min(255, darkBg1Rgb[0] + 8)}, ${Math.min(255, darkBg1Rgb[1] + 17)}, ${Math.min(255, darkBg1Rgb[2] + 16)}, 0.45) 1px, rgba(${Math.min(255, darkBg1Rgb[0] + 8)}, ${Math.min(255, darkBg1Rgb[1] + 17)}, ${Math.min(255, darkBg1Rgb[2] + 16)}, 0.45) 2px), linear-gradient(180deg, rgba(${darkBg1Rgb[0]}, ${darkBg1Rgb[1]}, ${darkBg1Rgb[2]}, 0.8) 0%, rgba(${darkBg3Rgb[0]}, ${darkBg3Rgb[1]}, ${darkBg3Rgb[2]}, 0.8) 100%)`;

            // Generate scroll track color (lightened version of primary for light mode, darkened for dark mode)
            const scrollTrackLight = primaryRgb
                ? `rgba(${Math.min(255, primaryRgb[0] + 200)}, ${Math.min(255, primaryRgb[1] + 200)}, ${Math.min(255, primaryRgb[2] + 200)}, 0.3)`
                : 'rgba(240, 253, 244, 0.3)';

            const scrollTrackDark = `rgba(${darkBgRgb[0]}, ${darkBgRgb[1]}, ${darkBgRgb[2]}, 0.65)`;

            root.style.setProperty('--app-bg', isDark ? darkBg : palette.gradients.backgroundGradient);
            root.style.setProperty('--app-text', isDark ? '#E9FFF4' : palette.text.primary);
            root.style.setProperty('--text-secondary', isDark ? '#B1FBD8' : palette.text.secondary);
            root.style.setProperty('--text-muted', palette.text.muted);
            root.style.setProperty('--accent-strong', isDark ? palette.primary.light : palette.secondary.dark);
            root.style.setProperty('--surface-bg', isDark ? `rgba(${hexToRgb(darkBg)?.join(', ') || '4, 32, 24'}, 0.92)` : palette.backgrounds.surfaceBg);
            root.style.setProperty('--surface-border', isDark ? 'rgba(233, 255, 244, 0.15)' : palette.borders.default);
            root.style.setProperty('--scroll-track', isDark ? scrollTrackDark : scrollTrackLight);
            root.style.setProperty('--scroll-thumb-start', isDark ? palette.secondary.light : palette.primary.main);
            root.style.setProperty('--scroll-thumb-end', isDark ? palette.secondary.main : palette.secondary.dark);
            root.style.setProperty('--background-overlay', isDark ? overlayDark : overlayLight);
        }
    }, [palette, mode]);

    const theme = useMemo(() => createAppTheme(mode, palette), [mode, palette]);

    return (
        <MUIThemeProvider theme={theme}>
            <CssBaseline />
            <ToastProvider>{children}</ToastProvider>
        </MUIThemeProvider>
    );
}
