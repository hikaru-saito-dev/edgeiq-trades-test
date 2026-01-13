/**
 * Color utility functions for generating a complete color palette
 * from primary and secondary brand colors
 */

// Default colors (matching original site exactly)
const DEFAULT_PRIMARY = '#22c55e';
const DEFAULT_SECONDARY = '#10b981'; // Secondary main color (not #059669 which is the dark variant)

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
 * Convert RGB to HSL
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [h * 360, s * 100, l * 100];
}

/**
 * Convert HSL to RGB
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Lighten a color using HSL (matches the pattern from default colors)
 * Based on analysis: light variant increases lightness by ~13 percentage points
 */
export function lightenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // For default colors pattern: light variant increases lightness by ~13 points
  // For general use, we'll use the amount parameter but with HSL-based calculation
  const newL = Math.min(100, l + (amount > 20 ? 13 : (amount * 0.65))); // ~13 points for 20% lighten
  const [r, g, b] = hslToRgb(h, s, newL);
  return rgbToHex(r, g, b);
}

/**
 * Darken a color using HSL (matches the pattern from default colors)
 * Based on analysis: dark variant decreases lightness by ~9 percentage points, increases saturation slightly
 */
export function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // For default colors pattern: dark variant decreases lightness by ~9 points, increases sat by ~5 points
  // For general use, we'll use the amount parameter but with HSL-based calculation
  const newL = Math.max(0, l - (amount > 20 ? 9 : (amount * 0.45))); // ~9 points for 20% darken
  const newS = Math.min(100, s + (amount > 20 ? 5 : (amount * 0.25))); // Increase saturation slightly
  const [r, g, b] = hslToRgb(h, newS, newL);
  return rgbToHex(r, g, b);
}

/**
 * Generate a light background color from primary color
 * Based on pattern: increase lightness significantly while maintaining hue
 */
function generateLightBackgroundColor(hex: string, lightnessIncrease: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // Increase lightness significantly, slightly adjust saturation
  const newL = Math.min(100, l + lightnessIncrease);
  const newS = Math.max(60, Math.min(85, s - 5)); // Keep saturation in range 60-85
  const [r, g, b] = hslToRgb(h, newS, newL);
  return rgbToHex(r, g, b);
}

/**
 * Generate a dark background color from primary color
 * Based on pattern: decrease lightness significantly while maintaining hue
 */
function generateDarkBackgroundColor(hex: string, lightnessDecrease: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // Decrease lightness significantly, adjust saturation
  const newL = Math.max(0, l - lightnessDecrease);
  const newS = Math.max(35, Math.min(85, s + 10)); // Keep saturation in range 35-85
  const [r, g, b] = hslToRgb(h, newS, newL);
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
 * Generate gradient end color based on direction and intensity
 * @param primaryHex - Primary color (hex)
 * @param direction - Gradient direction in degrees (0-360)
 * @param intensity - Color intensity percentage (0-100)
 * @param isDark - Whether we're in dark mode
 */
export function generateGradientColor(
  primaryHex: string,
  direction: number,
  intensity: number,
  isDark: boolean
): string {
  const rgb = hexToRgb(primaryHex);
  if (!rgb) return primaryHex;

  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
  
  // Calculate hue shift based on direction (0-360 degrees)
  // Direction affects which complementary/analogous color we shift towards
  const hueShift = (direction / 360) * 60; // Map 0-360 to 0-60 degree hue shift
  const newH = (h + hueShift) % 360;
  
  // Intensity affects how much we darken/lighten and adjust saturation
  const intensityFactor = intensity / 100;
  
  // For gradients, we typically want to darken the end color
  // Higher intensity = more dramatic difference
  const lightnessChange = isDark 
    ? -15 * intensityFactor  // Darken more in dark mode
    : -20 * intensityFactor; // Darken more in light mode
  
  const saturationChange = 5 * intensityFactor; // Slightly increase saturation
  
  const newL = Math.max(0, Math.min(100, l + lightnessChange));
  const newS = Math.max(0, Math.min(100, s + saturationChange));
  
  const [r, g, b] = hslToRgb(newH, newS, newL);
  return rgbToHex(r, g, b);
}

/**
 * Default color palette matching the original site exactly
 * This is used when default colors are provided
 */
const DEFAULT_COLOR_PALETTE_EXACT: ColorPalette = {
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
    headerGradientLight: 'linear-gradient(180deg, #1e3a2a 0%, #2D503D 100%)', // Light mode header
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
    headerGradientLight: string;
    backgroundGradient: string;
    backgroundGradientDark: string;
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
  secondary?: string | null,
  gradientDirection?: number,
  colorIntensity?: number
): ColorPalette {
  // Use defaults if colors are not provided or invalid
  const primaryColor = isValidHexColor(primary || '') ? primary! : DEFAULT_PRIMARY;
  const secondaryColor = isValidHexColor(secondary || '') ? secondary! : DEFAULT_SECONDARY;
  
  // Default gradient direction and intensity
  const direction = gradientDirection !== undefined ? gradientDirection : 135;
  const intensity = colorIntensity !== undefined ? colorIntensity : 60;

  // If using default colors and default settings, return the exact palette that matches the original site
  if (primaryColor === DEFAULT_PRIMARY && secondaryColor === DEFAULT_SECONDARY && direction === 135 && intensity === 60) {
    return DEFAULT_COLOR_PALETTE_EXACT;
  }

  // Generate primary color variants
  const primaryLight = lightenColor(primaryColor, 20);
  const primaryDark = darkenColor(primaryColor, 20);

  // Generate secondary color variants
  const secondaryLight = lightenColor(secondaryColor, 20);
  const secondaryDark = darkenColor(secondaryColor, 20);

  // Generate gradient end color based on direction and intensity
  const gradientEndColor = generateGradientColor(primaryColor, direction, intensity, false);
  
  // Generate gradients with custom direction
  const primaryToSecondary = `linear-gradient(${direction}deg, ${primaryColor} 0%, ${gradientEndColor} 100%)`;
  const buttonGradient = `linear-gradient(${direction}deg, ${primaryColor} 0%, ${gradientEndColor} 100%)`;
  const headerGradient = `linear-gradient(180deg, ${darkenColor(primaryColor, 40)} 0%, ${darkenColor(primaryColor, 20)} 100%)`;
  // Light mode header: darker green gradient (pattern from original: #1e3a2a to #2D503D)
  const headerGradientLight = `linear-gradient(180deg, ${darkenColor(primaryColor, 50)} 0%, ${darkenColor(primaryColor, 45)} 100%)`;

  // Generate light mode background gradient
  // Pattern: Very light (52% lightness increase) -> Light (46% increase) -> Medium light (35% increase)
  const lightBg1 = generateLightBackgroundColor(primaryColor, 52.4);
  const lightBg2 = generateLightBackgroundColor(primaryColor, 46.5);
  const lightBg3 = generateLightBackgroundColor(primaryColor, 35.1);
  const backgroundGradient = `linear-gradient(180deg, ${lightBg1} 0%, ${lightBg2} 50%, ${lightBg3} 100%)`;

  // Generate dark mode background gradient
  // Pattern: Very dark (41% lightness decrease) -> Dark (37% decrease) -> Medium dark (29% decrease)
  const darkBg1 = generateDarkBackgroundColor(primaryColor, 40.8);
  const darkBg2 = generateDarkBackgroundColor(primaryColor, 37.3);
  const darkBg3 = generateDarkBackgroundColor(primaryColor, 28.8);
  const backgroundGradientDark = `linear-gradient(180deg, ${darkBg1} 0%, ${darkBg2} 50%, ${darkBg3} 100%)`;

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
      headerGradientLight,
      backgroundGradient,
      backgroundGradientDark,
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

/**
 * Generate color palette for a specific mode (light or dark)
 */
export function generateColorPaletteForMode(
  primary?: string | null,
  secondary?: string | null,
  gradientDirection?: number,
  intensity?: number,
  isDark: boolean = false
): ColorPalette {
  // Generate base palette
  const basePalette = generateColorPalette(primary, secondary, gradientDirection, intensity);
  
  // If dark mode, adjust colors for better contrast and visibility
  if (isDark) {
    const darkAppBg = generateDarkBackgroundColor(basePalette.primary.main, 40.8);
    const darkSurfaceBg = `rgba(4, 32, 24, 0.92)`;
    const darkTextPrimary = getTextColor(darkAppBg);
    const darkTextSecondary = lightenColor(basePalette.primary.main, 30);
    const darkTextMuted = lightenColor(basePalette.primary.main, 20);
    
    return {
      ...basePalette,
      backgrounds: {
        appBg: darkAppBg,
        surfaceBg: darkSurfaceBg,
        overlay: alpha(basePalette.primary.main, 0.45),
      },
      text: {
        primary: darkTextPrimary,
        secondary: darkTextSecondary,
        muted: darkTextMuted,
      },
      borders: {
        default: alpha(basePalette.primary.main, 0.15),
        accent: alpha(basePalette.primary.main, 0.25),
      },
      gradients: {
        ...basePalette.gradients,
        backgroundGradient: basePalette.gradients.backgroundGradientDark,
      },
    };
  }
  
  return basePalette;
}
