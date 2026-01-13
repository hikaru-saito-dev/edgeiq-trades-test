'use client';

import { PaletteMode, ThemeOptions, createTheme } from '@mui/material/styles';
import { alpha as muiAlpha } from '@mui/material';
import type { ColorPalette } from '@/lib/colorUtils';

const DEFAULT_COLOR_PALETTE: ColorPalette = {
  primary: {
    main: '#22c55e',
    light: '#4ade80',
    dark: '#16a34a',
    alpha10: 'rgba(34, 197, 94, 0.1)',
    alpha20: 'rgba(34, 197, 94, 0.2)',
    alpha30: 'rgba(34, 197, 94, 0.3)',
    alpha40: 'rgba(34, 197, 94, 0.4)',
    alpha50: 'rgba(34, 197, 94, 0.5)',
  },
  secondary: {
    main: '#10b981',
    light: '#34d399',
    dark: '#059669',
    alpha10: 'rgba(16, 185, 129, 0.1)',
    alpha20: 'rgba(16, 185, 129, 0.2)',
    alpha30: 'rgba(16, 185, 129, 0.3)',
    alpha40: 'rgba(16, 185, 129, 0.4)',
    alpha50: 'rgba(16, 185, 129, 0.5)',
  },
  gradients: {
    primaryToSecondary: 'linear-gradient(135deg, #22c55e 0%, #059669 100%)',
    buttonGradient: 'linear-gradient(135deg, #22c55e 0%, #059669 100%)',
    headerGradient: 'linear-gradient(180deg, #02150B 0%, #063021 100%)',
    headerGradientLight: 'linear-gradient(180deg, #1e3a2a 0%, #2D503D 100%)',
    backgroundGradient: 'linear-gradient(180deg, #f5fdf8 0%, #d9fbe9 50%, #a7f3d0 100%)',
    backgroundGradientDark: 'linear-gradient(180deg, #02150B 0%, #0a1f0f 50%, #1a3a2a 100%)',
  },
  backgrounds: {
    appBg: '#f5fdf8',
    surfaceBg: 'rgba(255, 255, 255, 0.94)',
    overlay: 'rgba(200, 230, 201, 0.35)',
  },
  text: {
    primary: '#064e3b',
    secondary: '#166534',
    muted: '#6b7280',
  },
  borders: {
    default: 'rgba(34, 197, 94, 0.2)',
    accent: 'rgba(34, 197, 94, 0.3)',
  },
  shadows: {
    light: 'rgba(34, 197, 94, 0.08)',
    medium: 'rgba(34, 197, 94, 0.2)',
    strong: 'rgba(34, 197, 94, 0.4)',
  },
};

const getDesignTokens = (mode: PaletteMode, colorPalette?: ColorPalette): ThemeOptions => {
  const isLight = mode === 'light';
  const palette = colorPalette || DEFAULT_COLOR_PALETTE;

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
        default: isLight ? palette.backgrounds.appBg : '#02150B',
        paper: isLight ? palette.backgrounds.surfaceBg : 'rgba(4, 32, 24, 0.92)',
      },
      text: {
        primary: isLight ? palette.text.primary : '#E9FFF4',
        secondary: isLight ? palette.text.secondary : '#9FE3C6',
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
            backgroundColor: isLight ? palette.backgrounds.appBg : '#02150B',
            color: isLight ? palette.text.primary : '#E9FFF4',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            backdropFilter: 'blur(20px)',
            border: `1px solid ${muiAlpha(
              theme.palette.primary.main,
              theme.palette.mode === 'light' ? 0.2 : 0.35
            )}`,
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
            border: `1px solid ${muiAlpha(
              theme.palette.primary.main,
              theme.palette.mode === 'light' ? 0.2 : 0.35
            )}`,
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
            backgroundColor: muiAlpha(
              isLight
                ? theme.palette.common.white
                : theme.palette.background.paper,
              isLight ? 0.98 : 0.75
            ),
            borderRadius: 12,
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            '& fieldset': {
              borderColor: muiAlpha(
                theme.palette.primary.main,
                theme.palette.mode === 'light' ? 0.25 : 0.45
              ),
            },
            '&:hover fieldset': {
              borderColor: theme.palette.primary.main,
            },
            '&.Mui-focused fieldset': {
              borderColor: theme.palette.primary.main,
              boxShadow: `0 0 0 2px ${muiAlpha(theme.palette.primary.main, 0.15)}`,
            },
          }),
          input: ({ theme }) => ({
            color: theme.palette.text.primary,
            '&::placeholder': {
              color: muiAlpha(theme.palette.text.secondary, 0.9),
              opacity: 1,
            },
          }),
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: muiAlpha(theme.palette.text.secondary, 0.85),
            '&.Mui-focused': {
              color: theme.palette.primary.main,
            },
          }),
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: muiAlpha(theme.palette.text.secondary, 0.9),
          }),
        },
      },
    },
  };
};

export const createAppTheme = (mode: PaletteMode, colorPalette?: ColorPalette) => createTheme(getDesignTokens(mode, colorPalette));
