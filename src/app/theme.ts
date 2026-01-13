'use client';

import { PaletteMode, ThemeOptions, createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material';
import { type ColorPalette } from '@/utils/colorPalette';

const getDesignTokens = (mode: PaletteMode, palette: ColorPalette): ThemeOptions => {
    const isLight = mode === 'light';

    // Helper to extract RGB from hex for dark mode background
    const hexToRgb = (hex: string): [number, number, number] => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
            : [4, 32, 24]; // Default dark background
    };

    // Extract dark background color from gradient (first color)
    const darkBgMatch = palette.gradients.backgroundGradientDark.match(/#[0-9A-Fa-f]{6}/);
    const darkBg = darkBgMatch ? darkBgMatch[0] : '#02150B';
    const darkBgRgb = hexToRgb(darkBg);

    return {
        palette: {
            mode,
            primary: {
                main: palette.primary.main,
                light: palette.primary.light,
                dark: palette.primary.dark,
            },
            secondary: {
                main: palette.secondary.main,
                light: palette.secondary.light,
                dark: palette.secondary.dark,
            },
            background: {
                default: isLight ? palette.backgrounds.appBg : darkBg,
                paper: isLight ? palette.backgrounds.surfaceBg : `rgba(${darkBgRgb[0]}, ${darkBgRgb[1]}, ${darkBgRgb[2]}, 0.92)`,
            },
            text: {
                primary: isLight ? palette.text.primary : '#E9FFF4',
                secondary: isLight ? palette.text.secondary : '#9FE3C6',
                disabled: isLight ? palette.text.muted : 'rgba(233, 255, 244, 0.5)',
            },
            divider: isLight ? palette.borders.default : 'rgba(233, 255, 244, 0.15)',
        },
        typography: {
            fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
            h1: {
                fontSize: '3rem',
                fontWeight: 800,
                background: palette.gradients.primaryToSecondary,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
            },
            h2: {
                fontSize: '2rem',
                fontWeight: 700,
            },
            h3: {
                fontSize: '1.5rem',
                fontWeight: 600,
            },
        },
        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    body: {
                        backgroundColor: isLight ? palette.backgrounds.appBg : darkBg,
                        color: isLight ? palette.text.primary : '#E9FFF4',
                    },
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.background.paper,
                        backdropFilter: 'blur(20px)',
                        border: `1px solid ${palette.borders.default}`,
                        boxShadow: theme.palette.mode === 'light'
                            ? `0 12px 32px ${palette.shadows.light}`
                            : '0 12px 32px rgba(0, 0, 0, 0.45)',
                    }),
                },
            },
            MuiCard: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: theme.palette.background.paper,
                        backdropFilter: 'blur(20px)',
                        border: `1px solid ${palette.borders.default}`,
                        boxShadow: theme.palette.mode === 'light'
                            ? `0 12px 32px ${palette.shadows.light}`
                            : '0 12px 32px rgba(0, 0, 0, 0.45)',
                    }),
                },
            },
            MuiButton: {
                styleOverrides: {
                    root: {
                        textTransform: 'none',
                        fontWeight: 600,
                        borderRadius: 8,
                    },
                },
            },
            MuiOutlinedInput: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        backgroundColor: alpha(
                            theme.palette.mode === 'light'
                                ? theme.palette.common.white
                                : theme.palette.background.paper,
                            theme.palette.mode === 'light' ? 0.98 : 0.75
                        ),
                        borderRadius: 12,
                        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                        '& fieldset': {
                            borderColor: palette.borders.default,
                        },
                        '&:hover fieldset': {
                            borderColor: theme.palette.primary.main,
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: theme.palette.primary.main,
                            boxShadow: `0 0 0 2px ${palette.primary.alpha20}`,
                        },
                    }),
                    input: ({ theme }) => ({
                        color: theme.palette.text.primary,
                        '&::placeholder': {
                            color: alpha(theme.palette.text.secondary, 0.9),
                            opacity: 1,
                        },
                    }),
                },
            },
            MuiInputLabel: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        color: alpha(theme.palette.text.secondary, 0.85),
                        '&.Mui-focused': {
                            color: theme.palette.primary.main,
                        },
                    }),
                },
            },
            MuiFormHelperText: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        color: alpha(theme.palette.text.secondary, 0.9),
                    }),
                },
            },
        },
    };
};

export const createAppTheme = (mode: PaletteMode, palette: ColorPalette) => createTheme(getDesignTokens(mode, palette));
