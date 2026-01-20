'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  IconButton,
  Button,
  Container,
  Skeleton,
  Tooltip,
  Paper,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import { apiRequest } from '@/lib/apiClient';
import { useAccess } from '@/components/AccessProvider';
import { useBranding } from '@/components/BrandingProvider';

type CalendarDay = {
  date: string;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
};

type CalendarResponse = {
  days: CalendarDay[];
  totalPnl: number;
  totalTrades: number;
  scope: 'personal' | 'company';
};

type WeeklySummary = {
  totalPnl: number;
  totalTrades: number;
  weekIndex: number;
};

/**
 * Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday) in America/New_York timezone
 */
function getDayOfWeekInNY(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  });
  const weekday = formatter.format(date);
  const dayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return dayMap[weekday] ?? 0;
}

function buildCalendar(days: CalendarDay[], monthAnchor: Date) {
  const byDate = new Map<string, CalendarDay>();
  days.forEach((d) => byDate.set(d.date, d));

  // Create dates representing the first and last day of the month in America/New_York timezone
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();

  // Get start of month in NY timezone
  const startOfMonthStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(year, month, 1));

  const [startMonth, startDay, startYear] = startOfMonthStr.split('/').map(Number);
  const startOfMonth = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0));

  // Get end of month in NY timezone
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endOfMonthStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(year, month, lastDay));

  const [endMonth, endDay, endYear] = endOfMonthStr.split('/').map(Number);
  const endOfMonth = new Date(Date.UTC(endYear, endMonth - 1, endDay, 0, 0, 0));

  // Grid starts Sunday - go back to the previous Sunday
  const startOfGrid = new Date(startOfMonth);
  const dayOfWeek = getDayOfWeekInNY(startOfGrid);
  startOfGrid.setUTCDate(startOfGrid.getUTCDate() - dayOfWeek);

  // Grid ends Saturday - go forward to the next Saturday
  const endOfGrid = new Date(endOfMonth);
  const endDayOfWeek = getDayOfWeekInNY(endOfGrid);
  endOfGrid.setUTCDate(endOfGrid.getUTCDate() + (6 - endDayOfWeek));

  const weeks: { weekOf: string; days: Array<{ date: string; data?: CalendarDay }> }[] = [];
  const cursor = new Date(startOfGrid);
  while (cursor.getTime() <= endOfGrid.getTime()) {
    const weekDays: Array<{ date: string; data?: CalendarDay }> = [];
    for (let i = 0; i < 7; i += 1) {
      // Format date as YYYY-MM-DD in America/New_York timezone
      const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(cursor);
      weekDays.push({ date: dateStr, data: byDate.get(dateStr) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push({ weekOf: weekDays[0].date, days: weekDays });
  }

  // Filter weeks: only include weeks that have at least one day in the current month (NY time)
  const filteredWeeks = weeks.filter((week) => {
    return week.days.some((d) => {
      const [year, month, dayNum] = d.date.split('-').map(Number);
      const dateObj = new Date(Date.UTC(year, month - 1, dayNum, 12, 0, 0));
      const dateInNY = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: 'numeric',
      }).format(dateObj);
      const [nyMonth, nyYear] = dateInNY.split('/').map(Number);
      return nyMonth === monthAnchor.getMonth() + 1 && nyYear === monthAnchor.getFullYear();
    });
  });
  return filteredWeeks;
}

export default function StatsCalendarPage() {
  const { userId, companyId, role, hideCompanyStatsFromMembers } = useAccess();
  const theme = useTheme();
  const { palette } = useBranding();
  const isDark = theme.palette.mode === 'dark';

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [scope, setScope] = useState<'personal' | 'company'>('personal');
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const fetchData = async (monthAnchor: Date, nextScope: 'personal' | 'company') => {
    setLoading(true);
    setError(null);
    try {
      const start = new Date(monthAnchor);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(monthAnchor);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);

      const res = await apiRequest(
        `/api/stats/calendar?scope=${nextScope}&start=${startStr}&end=${endStr}`,
        { userId, companyId }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || 'Failed to load stats');
        setData(null);
      } else {
        setData(json as CalendarResponse);
      }
    } catch {
      setError('Failed to load stats');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(currentMonth, scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, scope, userId, companyId]);

  // Close tooltip when clicking anywhere on the page (including empty cells)
  useEffect(() => {
    const handleClickAnywhere = (event: MouseEvent) => {
      // Check if click is on the tooltip itself - don't close in that case
      const target = event.target as HTMLElement;
      if (target.closest('[role="tooltip"]')) {
        return;
      }
      // Close tooltip when clicking anywhere, including empty calendar cells
      if (openTooltip) {
        setOpenTooltip(null);
      }
    };

    // Add click listener to document when tooltip is open
    if (openTooltip) {
      // Use setTimeout to avoid immediate closure on the click that opened it
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickAnywhere, true);
      }, 100);

      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('click', handleClickAnywhere, true);
      };
    }
  }, [openTooltip]);

  const weeks = useMemo(() => buildCalendar(data?.days || [], currentMonth), [data, currentMonth]);

  // Pre-compute weekly summaries so Saturdays can show a weekly recap
  const weeklySummaries = useMemo(() => {
    if (!weeks.length || !data?.days?.length) return {} as Record<string, WeeklySummary>;

    const dayMap = new Map<string, CalendarDay>();
    data.days.forEach((d) => dayMap.set(d.date, d));

    const summaries: Record<string, WeeklySummary> = {};
    let weekNumber = 0; // Track week number for current month only

    weeks.forEach((week) => {
      let totalPnl = 0;
      let totalTrades = 0;
      let hasDaysInCurrentMonth = false;

      week.days.forEach((day) => {
        // Parse date string (YYYY-MM-DD) and check month in NY timezone
        const [year, month, dayNum] = day.date.split('-').map(Number);
        const dayDate = new Date(Date.UTC(year, month - 1, dayNum, 12, 0, 0));
        const dateInNY = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: 'numeric',
        }).format(dayDate);
        const [nyMonth, nyYear] = dateInNY.split('/').map(Number);
        const isInCurrentMonth =
          nyMonth === currentMonth.getMonth() + 1 &&
          nyYear === currentMonth.getFullYear();

        if (isInCurrentMonth) {
          hasDaysInCurrentMonth = true;
          const dayData = dayMap.get(day.date);
          if (dayData) {
            totalPnl += dayData.netPnl;
            totalTrades += dayData.trades;
          }
        }
      });

      // Only assign week number if this week has days in the current month
      if (hasDaysInCurrentMonth) {
        weekNumber += 1;
        summaries[week.weekOf] = {
          totalPnl,
          totalTrades,
          weekIndex: weekNumber,
        };
      }
    });

    return summaries;
  }, [weeks, data, currentMonth]);

  const pnlColor = (val: number) =>
    val >= 0 ? theme.palette.success.main : theme.palette.error.main;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1, sm: 2 } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          flexWrap="wrap"
          gap={1.5}
        >
          <Box display="flex" alignItems="center" gap={1.25} flexWrap="wrap">
            <Typography variant="h5" fontWeight={700} sx={{
              background: palette.gradients.primaryToSecondary,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: { xs: '1.75rem', sm: '2.125rem' },
            }}>
              Performance Calendar
            </Typography>
            {(() => {
              const showScopeToggle =
                role === 'companyOwner' || role === 'owner' || (!hideCompanyStatsFromMembers && (role === 'admin' || role === 'member'));
              if (!showScopeToggle) return null;
              return (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={scope}
                  onChange={(_, val) => val && setScope(val)}
                >
                  <ToggleButton value="personal">Personal</ToggleButton>
                  <ToggleButton value="company">Company</ToggleButton>
                </ToggleButtonGroup>
              );
            })()}
            <Box
              display="flex"
              alignItems="center"
              gap={0.5}
              flexWrap="wrap"
              sx={{
                px: 1,
                py: 0.25,
              }}
            >
              <IconButton
                size="small"
                onClick={() => {
                  const next = new Date(currentMonth);
                  next.setMonth(next.getMonth() - 1);
                  setCurrentMonth(next);
                }}
                sx={{ color: 'inherit' }}
              >
                <ArrowBackIosNewIcon fontSize="small" />
              </IconButton>
              <Typography
                variant="subtitle1"
                fontWeight={700}
                sx={{ minWidth: 140, textAlign: 'center', px: 0.75 }}
              >
                {currentMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
              </Typography>
              <IconButton
                size="small"
                onClick={() => {
                  const next = new Date(currentMonth);
                  next.setMonth(next.getMonth() + 1);
                  setCurrentMonth(next);
                }}
                sx={{ color: 'inherit' }}
              >
                <ArrowForwardIosIcon fontSize="small" />
              </IconButton>
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() => {
                  const today = new Date();
                  today.setDate(1);
                  today.setHours(0, 0, 0, 0);
                  setCurrentMonth(today);
                }}
                sx={{ borderRadius: 999, textTransform: 'none', px: 1.5, py: 0.5 }}
              >
                Today
              </Button>
            </Box>
          </Box>
          {data && (
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
              <Chip
                label={`P&L ${data.totalPnl >= 0 ? '+' : ''}$${data.totalPnl.toFixed(2)}`}
                sx={{ background: alpha(pnlColor(data.totalPnl), 0.15), color: pnlColor(data.totalPnl) }}
              />
              <Chip label={`Trades ${data.totalTrades}`} />
            </Box>
          )}
        </Box>

        <Card
          sx={{
            border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.12 : 0.1)}`,
            background: 'var(--surface-bg)',
            borderRadius: 1,
            boxShadow: 'none',
          }}
        >
          <CardContent>
            {loading && (
              <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <Skeleton
                      key={d}
                      variant="text"
                      width="100%"
                      height={20}
                      sx={{ bgcolor: 'rgba(45, 80, 61, 0.1)', display: { xs: 'none', md: 'block' } }}
                    />
                  ))}
                </Box>
                <Box
                  display="grid"
                  gridTemplateColumns={{
                    xs: 'repeat(7, minmax(0, 1fr))',
                    sm: 'repeat(7, minmax(0, 1fr))',
                    md: 'repeat(7, minmax(0, 1fr))',
                  }}
                >
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Box
                      key={i}
                      sx={{
                        p: { xs: 0.4, sm: 0.6, md: 0.75 },
                        borderRadius: 0,
                        minHeight: { xs: 60, sm: 80, md: 110 },
                        border: '1px solid var(--surface-border)',
                      }}
                    >
                      <Skeleton variant="text" width="60%" height={16} sx={{ bgcolor: 'rgba(45, 80, 61, 0.1)', mb: 1 }} />
                      <Skeleton variant="text" width="80%" height={24} sx={{ bgcolor: 'rgba(45, 80, 61, 0.1)', mb: 0.5 }} />
                      <Skeleton variant="text" width="50%" height={16} sx={{ bgcolor: 'rgba(45, 80, 61, 0.05)' }} />
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
            {error && (
              <Typography color="error" textAlign="center">
                {error}
              </Typography>
            )}

            {!loading && !error && weeks.length > 0 && (
              <Box
                display="grid"
                gridTemplateColumns={{
                  xs: 'repeat(7, minmax(0, 1fr))',
                  sm: 'repeat(7, minmax(0, 1fr))',
                  md: 'repeat(7, minmax(0, 1fr))',
                }}
              >
                {/* Grid starts Sunday */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <Typography
                    key={d}
                    variant="caption"
                    textAlign="center"
                    sx={{ color: 'text.secondary', display: { xs: 'none', md: 'block' } }}
                  >
                    {d}
                  </Typography>
                ))}
                {weeks.map((week) =>
                  week.days.map((d) => {
                    const pnl = d.data?.netPnl ?? 0;
                    const trades = d.data?.trades ?? 0;
                    // Parse date string (YYYY-MM-DD) as NY timezone date
                    const [year, month, day] = d.date.split('-').map(Number);
                    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // Use noon UTC to avoid timezone edge cases
                    const isSaturday = getDayOfWeekInNY(dateObj) === 6;
                    // Check if date is in current month using NY timezone
                    const dateInNY = new Intl.DateTimeFormat('en-US', {
                      timeZone: 'America/New_York',
                      year: 'numeric',
                      month: 'numeric',
                    }).format(dateObj);
                    const [nyMonth, nyYear] = dateInNY.split('/').map(Number);
                    const isCurrentMonth =
                      nyMonth === currentMonth.getMonth() + 1 &&
                      nyYear === currentMonth.getFullYear();
                    const weekSummary = weeklySummaries[week.weekOf];
                    const hasWeeklyRecap =
                      isSaturday &&
                      isCurrentMonth &&
                      weekSummary &&
                      typeof weekSummary.totalTrades === 'number' &&
                      weekSummary.totalTrades > 0;
                    const effectivePnl = hasWeeklyRecap ? weekSummary.totalPnl : pnl;
                    const isEmpty = !d.data && !hasWeeklyRecap;
                    const muted = !isCurrentMonth;
                    // Check if today in NY timezone
                    const todayInNY = new Date();
                    const isToday = d.date === todayInNY.toLocaleDateString('en-CA', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    });

                    // Prepare tooltip content
                    const tooltipContent = isEmpty ? null : hasWeeklyRecap && weekSummary ? (
                      <Paper sx={{ p: 1.5, maxWidth: 250 }}>
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                          Week {weekSummary.weekIndex} Summary
                        </Typography>
                        <Typography variant="body2" sx={{ color: pnlColor(weekSummary.totalPnl), fontWeight: 600, mb: 0.5 }}>
                          P&L: {weekSummary.totalPnl >= 0 ? '+' : ''}${weekSummary.totalPnl.toFixed(2)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Total Trades: {weekSummary.totalTrades}
                        </Typography>
                      </Paper>
                    ) : d.data ? (
                      <Paper sx={{ p: 1.5, maxWidth: 250 }}>
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                          {dateObj.toLocaleDateString(undefined, {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </Typography>
                        <Typography variant="body2" sx={{ color: pnlColor(pnl), fontWeight: 600, mb: 0.5 }}>
                          P&L: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                          Trades: {trades}
                        </Typography>
                        {d.data.wins !== undefined && d.data.losses !== undefined && (
                          <Typography variant="body2" color="text.secondary" fontSize="0.75rem">
                            Wins: {d.data.wins} | Losses: {d.data.losses}
                          </Typography>
                        )}
                      </Paper>
                    ) : null;

                    const isTooltipOpen = openTooltip === d.date;

                    return (
                      <Tooltip
                        key={d.date}
                        title={tooltipContent || ''}
                        arrow
                        open={isTooltipOpen && !isEmpty}
                        onClose={() => setOpenTooltip(null)}
                        disableHoverListener
                        disableFocusListener
                        disableTouchListener
                        placement="top"
                        componentsProps={{
                          tooltip: {
                            sx: {
                              bgcolor: 'var(--surface-bg)',
                              border: '1px solid var(--surface-border)',
                              p: 0,
                              maxWidth: 300,
                            },
                          },
                        }}
                      >
                        <Box
                          data-calendar-cell
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isEmpty) {
                              // Toggle tooltip for cells with data
                              setOpenTooltip(isTooltipOpen ? null : d.date);
                            } else {
                              // Close tooltip when clicking empty cells
                              setOpenTooltip(null);
                            }
                          }}
                          sx={{
                            p: { xs: 0.4, sm: 0.6, md: 0.75 },
                            borderRadius: 0,
                            minHeight: { xs: 60, sm: 80, md: 110 },
                            border: `1px solid ${isToday
                              ? alpha(theme.palette.primary.main, 0.8)
                              : alpha(theme.palette.divider, 0.35)
                              }`,
                            backgroundColor: isEmpty
                              ? alpha(theme.palette.background.default, isDark ? 0.55 : 0.09)
                              : effectivePnl > 0
                                ? alpha(theme.palette.success.main, 0.2)
                                : effectivePnl < 0
                                  ? alpha(theme.palette.error.main, 0.25)
                                  : alpha(theme.palette.background.default, isDark ? 0.55 : 0.09),
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center',
                            gap: 0.35,
                            opacity: muted ? 0.45 : 1,
                            boxShadow: 'none',
                            cursor: isEmpty ? 'default' : 'pointer',
                            userSelect: 'none',
                            WebkitTapHighlightColor: 'transparent',
                            '&:active': isEmpty ? {} : {
                              transform: 'scale(0.98)',
                              transition: 'transform 0.1s',
                            },
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              color: muted ? 'text.disabled' : 'text.secondary',
                              fontWeight: 700,
                              fontSize: { xs: 10, sm: 11, md: 12 },
                              alignSelf: 'center',
                            }}
                          >
                            {dateObj.toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </Typography>
                          {!isEmpty ? (
                            <Box
                              sx={{
                                flexGrow: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                gap: 0.7,
                                width: '100%',
                              }}
                            >
                              {hasWeeklyRecap && weekSummary ? (
                                <>
                                  <Typography
                                    variant="subtitle2"
                                    sx={{
                                      color: pnlColor(weekSummary.totalPnl),
                                      fontWeight: 900,
                                      lineHeight: 1.15,
                                      fontSize: { xs: 14, sm: 16, md: 18 },
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      width: '100%',
                                    }}
                                  >
                                    {weekSummary.totalPnl >= 0 ? '+' : '-'}$
                                    {Math.abs(weekSummary.totalPnl).toFixed(2)}
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      color: muted ? 'text.disabled' : 'text.secondary',
                                      fontSize: { xs: 9, sm: 10, md: 11 },
                                      fontWeight: 700,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      width: '100%',
                                    }}
                                  >
                                    Week {weekSummary.weekIndex}
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      color: muted ? 'text.disabled' : 'text.secondary',
                                      fontSize: { xs: 9, sm: 10, md: 11 },
                                      fontWeight: 600,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      width: '100%',
                                    }}
                                  >
                                    {weekSummary.totalTrades} trade
                                    {weekSummary.totalTrades === 1 ? '' : 's'}
                                  </Typography>
                                </>
                              ) : (
                                <>
                                  <Typography
                                    variant="subtitle2"
                                    sx={{
                                      color: pnlColor(pnl),
                                      fontWeight: 900,
                                      lineHeight: 1.15,
                                      fontSize: { xs: 16, sm: 18, md: 20 },
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      width: '100%',
                                    }}
                                  >
                                    {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      color: muted ? 'text.disabled' : 'text.secondary',
                                      fontSize: { xs: 10, sm: 11, md: 12 },
                                      fontWeight: 600,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      width: '100%',
                                    }}
                                  >
                                    {trades} trade{trades === 1 ? '' : 's'}
                                  </Typography>
                                </>
                              )}
                            </Box>
                          ) : (
                            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Typography variant="body2" sx={{ color: muted ? 'text.disabled' : 'text.disabled' }}>
                                &nbsp;
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      </Tooltip>
                    );
                  })
                )}
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}
