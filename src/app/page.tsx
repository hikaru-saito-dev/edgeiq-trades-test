'use client';

import { Container, Typography, Box, Button } from '@mui/material';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAccess, setExperienceId } from '@/components/AccessProvider';
import { useBranding } from '@/components/BrandingProvider';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { alpha } from '@mui/material/styles';

function LoadingOrbitSpinner() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const logicalSize = 320;
    canvas.width = logicalSize * dpr;
    canvas.height = logicalSize * dpr;
    canvas.style.width = `${logicalSize}px`;
    canvas.style.height = `${logicalSize}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Offscreen buffer for true multi-pass additive bloom
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = logicalSize * dpr;
    glowCanvas.height = logicalSize * dpr;
    const glowCtx = glowCanvas.getContext('2d');
    if (!glowCtx) return;
    glowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const center = logicalSize / 2;
    const baseRadius = 90; // base path radius
    const rings = [
      { r: baseRadius - 15 },
      { r: baseRadius },
      { r: baseRadius + 15 },
      { r: baseRadius + 30 },
    ];

    // Multiple comets across 2–3 rings to match the reference density
    const comets = [
      // outer ring
      { ring: 0, phase: 0.50, speed: 1, tail: 3 },
      { ring: 1, phase: 0.40, speed: 0.9, tail: 3 },
      { ring: 2, phase: 0.30, speed: 0.8, tail: 3 },
      { ring: 3, phase: 0.20, speed: 0.7, tail: 3 },
      // middle ring
      // { ring: 0, phase: 1, speed: 0.3, tail: 3 },
      // { ring: 1, phase: 0.90, speed: 0.3, tail: 3 },
      // { ring: 2, phase: 0.80, speed: 0.3, tail: 3 },
      // { ring: 3, phase: 0.70, speed: 0.3, tail: 3 },
      // inner ring
    ];

    const start = performance.now();
    let frameId: number;

    const TAU = Math.PI * 2;

    const drawComet = (c: CanvasRenderingContext2D, r: number, angle: number, tailLen: number) => {
      // Smooth tail: single continuous arc (no per-segment dots)
      const tailStart = angle - tailLen;
      const tailEnd = angle;

      // outer glow stroke
      c.save();
      c.globalAlpha = 0.75;
      c.beginPath();
      c.arc(0, 0, r, tailStart, tailEnd);
      c.lineWidth = 4.6;
      c.lineCap = 'round';
      const gx0 = Math.cos(tailStart) * r;
      const gy0 = Math.sin(tailStart) * r;
      const gx1 = Math.cos(tailEnd) * r;
      const gy1 = Math.sin(tailEnd) * r;
      const gradOuter = c.createLinearGradient(gx0, gy0, gx1, gy1);
      gradOuter.addColorStop(0, 'rgba(56,189,248,0.0)');
      gradOuter.addColorStop(0.35, 'rgba(56,189,248,0.26)');
      gradOuter.addColorStop(1, 'rgba(56,189,248,0.85)');
      c.strokeStyle = gradOuter;
      c.shadowBlur = 24;
      c.shadowColor = 'rgba(56,189,248,0.85)';
      c.stroke();
      c.restore();

      // inner core stroke
      c.save();
      c.globalAlpha = 0.75;
      c.beginPath();
      c.arc(0, 0, r, tailStart, tailEnd);
      c.lineWidth = 1.7;
      c.lineCap = 'round';
      const gradInner = c.createLinearGradient(gx0, gy0, gx1, gy1);
      gradInner.addColorStop(0, 'rgba(191,219,254,0.0)');
      gradInner.addColorStop(0.45, 'rgba(191,219,254,0.42)');
      gradInner.addColorStop(1, 'rgba(191,219,254,0.8)');
      c.strokeStyle = gradInner;
      c.shadowBlur = 9;
      c.shadowColor = 'rgba(191,219,254,0.7)';
      c.stroke();
      c.restore();

      // Head: bright nucleus + glow
      const hx = Math.cos(angle) * r;
      const hy = Math.sin(angle) * r;

      c.save();
      const g = c.createRadialGradient(hx, hy, 0, hx, hy, 13);
      g.addColorStop(0, 'rgba(219,234,254,1)');
      g.addColorStop(0.25, 'rgba(56,189,248,1)');
      g.addColorStop(0.6, 'rgba(37,99,235,0.55)');
      g.addColorStop(1, 'rgba(37,99,235,0)');
      c.fillStyle = g;
      c.shadowBlur = 44;
      c.shadowColor = 'rgba(56,189,248,1)';
      c.beginPath();
      c.arc(hx, hy, 8.8, 0, TAU);
      c.fill();
      c.restore();
    };

    const render = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, logicalSize, logicalSize);

      // 1) Draw crisp scene into glow buffer (no blur)
      glowCtx.clearRect(0, 0, logicalSize, logicalSize);
      glowCtx.save();
      glowCtx.translate(center, center);
      glowCtx.globalCompositeOperation = 'source-over';
      comets.forEach((c) => {
        const ring = rings[c.ring];
        const a = t * c.speed * TAU + c.phase * TAU;
        drawComet(glowCtx, ring.r, a, c.tail);
      });
      glowCtx.restore();

      // 2) Composite multiple blurred additive passes for true bloom
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, logicalSize, logicalSize);

      // bloom pass (large blur)
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.52;
      ctx.filter = 'blur(14px)';
      ctx.drawImage(glowCanvas, 0, 0, logicalSize, logicalSize);

      // bloom pass (medium blur)
      ctx.globalAlpha = 0.7;
      ctx.filter = 'blur(6px)';
      ctx.drawImage(glowCanvas, 0, 0, logicalSize, logicalSize);

      // bloom pass (small blur)
      ctx.globalAlpha = 0.85;
      ctx.filter = 'blur(2px)';
      ctx.drawImage(glowCanvas, 0, 0, logicalSize, logicalSize);

      // 3) Crisp top layer (no blur) for sharp heads/tails
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      ctx.drawImage(glowCanvas, 0, 0, logicalSize, logicalSize);
      ctx.restore();

      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <Box
      sx={{
        width: 220,
        height: 220,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas ref={canvasRef} />
    </Box>
  );
}

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
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LoadingOrbitSpinner />
          <Typography
            variant="h6"
            sx={{
              position: 'relative',
              color: '#e5e7eb',
              fontWeight: 600,
              letterSpacing: 0.4,
            }}
          >
            Verifying access
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                width: '0ch',
                verticalAlign: 'bottom',
                '&::after': {
                  content: '"..."',
                },
                animation: 'ellipsis 1.2s steps(3,end) infinite',
              }}
            />
          </Typography>
        </Box>
        <style jsx global>{`
          @keyframes ellipsis {
            0% {
              width: 0ch;
            }
            33% {
              width: 1ch;
            }
            66% {
              width: 2ch;
            }
            100% {
              width: 3ch;
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
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LoadingOrbitSpinner />
          <Typography
            variant="h6"
            sx={{
              position: 'relative',
              color: '#e5e7eb',
              fontWeight: 600,
              letterSpacing: 0.4,
            }}
          >
            Verifying access
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                width: '0ch',
                verticalAlign: 'bottom',
                '&::after': {
                  content: '"..."',
                },
                animation: 'ellipsis 1.2s steps(3,end) infinite',
              }}
            />
          </Typography>
        </Box>
        <style jsx global>{`
          @keyframes ellipsis {
            0% {
              width: 0ch;
            }
            33% {
              width: 1ch;
            }
            66% {
              width: 2ch;
            }
            100% {
              width: 3ch;
            }
          }
        `}</style>
      </Box>
    }>
      <HomeContent />
    </Suspense>
  );
}

