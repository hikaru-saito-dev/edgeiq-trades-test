'use client';

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react';
import { useTheme } from '@mui/material/styles';
import { generateColorPalette, generateColorPaletteForMode, type ColorPalette } from '@/utils/colorUtils';
import { apiRequest } from '@/lib/apiClient';

interface CompanyThemeContextValue {
    appTitle: string;
    themePrimaryColor: string;
    themeGradientDirection: number;
    themeColorIntensity: number;
    palette: ColorPalette;
    paletteLight: ColorPalette;
    paletteDark: ColorPalette;
    isCustomized: boolean;
    loading: boolean;
}

const CompanyThemeContext = createContext<CompanyThemeContextValue | undefined>(undefined);

export function useCompanyTheme() {
    const context = useContext(CompanyThemeContext);
    if (!context) {
        // Return default values if context is not available
        const defaultPalette = generateColorPalette();
        return {
            appTitle: 'EdgeIQ Trades',
            themePrimaryColor: '#22c55e',
            themeGradientDirection: 135,
            themeColorIntensity: 60,
            palette: defaultPalette,
            paletteLight: defaultPalette,
            paletteDark: generateColorPaletteForMode(null, null, 135, 60, true),
            isCustomized: false,
            loading: false,
        };
    }
    return context;
}

interface CompanyThemeProviderProps {
    children: ReactNode;
}

export function CompanyThemeProvider({ children }: CompanyThemeProviderProps) {
    const [themeData, setThemeData] = useState<{
        appTitle?: string | null;
        themePrimaryColor?: string | null;
        themeGradientDirection?: number;
        themeColorIntensity?: number;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const muiTheme = useTheme();
    const isDark = muiTheme.palette.mode === 'dark';

    // Fetch theme data from API
    useEffect(() => {
        async function fetchThemeData() {
            try {
                const response = await apiRequest('/api/user', { method: 'GET' });
                if (response.ok) {
                    const data = await response.json();
                    setThemeData({
                        appTitle: data.user?.appTitle || null,
                        themePrimaryColor: data.user?.themePrimaryColor || null,
                        themeGradientDirection: data.user?.themeGradientDirection ?? 135,
                        themeColorIntensity: data.user?.themeColorIntensity ?? 60,
                    });
                }
            } catch (error) {
                console.error('Error fetching theme data:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchThemeData();
    }, []);

    // Generate palettes
    const { palette, paletteLight, paletteDark, isCustomized } = useMemo(() => {
        const primary = themeData?.themePrimaryColor || null;
        const secondary = null; // We generate secondary from primary
        const direction = themeData?.themeGradientDirection ?? 135;
        const intensity = themeData?.themeColorIntensity ?? 60;

        const lightPalette = generateColorPaletteForMode(primary, secondary, direction, intensity, false);
        const darkPalette = generateColorPaletteForMode(primary, secondary, direction, intensity, true);
        const currentPalette = isDark ? darkPalette : lightPalette;

        const customized = Boolean(primary || themeData?.appTitle);

        return {
            palette: currentPalette,
            paletteLight: lightPalette,
            paletteDark: darkPalette,
            isCustomized: customized,
        };
    }, [themeData, isDark]);

    // Inject CSS variables
    useEffect(() => {
        const currentPalette = isDark ? paletteDark : paletteLight;

        const root = document.documentElement;
        const body = document.body;

        // Set CSS variables for light mode (or base)
        root.style.setProperty('--app-bg', currentPalette.backgrounds.appBg);
        root.style.setProperty('--app-text', currentPalette.text.primary);
        root.style.setProperty('--text-secondary', currentPalette.text.secondary);
        root.style.setProperty('--text-muted', currentPalette.text.muted);
        root.style.setProperty('--accent-strong', currentPalette.primary.main);
        root.style.setProperty('--surface-bg', currentPalette.backgrounds.surfaceBg);
        root.style.setProperty('--surface-border', currentPalette.borders.default);
        root.style.setProperty('--scroll-thumb-start', currentPalette.primary.main);
        root.style.setProperty('--scroll-thumb-end', currentPalette.secondary.dark);

        // Update background overlay gradient
        const overlayGradient = isDark
            ? `repeating-linear-gradient(0deg, transparent, transparent 1px, ${currentPalette.backgrounds.overlay} 1px, ${currentPalette.backgrounds.overlay} 2px), ${currentPalette.gradients.backgroundGradientDark}`
            : `repeating-linear-gradient(0deg, transparent, transparent 1px, ${currentPalette.backgrounds.overlay} 1px, ${currentPalette.backgrounds.overlay} 2px), ${currentPalette.gradients.backgroundGradient}`;

        root.style.setProperty('--background-overlay', overlayGradient);

        // Update scroll track
        const scrollTrack = isDark
            ? currentPalette.primary.alpha10
            : currentPalette.primary.alpha10;
        root.style.setProperty('--scroll-track', scrollTrack);
    }, [paletteLight, paletteDark, isDark]);

    const contextValue: CompanyThemeContextValue = {
        appTitle: themeData?.appTitle || 'EdgeIQ Trades',
        themePrimaryColor: themeData?.themePrimaryColor || '#22c55e',
        themeGradientDirection: themeData?.themeGradientDirection ?? 135,
        themeColorIntensity: themeData?.themeColorIntensity ?? 60,
        palette,
        paletteLight,
        paletteDark,
        isCustomized,
        loading,
    };

    return (
        <CompanyThemeContext.Provider value={contextValue}>
            {children}
        </CompanyThemeContext.Provider>
    );
}
