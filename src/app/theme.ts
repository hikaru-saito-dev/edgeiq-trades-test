'use client';

import { PaletteMode, ThemeOptions, createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material';

// Helper function to convert hex to RGB
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

// Helper function to lighten a color
function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const amount = percent / 100;
  return `rgb(${Math.round(rgb.r + (255 - rgb.r) * amount)}, ${Math.round(rgb.g + (255 - rgb.g) * amount)}, ${Math.round(rgb.b + (255 - rgb.b) * amount)})`;
}

// Helper function to darken a color
function darkenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const amount = percent / 100;
  return `rgb(${Math.round(rgb.r * (1 - amount))}, ${Math.round(rgb.g * (1 - amount))}, ${Math.round(rgb.b * (1 - amount))})`;
}

// Helper function to generate background colors from primary color
function generateBackgroundColors(primaryColor: string, isLight: boolean): {
  default: string;
  paper: string;
} {
  const rgb = hexToRgb(primaryColor);
  if (!rgb) {
    return {
      default: isLight ? '#f5fdf8' : '#02150B',
      paper: isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(4, 32, 24, 0.92)',
    };
  }

  if (isLight) {
    // Light mode: very light tint of primary color
    return {
      default: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)`,
      paper: 'rgba(255, 255, 255, 0.94)',
    };
  } else {
    // Dark mode: very dark shade
    const darkR = Math.max(0, Math.round(rgb.r * 0.1));
    const darkG = Math.max(0, Math.round(rgb.g * 0.1));
    const darkB = Math.max(0, Math.round(rgb.b * 0.1));
    return {
      default: `rgb(${darkR}, ${darkG}, ${darkB})`,
      paper: `rgba(${darkR}, ${darkG}, ${darkB}, 0.92)`,
    };
  }
}

// Helper function to generate text colors from primary color
function generateTextColors(primaryColor: string, isLight: boolean): {
  primary: string;
  secondary: string;
} {
  const rgb = hexToRgb(primaryColor);
  if (!rgb) {
    return {
      primary: isLight ? '#064e3b' : '#E9FFF4',
      secondary: isLight ? '#166534' : '#9FE3C6',
    };
  }

  if (isLight) {
    // Light mode: dark version of primary for text
    return {
      primary: darkenColor(primaryColor, 60),
      secondary: darkenColor(primaryColor, 40),
    };
  } else {
    // Dark mode: light version of primary for text
    return {
      primary: lightenColor(primaryColor, 80),
      secondary: lightenColor(primaryColor, 50),
    };
  }
}

const getDesignTokens = (mode: PaletteMode, primaryColor?: string | null, secondaryColor?: string | null): ThemeOptions => {
  const isLight = mode === 'light';

  // Use company primary color or default to green
  const primary = primaryColor && /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : '#22c55e';
  const secondary = secondaryColor && /^#[0-9A-Fa-f]{6}$/.test(secondaryColor) ? secondaryColor : darkenColor(primary, 15);

  // Generate color variants
  const primaryLight = lightenColor(primary, 20);
  const primaryDark = darkenColor(primary, 15);
  const secondaryLight = lightenColor(secondary, 20);
  const secondaryDark = darkenColor(secondary, 15);

  // Generate backgrounds and text colors
  const backgrounds = generateBackgroundColors(primary, isLight);
  const textColors = generateTextColors(primary, isLight);

  return {
    palette: {
      mode,
      primary: {
        main: primary,
        light: primaryLight,
        dark: primaryDark,
      },
      secondary: {
        main: secondary,
        light: secondaryLight,
        dark: secondaryDark,
      },
      background: {
        default: backgrounds.default,
        paper: backgrounds.paper,
      },
      text: {
        primary: textColors.primary,
        secondary: textColors.secondary,
      },
      divider: alpha(primary, isLight ? 0.2 : 0.15),
    },
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontSize: '3rem',
        fontWeight: 800,
        background: `linear-gradient(135deg, ${primary} 0%, ${primaryDark} 100%)`,
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
            backgroundColor: backgrounds.default,
            color: textColors.primary,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            backdropFilter: 'blur(20px)',
            border: `1px solid ${alpha(
              theme.palette.primary.main,
              theme.palette.mode === 'light' ? 0.2 : 0.35
            )}`,
            boxShadow: theme.palette.mode === 'light'
              ? `0 12px 32px ${alpha(primary, 0.08)}`
              : '0 12px 32px rgba(0, 0, 0, 0.45)',
          }),
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            backdropFilter: 'blur(20px)',
            border: `1px solid ${alpha(
              theme.palette.primary.main,
              theme.palette.mode === 'light' ? 0.2 : 0.35
            )}`,
            boxShadow: theme.palette.mode === 'light'
              ? `0 12px 32px ${alpha(primary, 0.08)}`
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
              borderColor: alpha(
                theme.palette.primary.main,
                theme.palette.mode === 'light' ? 0.25 : 0.45
              ),
            },
            '&:hover fieldset': {
              borderColor: theme.palette.primary.main,
            },
            '&.Mui-focused fieldset': {
              borderColor: theme.palette.primary.main,
              boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.15)}`,
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

export const createAppTheme = (mode: PaletteMode, primaryColor?: string | null, secondaryColor?: string | null) =>
  createTheme(getDesignTokens(mode, primaryColor, secondaryColor));


