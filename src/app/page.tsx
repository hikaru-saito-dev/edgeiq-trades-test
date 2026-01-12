'use client';

import { Container, Typography, Box, Button, CircularProgress, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAccess, setExperienceId } from '@/components/AccessProvider';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function HomeContent() {
  const searchParams = useSearchParams();
  const experienceId = searchParams?.get('experience') || null;
  const { isAuthorized, loading, role, hideLeaderboardFromMembers, companyBranding } = useAccess();
  const theme = useTheme();

  // Set experienceId in AccessProvider when it's available from page.tsx
  useEffect(() => {
    if (experienceId) {
      setExperienceId(experienceId);
    }
  }, [experienceId]);

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: 'calc(100vh - 64px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: { xs: 4, md: 8 },
        }}
      >
        <Box textAlign="center">
          <CircularProgress size={56} sx={{ mb: 2, color: 'primary.main' }} />
          <Typography variant="h6" color="text.primary">
            Verifying your access…
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={(theme) => ({
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        py: { xs: 4, md: 8 },
        px: { xs: 2, sm: 4 },
        background: (() => {
          const primary = companyBranding.primaryColor || theme.palette.primary.main;
          const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(primary);
          if (!rgb) {
            return theme.palette.mode === 'dark'
              ? 'linear-gradient(180deg, #02150B 0%, #0a1f0f 50%, #1a3a2a 100%)'
              : 'linear-gradient(180deg, #f5fdf8 0%, #d9fbe9 50%, #a7f3d0 100%)';
          }
          const r = parseInt(rgb[1], 16);
          const g = parseInt(rgb[2], 16);
          const b = parseInt(rgb[3], 16);
          if (theme.palette.mode === 'dark') {
            const darkR = Math.max(0, Math.round(r * 0.1));
            const darkG = Math.max(0, Math.round(g * 0.1));
            const darkB = Math.max(0, Math.round(b * 0.1));
            const midR = Math.max(0, Math.round(r * 0.15));
            const midG = Math.max(0, Math.round(g * 0.15));
            const midB = Math.max(0, Math.round(b * 0.15));
            const lightR = Math.max(0, Math.round(r * 0.25));
            const lightG = Math.max(0, Math.round(g * 0.25));
            const lightB = Math.max(0, Math.round(b * 0.25));
            return `linear-gradient(180deg, rgb(${darkR}, ${darkG}, ${darkB}) 0%, rgb(${midR}, ${midG}, ${midB}) 50%, rgb(${lightR}, ${lightG}, ${lightB}) 100%)`;
          } else {
            const lightR = Math.round(255 - (255 - r) * 0.95);
            const lightG = Math.round(255 - (255 - g) * 0.95);
            const lightB = Math.round(255 - (255 - b) * 0.95);
            const midR = Math.round(255 - (255 - r) * 0.9);
            const midG = Math.round(255 - (255 - g) * 0.9);
            const midB = Math.round(255 - (255 - b) * 0.9);
            const lighterR = Math.round(255 - (255 - r) * 0.85);
            const lighterG = Math.round(255 - (255 - g) * 0.85);
            const lighterB = Math.round(255 - (255 - b) * 0.85);
            return `linear-gradient(180deg, rgba(${lightR}, ${lightG}, ${lightB}, 0.95) 0%, rgba(${midR}, ${midG}, ${midB}, 0.9) 50%, rgba(${lighterR}, ${lighterG}, ${lighterB}, 0.85) 100%)`;
          }
        })(),
        overflow: 'hidden',
        transition: 'background 0.3s ease',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          background: `
            repeating-linear-gradient(
              90deg,
              transparent,
              transparent 20px,
              ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.12)} 20px,
              ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.12)} 22px
            )
          `,
          zIndex: 0,
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          bottom: '10%',
          left: 0,
          right: 0,
          height: '200px',
          background: `
            radial-gradient(ellipse at 20% 50%, ${alpha(theme.palette.primary.main, 0.25)} 0%, transparent 50%),
            radial-gradient(ellipse at 50% 30%, ${alpha(theme.palette.primary.main, 0.2)} 0%, transparent 50%),
            radial-gradient(ellipse at 80% 60%, ${alpha(theme.palette.primary.main, 0.15)} 0%, transparent 50%)
          `,
          zIndex: 0,
          animation: 'pulse 4s ease-in-out infinite',
          opacity: theme.palette.mode === 'dark' ? 1 : 0.8,
        },
      })}
    >
      {/* Animated glowing wavy lines at bottom */}
      <Box
        className="wavy-lines"
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '35%',
          zIndex: 0,
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            bottom: '5%',
            left: 0,
            right: 0,
            height: '3px',
            background: (() => {
              const primary = companyBranding.primaryColor || theme.palette.primary.main;
              return `linear-gradient(90deg, transparent, ${alpha(primary, 0.6)} 20%, ${alpha(primary, 0.8)} 50%, ${alpha(primary, 0.6)} 80%, transparent)`;
            })(),
            filter: 'blur(3px)',
            boxShadow: (() => {
              const primary = companyBranding.primaryColor || theme.palette.primary.main;
              return `0 0 20px ${alpha(primary, 0.6)}`;
            })(),
            animation: 'wave 8s ease-in-out infinite',
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            bottom: '15%',
            left: 0,
            right: 0,
            height: '2px',
            background: (() => {
              const primary = companyBranding.primaryColor || theme.palette.primary.main;
              return `linear-gradient(90deg, transparent, ${alpha(primary, 0.5)} 25%, ${alpha(primary, 0.7)} 50%, ${alpha(primary, 0.5)} 75%, transparent)`;
            })(),
            filter: 'blur(2px)',
            boxShadow: (() => {
              const primary = companyBranding.primaryColor || theme.palette.primary.main;
              return `0 0 15px ${alpha(primary, 0.5)}`;
            })(),
            animation: 'wave 10s ease-in-out infinite reverse',
          },
        }}
      />

      <Container maxWidth="md" sx={{ position: 'relative', zIndex: 1, px: { xs: 2, sm: 3 } }}>
        <motion.div
          initial={{ opacity: 0, y: -30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, type: "spring", stiffness: 100 }}
        >
          <Typography
            variant="h1"
            component="h1"
            sx={{
              textAlign: 'center',
              mb: 3,
              fontSize: { xs: '3rem', sm: '4rem', md: '5rem' },
              fontWeight: 800,
              color: companyBranding.primaryColor || theme.palette.primary.main,
              lineHeight: 1.1,
              textShadow: (() => {
                const primary = companyBranding.primaryColor || theme.palette.primary.main;
                const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(primary);
                if (rgb) {
                  const r = parseInt(rgb[1], 16);
                  const g = parseInt(rgb[2], 16);
                  const b = parseInt(rgb[3], 16);
                  return `0 0 20px rgba(${r}, ${g}, ${b}, 0.5), 0 0 40px rgba(${r}, ${g}, ${b}, 0.3)`;
                }
                return `0 0 20px ${alpha(theme.palette.primary.main, 0.5)}, 0 0 40px ${alpha(theme.palette.primary.main, 0.3)}`;
              })(),
            }}
          >
            {companyBranding.appTitle}
          </Typography>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Typography
            variant="h5"
            sx={{
              textAlign: 'center',
              color: theme.palette.text.secondary,
              mb: 6,
              fontWeight: 400,
              fontSize: { xs: '1.1rem', sm: '1.25rem' },
              maxWidth: '600px',
              mx: 'auto',
              lineHeight: 1.6,
            }}
          >
            Track your options trades, compete on leaderboards, and prove your edge
          </Typography>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <Box
            sx={{
              display: 'flex',
              gap: 3,
              justifyContent: 'center',
              flexWrap: 'wrap',
              mt: 4,
            }}
          >
            {!loading && isAuthorized && (
              <Button
                variant="contained"
                size="large"
                component={Link}
                href="/trades"
                sx={{
                  background: `linear-gradient(135deg, ${companyBranding?.primaryColor || theme.palette.primary.main} 0%, ${companyBranding?.secondaryColor || theme.palette.secondary.main} 100%)`,
                  color: 'white',
                  px: 5,
                  py: 1.75,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  borderRadius: 3,
                  boxShadow: `0 8px 24px ${alpha(companyBranding?.primaryColor || theme.palette.primary.main, 0.3)}`,
                  textTransform: 'none',
                  '&:hover': {
                    background: `linear-gradient(135deg, ${(() => {
                      const primary = companyBranding?.primaryColor || theme.palette.primary.main;
                      const secondary = companyBranding?.secondaryColor || theme.palette.secondary.main;
                      const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(primary);
                      const rgb2 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(secondary);
                      if (rgb && rgb2) {
                        const r1 = Math.round(parseInt(rgb[1], 16) * 0.85);
                        const g1 = Math.round(parseInt(rgb[2], 16) * 0.85);
                        const b1 = Math.round(parseInt(rgb[3], 16) * 0.85);
                        const r2 = Math.round(parseInt(rgb2[1], 16) * 0.85);
                        const g2 = Math.round(parseInt(rgb2[2], 16) * 0.85);
                        const b2 = Math.round(parseInt(rgb2[3], 16) * 0.85);
                        return `rgb(${r1}, ${g1}, ${b1}) 0%, rgb(${r2}, ${g2}, ${b2}) 100%`;
                      }
                      return `${theme.palette.primary.dark} 0%, ${theme.palette.secondary.dark} 100%`;
                    })()})`,
                    boxShadow: `0 12px 32px ${alpha(companyBranding?.primaryColor || theme.palette.primary.main, 0.4)}`,
                    transform: 'translateY(-2px)',
                  },
                  transition: 'all 0.3s ease',
                }}
              >
                View My Trades
              </Button>
            )}
            {!loading && isAuthorized && !(role === 'member' && hideLeaderboardFromMembers) && (
              <Button
                variant="outlined"
                size="large"
                component={Link}
                href="/leaderboard"
                sx={{
                  borderColor: companyBranding?.primaryColor || theme.palette.primary.main,
                  borderWidth: 2,
                  color: companyBranding?.primaryColor || theme.palette.primary.main,
                  px: 5,
                  py: 1.75,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  textTransform: 'none',
                  backgroundColor: (() => {
                    const primary = companyBranding?.primaryColor || theme.palette.primary.main;
                    return theme.palette.mode === 'dark' ? 'transparent' : alpha(primary, 0.08);
                  })(),
                  boxShadow: (() => {
                    const primary = companyBranding?.primaryColor || theme.palette.primary.main;
                    return theme.palette.mode === 'dark'
                      ? `0 0 20px ${alpha(primary, 0.2)}`
                      : `0 0 20px ${alpha(primary, 0.12)}`;
                  })(),
                  '&:hover': {
                    borderColor: (() => {
                      const primary = companyBranding?.primaryColor || theme.palette.primary.main;
                      const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(primary);
                      if (rgb) {
                        const r = Math.round(parseInt(rgb[1], 16) + (255 - parseInt(rgb[1], 16)) * 0.2);
                        const g = Math.round(parseInt(rgb[2], 16) + (255 - parseInt(rgb[2], 16)) * 0.2);
                        const b = Math.round(parseInt(rgb[3], 16) + (255 - parseInt(rgb[3], 16)) * 0.2);
                        return `rgb(${r}, ${g}, ${b})`;
                      }
                      return theme.palette.primary.light;
                    })(),
                    borderWidth: 2,
                    backgroundColor: (() => {
                      const primary = companyBranding?.primaryColor || theme.palette.primary.main;
                      return alpha(primary, 0.1);
                    })(),
                    transform: 'translateY(-2px)',
                    color: (() => {
                      const primary = companyBranding?.primaryColor || theme.palette.primary.main;
                      const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(primary);
                      if (rgb) {
                        const r = Math.round(parseInt(rgb[1], 16) + (255 - parseInt(rgb[1], 16)) * 0.2);
                        const g = Math.round(parseInt(rgb[2], 16) + (255 - parseInt(rgb[2], 16)) * 0.2);
                        const b = Math.round(parseInt(rgb[3], 16) + (255 - parseInt(rgb[3], 16)) * 0.2);
                        return `rgb(${r}, ${g}, ${b})`;
                      }
                      return theme.palette.primary.light;
                    })(),
                    boxShadow: (() => {
                      const primary = companyBranding?.primaryColor || theme.palette.primary.main;
                      return `0 0 30px ${alpha(primary, 0.3)}`;
                    })(),
                  },
                  transition: 'all 0.3s ease',
                }}
              >
                View Leaderboard
              </Button>
            )}
          </Box>
        </motion.div>
      </Container>
    </Box>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Typography variant="h1" sx={{ textAlign: 'center' }}>
          Loading...
        </Typography>
      </Container>
    }>
      <HomeContent />
    </Suspense>
  );
}

