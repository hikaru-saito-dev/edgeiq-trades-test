'use client';

import { Container, Typography, Box, Button } from '@mui/material';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAccess, setExperienceId } from '@/components/AccessProvider';
import { useBranding } from '@/components/BrandingProvider';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { alpha } from '@mui/material/styles';

function HomeContent() {
  const searchParams = useSearchParams();
  const experienceId = searchParams?.get('experience') || null;
  const { isAuthorized, loading, role, hideLeaderboardFromMembers } = useAccess();
  const { palette, appName } = useBranding();
  const displayAppName = appName?.trim() || 'EdgeIQ Trades';

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
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 30% 30%, rgba(80,80,80,0.2), transparent 40%), radial-gradient(circle at 70% 70%, rgba(80,80,80,0.15), transparent 45%)',
            opacity: 0.8,
          }}
        />
        <Box
          sx={{
            position: 'relative',
            width: 160,
            height: 160,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: 'conic-gradient(#0f172a, #22c55e, #0ea5e9, #0f172a)',
              animation: 'spin 2.8s linear infinite',
              filter: 'drop-shadow(0 0 24px rgba(34,197,94,0.45))',
              mask: 'radial-gradient(farthest-side, transparent 55%, black 60%)',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              width: '65%',
              height: '65%',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, rgba(34,197,94,0.22), rgba(15,118,110,0.22))',
              boxShadow: '0 0 30px rgba(34,197,94,0.25) inset, 0 0 12px rgba(14,165,233,0.25)',
              filter: 'blur(0.3px)',
            }}
          />
          <Typography
            variant="h6"
            sx={{
              position: 'relative',
              color: '#e5e7eb',
              fontWeight: 600,
              letterSpacing: 0.4,
            }}
          >
            Verifying access…
          </Typography>
        </Box>
        <style jsx global>{`
          @keyframes spin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
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
        background: theme.palette.mode === 'dark'
          ? palette.gradients.backgroundGradientDark
          : palette.gradients.backgroundGradient,
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
              ${alpha(palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.12)} 20px,
              ${alpha(palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.12)} 22px
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
            radial-gradient(ellipse at 20% 50%, ${alpha(palette.primary.main, 0.25)} 0%, transparent 50%),
            radial-gradient(ellipse at 50% 30%, ${alpha(palette.primary.main, 0.2)} 0%, transparent 50%),
            radial-gradient(ellipse at 80% 60%, ${alpha(palette.primary.main, 0.15)} 0%, transparent 50%)
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
            background: `linear-gradient(90deg, transparent, ${alpha(palette.primary.main, 0.6)} 20%, ${alpha(palette.primary.main, 0.8)} 50%, ${alpha(palette.primary.main, 0.6)} 80%, transparent)`,
            filter: 'blur(3px)',
            boxShadow: `0 0 20px ${alpha(palette.primary.main, 0.6)}`,
            animation: 'wave 8s ease-in-out infinite',
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            bottom: '15%',
            left: 0,
            right: 0,
            height: '2px',
            background: `linear-gradient(90deg, transparent, ${alpha(palette.primary.main, 0.5)} 25%, ${alpha(palette.primary.main, 0.7)} 50%, ${alpha(palette.primary.main, 0.5)} 75%, transparent)`,
            filter: 'blur(2px)',
            boxShadow: `0 0 15px ${alpha(palette.primary.main, 0.5)}`,
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
              color: palette.primary.main,
              lineHeight: 1.1,
              textShadow: `0 0 20px ${alpha(palette.primary.main, 0.5)}, 0 0 40px ${alpha(palette.primary.main, 0.3)}`,
            }}
          >
            {displayAppName}
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
              color: (theme) =>
                theme.palette.mode === 'dark' ? '#a7f3d0' : theme.palette.text.secondary,
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
                  background: palette.gradients.buttonGradient,
                  color: 'white',
                  px: 5,
                  py: 1.75,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  borderRadius: 3,
                  boxShadow: `0 8px 24px ${palette.shadows.medium}`,
                  textTransform: 'none',
                  '&:hover': {
                    background: `linear-gradient(135deg, ${palette.primary.dark} 0%, ${palette.secondary.dark} 100%)`,
                    boxShadow: `0 12px 32px ${palette.shadows.strong}`,
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
                  borderColor: palette.secondary.dark,
                  borderWidth: 2,
                  color: palette.secondary.dark,
                  px: 5,
                  py: 1.75,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  textTransform: 'none',
                  backgroundColor: (theme) =>
                    theme.palette.mode === 'dark' ? 'transparent' : palette.primary.alpha10,
                  boxShadow: (theme) =>
                    theme.palette.mode === 'dark'
                      ? `0 0 20px ${palette.shadows.medium}`
                      : `0 0 20px ${palette.shadows.light}`,
                  '&:hover': {
                    borderColor: palette.secondary.light,
                    borderWidth: 2,
                    backgroundColor: palette.primary.alpha20,
                    transform: 'translateY(-2px)',
                    color: palette.secondary.light,
                    boxShadow: `0 0 30px ${palette.shadows.medium}`,
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

