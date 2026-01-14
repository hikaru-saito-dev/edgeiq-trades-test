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
    const { palette, brandColor } = useBranding();

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
            const isDark = mode === 'dark';

            // Extract RGB values from primary color for overlay generation
            const hexToRgb = (hex: string): [number, number, number] | null => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result
                    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
                    : null;
            };

            const primaryRgb = hexToRgb(palette.primary.main);

            // Get or create style element for dynamic CSS variables
            let styleElement = document.getElementById('dynamic-theme-variables') as HTMLStyleElement;
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = 'dynamic-theme-variables';
                document.head.appendChild(styleElement);
            }

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

            // Helper to clamp RGB channels
            const clampChannel = (value: number) => Math.max(0, Math.min(255, value));

            // Dark surface background:
            // Derived from the first dark gradient stop by adding the same RGB offsets
            // observed in the original project: (4, 32, 24) from base (2, 21, 11)
            const surfaceBgDarkRgb: [number, number, number] = [
                clampChannel(darkBg1Rgb[0] + 1),  // +1 => 3 -> 4
                clampChannel(darkBg1Rgb[1] + 12), // +12 => 20 -> 32
                clampChannel(darkBg1Rgb[2] + 15), // +15 => 9  -> 24
            ];

            // Dark overlay:
            // Line color and gradient stops are derived from darkBg1 using the same
            // RGB deltas as the original project so that, for the default brand color,
            // the exact values match betting-whop while still scaling with other colors.
            const overlayLineRgb: [number, number, number] = [
                clampChannel(darkBg1Rgb[0] + 9),  // +9  => 3 -> 12
                clampChannel(darkBg1Rgb[1] + 45), // +45 => 20 -> 65
                clampChannel(darkBg1Rgb[2] + 39), // +39 => 9  -> 48
            ];

            const overlayGradTopRgb: [number, number, number] = [
                clampChannel(darkBg1Rgb[0] + 0),  // +0  => 3 -> 3
                clampChannel(darkBg1Rgb[1] + 3),  // +3  => 20 -> 23
                clampChannel(darkBg1Rgb[2] + 7),  // +7  => 9  -> 16
            ];

            const overlayGradBottomRgb: [number, number, number] = [
                clampChannel(darkBg1Rgb[0] + 3),  // +3  => 3 -> 6
                clampChannel(darkBg1Rgb[1] + 24), // +24 => 20 -> 44
                clampChannel(darkBg1Rgb[2] + 23), // +23 => 9  -> 32
            ];

            const overlayDark = `repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(${overlayLineRgb[0]}, ${overlayLineRgb[1]}, ${overlayLineRgb[2]}, 0.45) 1px, rgba(${overlayLineRgb[0]}, ${overlayLineRgb[1]}, ${overlayLineRgb[2]}, 0.45) 2px), linear-gradient(180deg, rgba(${overlayGradTopRgb[0]}, ${overlayGradTopRgb[1]}, ${overlayGradTopRgb[2]}, 0.8) 0%, rgba(${overlayGradBottomRgb[0]}, ${overlayGradBottomRgb[1]}, ${overlayGradBottomRgb[2]}, 0.8) 100%)`;

            // Generate scroll track color (lightened version of primary for light mode, darkened for dark mode)
            const scrollTrackLight = primaryRgb
                ? `rgba(${Math.min(255, primaryRgb[0] + 200)}, ${Math.min(255, primaryRgb[1] + 200)}, ${Math.min(255, primaryRgb[2] + 200)}, 0.3)`
                : 'rgba(240, 253, 244, 0.3)';

            const scrollTrackDark = `rgba(${darkBgRgb[0]}, ${darkBgRgb[1]}, ${darkBgRgb[2]}, 0.65)`;

            // For dark mode, use light colors that work with any brand color
            // For light mode, use the palette text colors directly (they're already dark for contrast)
            const appTextColor = isDark
                ? (primaryRgb ? `rgb(${Math.min(255, primaryRgb[0] + 220)}, ${Math.min(255, primaryRgb[1] + 220)}, ${Math.min(255, primaryRgb[2] + 220)})` : '#E9FFF4')
                : palette.text.primary;
            const appTextSecondary = isDark
                ? (primaryRgb ? `rgb(${Math.min(255, primaryRgb[0] + 180)}, ${Math.min(255, primaryRgb[1] + 200)}, ${Math.min(255, primaryRgb[2] + 180)})` : '#B1FBD8')
                : palette.text.secondary;

            // For dark mode border, use a lightened version of the brand color
            const darkBorder = isDark
                ? (primaryRgb ? `rgba(${Math.min(255, primaryRgb[0] + 200)}, ${Math.min(255, primaryRgb[1] + 200)}, ${Math.min(255, primaryRgb[2] + 200)}, 0.15)` : 'rgba(233, 255, 244, 0.15)')
                : palette.borders.default;

            // Build CSS string with all variables - this will override globals.css
            const cssVars = `
                :root {
                    --app-bg: ${isDark ? darkBg : palette.gradients.backgroundGradient};
                    --app-text: ${appTextColor};
                    --text-secondary: ${appTextSecondary};
                    --text-muted: ${palette.text.muted};
                    --accent-strong: ${isDark ? palette.primary.light : palette.secondary.dark};
                    --surface-bg: ${isDark ? `rgba(${surfaceBgDarkRgb[0]}, ${surfaceBgDarkRgb[1]}, ${surfaceBgDarkRgb[2]}, 0.92)` : palette.backgrounds.surfaceBg};
                    --surface-border: ${darkBorder};
                    --scroll-track: ${isDark ? scrollTrackDark : scrollTrackLight};
                    --scroll-thumb-start: ${isDark ? palette.secondary.light : palette.primary.main};
                    --scroll-thumb-end: ${isDark ? palette.secondary.main : palette.secondary.dark};
                    --background-overlay: ${isDark ? overlayDark : overlayLight};
                }
                body[data-theme='${mode}'] {
                    --app-bg: ${isDark ? darkBg : palette.gradients.backgroundGradient};
                    --app-text: ${appTextColor};
                    --text-secondary: ${appTextSecondary};
                    --text-muted: ${palette.text.muted};
                    --accent-strong: ${isDark ? palette.primary.light : palette.secondary.dark};
                    --surface-bg: ${isDark ? `rgba(${surfaceBgDarkRgb[0]}, ${surfaceBgDarkRgb[1]}, ${surfaceBgDarkRgb[2]}, 0.92)` : palette.backgrounds.surfaceBg};
                    --surface-border: ${darkBorder};
                    --scroll-track: ${isDark ? scrollTrackDark : scrollTrackLight};
                    --scroll-thumb-start: ${isDark ? palette.secondary.light : palette.primary.main};
                    --scroll-thumb-end: ${isDark ? palette.secondary.main : palette.secondary.dark};
                    --background-overlay: ${isDark ? overlayDark : overlayLight};
                }
            `;

            styleElement.textContent = cssVars;
        }
    }, [palette, mode]);

    const theme = useMemo(() => createAppTheme(mode, palette), [mode, palette]);

    return (
        <MUIThemeProvider theme={theme} key={brandColor || 'default'}>
            <CssBaseline />
            <ToastProvider>{children}</ToastProvider>
        </MUIThemeProvider>
    );
}
