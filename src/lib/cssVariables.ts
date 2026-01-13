/**
 * Utility functions for setting dynamic CSS variables from color palette
 */

import type { ColorPalette } from './colorUtils';
import { alpha } from './colorUtils';

/**
 * Set CSS variables on document root from color palette
 * Updates both light and dark theme variables
 */
export function setCSSVariables(colorPalette: ColorPalette, isDark: boolean = false) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  if (isDark) {
    // Dark theme variables
    root.style.setProperty('--app-bg', '#02150B');
    root.style.setProperty('--app-text', '#E9FFF4');
    root.style.setProperty('--text-secondary', '#B1FBD8');
    root.style.setProperty('--text-muted', '#9FE3C6');
    root.style.setProperty('--accent-strong', colorPalette.primary.light);
    root.style.setProperty('--surface-bg', 'rgba(4, 32, 24, 0.92)');
    root.style.setProperty('--surface-border', colorPalette.borders.default);
    root.style.setProperty('--scroll-track', 'rgba(3, 23, 16, 0.65)');
    root.style.setProperty('--scroll-thumb-start', colorPalette.primary.light);
    root.style.setProperty('--scroll-thumb-end', colorPalette.secondary.light);
    
    const overlayPrimaryRgb = colorPalette.primary.main.match(/[A-Za-z0-9]{2}/g);
    const overlayR = overlayPrimaryRgb ? parseInt(overlayPrimaryRgb[0], 16) : 12;
    const overlayG = overlayPrimaryRgb ? parseInt(overlayPrimaryRgb[1], 16) : 65;
    const overlayB = overlayPrimaryRgb ? parseInt(overlayPrimaryRgb[2], 16) : 48;
    
    root.style.setProperty('--background-overlay', `
      repeating-linear-gradient(
        0deg,
        transparent,
        transparent 1px,
        rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.45) 1px,
        rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.45) 2px
      ),
      linear-gradient(180deg, rgba(3, 23, 16, 0.8) 0%, rgba(6, 44, 32, 0.8) 100%)
    `);
  } else {
    // Light theme variables
    root.style.setProperty('--app-bg', colorPalette.backgrounds.appBg);
    root.style.setProperty('--app-text', colorPalette.text.primary);
    root.style.setProperty('--text-secondary', colorPalette.text.secondary);
    root.style.setProperty('--text-muted', colorPalette.text.muted);
    root.style.setProperty('--accent-strong', colorPalette.secondary.main);
    root.style.setProperty('--surface-bg', colorPalette.backgrounds.surfaceBg);
    root.style.setProperty('--surface-border', colorPalette.borders.default);
    
    // Scrollbar colors - lighten the primary color for track
    const trackRgb = colorPalette.primary.main.match(/[A-Za-z0-9]{2}/g);
    if (trackRgb) {
      const r = Math.min(255, parseInt(trackRgb[0], 16) + 40);
      const g = Math.min(255, parseInt(trackRgb[1], 16) + 40);
      const b = Math.min(255, parseInt(trackRgb[2], 16) + 40);
      root.style.setProperty('--scroll-track', `rgba(${r}, ${g}, ${b}, 0.3)`);
    } else {
      root.style.setProperty('--scroll-track', 'rgba(240, 253, 244, 0.3)');
    }
    
    root.style.setProperty('--scroll-thumb-start', colorPalette.primary.main);
    root.style.setProperty('--scroll-thumb-end', colorPalette.secondary.main);
    
    // Background overlay - use lightened primary color
    const overlayRgb = colorPalette.primary.main.match(/[A-Za-z0-9]{2}/g);
    if (overlayRgb) {
      const r = Math.min(255, parseInt(overlayRgb[0], 16) + 50);
      const g = Math.min(255, parseInt(overlayRgb[1], 16) + 50);
      const b = Math.min(255, parseInt(overlayRgb[2], 16) + 50);
      const r2 = Math.min(255, parseInt(overlayRgb[0], 16) + 30);
      const g2 = Math.min(255, parseInt(overlayRgb[1], 16) + 30);
      const b2 = Math.min(255, parseInt(overlayRgb[2], 16) + 30);
      
      root.style.setProperty('--background-overlay', `
        repeating-linear-gradient(
          0deg,
          transparent,
          transparent 1px,
          rgba(${r}, ${g}, ${b}, 0.35) 1px,
          rgba(${r}, ${g}, ${b}, 0.35) 2px
        ),
        linear-gradient(180deg, rgba(${r2}, ${g2}, ${b2}, 0.6) 0%, rgba(${r}, ${g}, ${b}, 0.4) 100%)
      `);
    } else {
      root.style.setProperty('--background-overlay', `
        repeating-linear-gradient(
          0deg,
          transparent,
          transparent 1px,
          rgba(200, 230, 201, 0.35) 1px,
          rgba(200, 230, 201, 0.35) 2px
        ),
        linear-gradient(180deg, rgba(240, 253, 244, 0.6) 0%, rgba(220, 252, 231, 0.4) 100%)
      `);
    }
  }
}
