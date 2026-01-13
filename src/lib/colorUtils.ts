/**
 * Color utility functions for generating a complete color palette
 * from primary and secondary brand colors
 */

// Default colors
const DEFAULT_PRIMARY = '#22c55e';
const DEFAULT_SECONDARY = '#059669';

/**
 * Convert hex color to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return result
    ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : null;
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Lighten a color by a percentage (0-100)
 */
export function lightenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const factor = amount / 100;
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * factor));
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * factor));
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * factor));

  return rgbToHex(r, g, b);
}

/**
 * Darken a color by a percentage (0-100)
 */
export function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const factor = amount / 100;
  const r = Math.max(0, Math.round(rgb.r * (1 - factor)));
  const g = Math.max(0, Math.round(rgb.g * (1 - factor)));
  const b = Math.max(0, Math.round(rgb.b * (1 - factor)));

  return rgbToHex(r, g, b);
}

/**
 * Add alpha transparency to a hex color
 */
export function alpha(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}

/**
 * Calculate relative luminance for contrast checking
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    val = val / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Get contrast ratio between two colors
 */
function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return 1;

  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Get appropriate text color (dark or light) for a background
 */
function getTextColor(backgroundColor: string): string {
  const rgb = hexToRgb(backgroundColor);
  if (!rgb) return '#064e3b';

  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);
  // Use dark text for light backgrounds, light text for dark backgrounds
  return luminance > 0.5 ? '#064e3b' : '#E9FFF4';
}

/**
 * Validate hex color
 */
export function isValidHexColor(color: string): boolean {
  if (!color || color.trim() === '') return false;
  return /^#[0-9A-Fa-f]{6}$/.test(color.trim());
}

/**
 * Generate a complete color palette from primary and secondary colors
 */
export interface ColorPalette {
  primary: {
    main: string;
    light: string;
    dark: string;
    alpha10: string;
    alpha20: string;
    alpha30: string;
    alpha40: string;
    alpha50: string;
  };
  secondary: {
    main: string;
    light: string;
    dark: string;
    alpha10: string;
    alpha20: string;
    alpha30: string;
    alpha40: string;
    alpha50: string;
  };
  gradients: {
    primaryToSecondary: string;
    buttonGradient: string;
    headerGradient: string;
    backgroundGradient: string;
  };
  backgrounds: {
    appBg: string;
    surfaceBg: string;
    overlay: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
  borders: {
    default: string;
    accent: string;
  };
  shadows: {
    light: string;
    medium: string;
    strong: string;
  };
}

export function generateColorPalette(
  primary?: string | null,
  secondary?: string | null
): ColorPalette {
  // Use defaults if colors are not provided or invalid
  const primaryColor = isValidHexColor(primary || '') ? primary! : DEFAULT_PRIMARY;
  const secondaryColor = isValidHexColor(secondary || '') ? secondary! : DEFAULT_SECONDARY;

  // Generate primary color variants
  const primaryLight = lightenColor(primaryColor, 20);
  const primaryDark = darkenColor(primaryColor, 20);

  // Generate secondary color variants
  const secondaryLight = lightenColor(secondaryColor, 20);
  const secondaryDark = darkenColor(secondaryColor, 20);

  // Generate gradients
  const primaryToSecondary = `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`;
  const buttonGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`;
  const headerGradient = `linear-gradient(180deg, ${darkenColor(primaryColor, 40)} 0%, ${darkenColor(primaryColor, 20)} 100%)`;
  const backgroundGradient = `linear-gradient(180deg, ${lightenColor(primaryColor, 45)} 0%, ${lightenColor(primaryColor, 35)} 50%, ${lightenColor(primaryColor, 25)} 100%)`;

  // Get primary RGB for calculations
  const primaryRgb = hexToRgb(primaryColor)!;

  // Generate backgrounds (light mode)
  const appBg = lightenColor(primaryColor, 48);
  const surfaceBg = `rgba(255, 255, 255, 0.94)`;
  const overlayLight = alpha(primaryColor, 0.35);
  const overlayDark = alpha(primaryColor, 0.45);

  // Generate text colors
  const textPrimary = getTextColor(appBg);
  const textSecondary = darkenColor(primaryColor, 25);
  const textMuted = darkenColor(primaryColor, 40);

  // Generate borders
  const borderDefault = alpha(primaryColor, 0.2);
  const borderAccent = alpha(primaryColor, 0.3);

  // Generate shadows
  const shadowLight = alpha(primaryColor, 0.08);
  const shadowMedium = alpha(primaryColor, 0.2);
  const shadowStrong = alpha(primaryColor, 0.4);

  return {
    primary: {
      main: primaryColor,
      light: primaryLight,
      dark: primaryDark,
      alpha10: alpha(primaryColor, 0.1),
      alpha20: alpha(primaryColor, 0.2),
      alpha30: alpha(primaryColor, 0.3),
      alpha40: alpha(primaryColor, 0.4),
      alpha50: alpha(primaryColor, 0.5),
    },
    secondary: {
      main: secondaryColor,
      light: secondaryLight,
      dark: secondaryDark,
      alpha10: alpha(secondaryColor, 0.1),
      alpha20: alpha(secondaryColor, 0.2),
      alpha30: alpha(secondaryColor, 0.3),
      alpha40: alpha(secondaryColor, 0.4),
      alpha50: alpha(secondaryColor, 0.5),
    },
    gradients: {
      primaryToSecondary,
      buttonGradient,
      headerGradient,
      backgroundGradient,
    },
    backgrounds: {
      appBg,
      surfaceBg,
      overlay: overlayLight,
    },
    text: {
      primary: textPrimary,
      secondary: textSecondary,
      muted: textMuted,
    },
    borders: {
      default: borderDefault,
      accent: borderAccent,
    },
    shadows: {
      light: shadowLight,
      medium: shadowMedium,
      strong: shadowStrong,
    },
  };
}