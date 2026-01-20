'use client';

import { createContext, useContext, useMemo } from 'react';
import { useAccess } from './AccessProvider';
import { generateColorPalette, type ColorPalette } from '@/utils/colorPalette';

type BrandingContextValue = {
    brandColor: string | null;
    logoUrl: string | null;
    appName: string | null;
    palette: ColorPalette; // Generated color palette from brandColor
};

const BrandingContext = createContext<BrandingContextValue>({
    brandColor: null,
    logoUrl: null,
    appName: null,
    palette: generateColorPalette(null), // Default palette
});

export function BrandingProvider({ children }: { children: React.ReactNode }) {
    const { brandColor, logoUrl, appName } = useAccess();

    // Generate color palette from brandColor (or use default if not set)
    const palette = useMemo(() => {
        return generateColorPalette(brandColor || null);
    }, [brandColor]);

    const value = useMemo<BrandingContextValue>(
        () => ({
            brandColor: brandColor ?? null,
            logoUrl: logoUrl ?? null,
            appName: appName ?? null,
            palette,
        }),
        [brandColor, logoUrl, appName, palette],
    );

    return (
        <BrandingContext.Provider value={value}>
            {children}
        </BrandingContext.Provider>
    );
}

export function useBranding() {
    const context = useContext(BrandingContext);
    if (!context) {
        throw new Error('useBranding must be used within a BrandingProvider');
    }
    return context;
}
