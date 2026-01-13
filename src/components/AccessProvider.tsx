'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { generateColorPalette, type ColorPalette } from '@/lib/colorUtils';
import { ColorPaletteProvider } from './ThemeProvider';

type AccessRole = 'companyOwner' | 'owner' | 'admin' | 'member' | 'none';

type AccessContextValue = {
  role: AccessRole;
  isAuthorized: boolean;
  loading: boolean;
  userId: string | null;
  companyId: string | null;
  hasAutoIQ?: boolean;
  autoTradeMode?: 'auto-trade' | 'notify-only';
  hideLeaderboardFromMembers?: boolean;
  hideCompanyStatsFromMembers?: boolean;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  appTitle?: string | null;
  logoUrl?: string | null;
  colorPalette: ColorPalette;
  refresh: () => Promise<void>;
};

const AccessContext = createContext<AccessContextValue>({
  role: 'none',
  isAuthorized: false,
  loading: true,
  userId: null,
  companyId: null,
  hasAutoIQ: false,
  autoTradeMode: 'notify-only',
  hideLeaderboardFromMembers: false,
  hideCompanyStatsFromMembers: false,
  primaryColor: null,
  secondaryColor: null,
  appTitle: null,
  logoUrl: null,
  colorPalette: generateColorPalette(),
  refresh: async () => { },
});

// Global experienceId state (set from page.tsx)
let globalExperienceId: string | null = null;
const experienceIdListeners: Set<() => void> = new Set();

/**
 * Set experienceId from page.tsx
 * This allows page.tsx to pass experienceId to AccessProvider
 */
export function setExperienceId(experienceId: string | null) {
  globalExperienceId = experienceId;
  // Notify all listeners
  experienceIdListeners.forEach(listener => listener());
}

/**
 * Extract experienceId from current URL query parameters
 * This is needed because the home page (/) is the first page that loads with ?experience=exp_...

/**
 * Fetch access role and auth info from API
 * This calls verifyWhopUser ONCE on the server side
 */
async function fetchAccessRole(experienceId?: string | null): Promise<{ 
  role: AccessRole; 
  isAuthorized: boolean;
  userId: string | null;
  companyId: string | null;
  hasAutoIQ?: boolean;
  autoTradeMode?: 'auto-trade' | 'notify-only';
  hideLeaderboardFromMembers?: boolean;
  hideCompanyStatsFromMembers?: boolean;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  appTitle?: string | null;
  logoUrl?: string | null;
}> {
  try {
    // Include experienceId in the URL if present (from query parameter ?experience=exp_...)
    let url = '/api/auth/role';
    if (experienceId) {
      url += `?experience=${encodeURIComponent(experienceId)}`;
    } else {
      return { role: 'none', isAuthorized: false, userId: null, companyId: null, hasAutoIQ: false, autoTradeMode: 'notify-only', hideLeaderboardFromMembers: false, hideCompanyStatsFromMembers: false, primaryColor: null, secondaryColor: null, appTitle: null, logoUrl: null };
    }

    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      return { role: 'none', isAuthorized: false, userId: null, companyId: null, hasAutoIQ: false, autoTradeMode: 'notify-only', hideLeaderboardFromMembers: false, hideCompanyStatsFromMembers: false, primaryColor: null, secondaryColor: null, appTitle: null, logoUrl: null };
    }

    const data = await response.json();
    const role = data.role as AccessRole | undefined;
    const isAuthorized = Boolean(data.isAuthorized);
    const userId = data.userId || null;
    const companyId = data.companyId || null;
    const hasAutoIQ = data.hasAutoIQ ?? false;
    const autoTradeMode = data.autoTradeMode || 'notify-only';
    const hideLeaderboardFromMembers = data.hideLeaderboardFromMembers ?? false;
    const hideCompanyStatsFromMembers = data.hideCompanyStatsFromMembers ?? false;
    const primaryColor = data.primaryColor || null;
    const secondaryColor = data.secondaryColor || null;
    const appTitle = data.appTitle || null;
    const logoUrl = data.logoUrl || null;
    
    if (role === 'companyOwner' || role === 'owner' || role === 'admin' || role === 'member' || role === 'none') {
      return { role, isAuthorized, userId, companyId, hasAutoIQ, autoTradeMode, hideLeaderboardFromMembers, hideCompanyStatsFromMembers, primaryColor, secondaryColor, appTitle, logoUrl };
    }

    return { role: 'none', isAuthorized: false, userId: null, companyId: null, hasAutoIQ: false, autoTradeMode: 'notify-only', hideLeaderboardFromMembers: false, hideCompanyStatsFromMembers: false, primaryColor: null, secondaryColor: null, appTitle: null, logoUrl: null };
  } catch (error) {
    console.error('Failed to load access role', error);
    return { role: 'none', isAuthorized: false, userId: null, companyId: null, hasAutoIQ: false, autoTradeMode: 'notify-only', hideLeaderboardFromMembers: false, hideCompanyStatsFromMembers: false, primaryColor: null, secondaryColor: null, appTitle: null, logoUrl: null };
  }
}

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<AccessRole>('none');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [hasAutoIQ, setHasAutoIQ] = useState(false);
  const [autoTradeMode, setAutoTradeMode] = useState<'auto-trade' | 'notify-only'>('notify-only');
  const [hideLeaderboardFromMembers, setHideLeaderboardFromMembers] = useState(false);
  const [hideCompanyStatsFromMembers, setHideCompanyStatsFromMembers] = useState(false);
  const [primaryColor, setPrimaryColor] = useState<string | null>(null);
  const [secondaryColor, setSecondaryColor] = useState<string | null>(null);
  const [appTitle, setAppTitle] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [experienceId, setExperienceIdState] = useState<string | null>(null);

  // Listen for experienceId changes from page.tsx
  useEffect(() => {
    const listener = () => {
      setExperienceIdState(globalExperienceId);
    };
    experienceIdListeners.add(listener);
    // Set initial value
    setExperienceIdState(globalExperienceId);
    
    return () => {
      experienceIdListeners.delete(listener);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    // Use experienceId from state (set by page.tsx) or fall back to URL
    const currentExperienceId = experienceId;
    const result = await fetchAccessRole(currentExperienceId);
    setRole(result.role);
    setIsAuthorized(result.isAuthorized);
    setUserId(result.userId);
    setCompanyId(result.companyId);
    setHasAutoIQ(result.hasAutoIQ ?? false);
    setAutoTradeMode(result.autoTradeMode || 'notify-only');
    setHideLeaderboardFromMembers(result.hideLeaderboardFromMembers ?? false);
    setHideCompanyStatsFromMembers(result.hideCompanyStatsFromMembers ?? false);
    setPrimaryColor(result.primaryColor || null);
    setSecondaryColor(result.secondaryColor || null);
    setAppTitle(result.appTitle || null);
    setLogoUrl(result.logoUrl || null);
    setLoading(false);
  }, [experienceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Generate color palette from primary and secondary colors
  const colorPalette = useMemo(() => generateColorPalette(primaryColor || undefined, secondaryColor || undefined), [primaryColor, secondaryColor]);

  const value = useMemo<AccessContextValue>(
    () => ({
      role,
      isAuthorized,
      loading,
      userId,
      companyId,
      hasAutoIQ,
      autoTradeMode,
      hideLeaderboardFromMembers,
      hideCompanyStatsFromMembers,
      primaryColor,
      secondaryColor,
      appTitle,
      logoUrl,
      colorPalette,
      refresh,
    }),
    [role, isAuthorized, loading, userId, companyId, hasAutoIQ, autoTradeMode, hideLeaderboardFromMembers, hideCompanyStatsFromMembers, primaryColor, secondaryColor, appTitle, logoUrl, colorPalette, refresh],
  );

  return (
    <AccessContext.Provider value={value}>
      <ColorPaletteProvider colorPalette={colorPalette}>
        {children}
      </ColorPaletteProvider>
    </AccessContext.Provider>
  );
}

export function useAccess() {
  const context = useContext(AccessContext);
  if (!context) {
    throw new Error('useAccess must be used within an AccessProvider');
  }
  return context;
}
