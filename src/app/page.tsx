'use client';

import { Container, Typography, Box, Button, CircularProgress } from '@mui/material';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAccess, setExperienceId } from '@/components/AccessProvider';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useCompanyTheme } from '@/components/CompanyThemeProvider';

function HomeContent() {
  const searchParams = useSearchParams();
  const experienceId = searchParams?.get('experience') || null;
  const { isAuthorized, loading, role, hideLeaderboardFromMembers } = useAccess();
  const companyTheme = useCompanyTheme();

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
        background:
          theme.palette.mode === 'dark'
            ? companyTheme.palette.gradients.backgroundGradientDark
            : companyTheme.palette.gradients.backgroundGradient,
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
              ${companyTheme.palette.primary.alpha20} 20px,
              ${companyTheme.palette.primary.alpha20} 22px
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
            radial-gradient(ellipse at 20% 50%, ${companyTheme.palette.primary.alpha30} 0%, transparent 50%),
            radial-gradient(ellipse at 50% 30%, ${companyTheme.palette.primary.alpha20} 0%, transparent 50%),
            radial-gradient(ellipse at 80% 60%, ${companyTheme.palette.primary.alpha10} 0%, transparent 50%)
          `,
          zIndex: 0,
          animation: 'pulse 4s ease-in-out infinite',
          opacity: theme.palette.mode === 'dark' ? 1 : 0.8,
        },
      })}
    >
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
            background:
              'linear-gradient(90deg, transparent, rgba(34, 197, 94, 0.6) 20%, rgba(34, 197, 94, 0.8) 50%, rgba(34, 197, 94, 0.6) 80%, transparent)',
            filter: 'blur(3px)',
            boxShadow: '0 0 20px rgba(34, 197, 94, 0.6)',
            animation: 'wave 8s ease-in-out infinite',
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            bottom: '15%',
            left: 0,
            right: 0,
            height: '2px',
            background:
              'linear-gradient(90deg, transparent, rgba(34, 197, 94, 0.5) 25%, rgba(34, 197, 94, 0.7) 50%, rgba(34, 197, 94, 0.5) 75%, transparent)',
            filter: 'blur(2px)',
            boxShadow: '0 0 15px rgba(34, 197, 94, 0.5)',
            animation: 'wave 10s ease-in-out infinite reverse',
          },
        }}
      />

      <Container maxWidth="md" sx={{ position: 'relative', zIndex: 1, px: { xs: 2, sm: 3 } }}>
        <motion.div
          initial={{ opacity: 0, y: -30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, type: 'spring', stiffness: 100 }}
        >
          <Typography
            variant="h1"
            component="h1"
            sx={{
              textAlign: 'center',
              mb: 3,
              fontSize: { xs: '3rem', sm: '4rem', md: '5rem' },
              fontWeight: 800,
              color: companyTheme.palette.primary.main,
              lineHeight: 1.1,
              textShadow: `0 0 20px ${companyTheme.palette.primary.alpha50}, 0 0 40px ${companyTheme.palette.primary.alpha30}`,
            }}
          >
            {companyTheme.appTitle}
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
              color: companyTheme.palette.text.secondary,
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
                  background: companyTheme.palette.gradients.buttonGradient,
                  color: 'white',
                  px: 5,
                  py: 1.75,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  borderRadius: 3,
                  boxShadow: `0 8px 24px ${companyTheme.palette.shadows.medium}`,
                  textTransform: 'none',
                  '&:hover': {
                    background: companyTheme.palette.gradients.primaryToSecondary,
                    boxShadow: `0 12px 32px ${companyTheme.palette.shadows.strong}`,
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
                  borderColor: companyTheme.palette.primary.main,
                  borderWidth: 2,
                  color: companyTheme.palette.primary.main,
                  px: 5,
                  py: 1.75,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  textTransform: 'none',
                  backgroundColor: (theme) =>
                    theme.palette.mode === 'dark' ? 'transparent' : companyTheme.palette.primary.alpha10,
                  boxShadow: `0 0 20px ${companyTheme.palette.shadows.light}`,
                  '&:hover': {
                    borderColor: companyTheme.palette.primary.light,
                    borderWidth: 2,
                    backgroundColor: companyTheme.palette.primary.alpha20,
                    transform: 'translateY(-2px)',
                    color: companyTheme.palette.primary.light,
                    boxShadow: `0 0 30px ${companyTheme.palette.shadows.medium}`,
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
    <Suspense
      fallback={
        <Container maxWidth="lg" sx={{ py: 8 }}>
          <Typography variant="h1" sx={{ textAlign: 'center' }}>
            Loading...
          </Typography>
        </Container>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
