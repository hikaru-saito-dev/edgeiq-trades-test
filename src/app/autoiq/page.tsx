'use client';

import { Container, Box, Typography, Paper, Radio, RadioGroup, FormControlLabel, FormControl, FormLabel, Button, CircularProgress, Alert, Select, MenuItem, InputLabel } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useState, useEffect, useCallback } from 'react';
import { useAccess } from '@/components/AccessProvider';
import { useToast } from '@/components/ToastProvider';
import { apiRequest } from '@/lib/apiClient';

interface BrokerAccount {
    id: string;
    brokerName: string;
    accountName: string;
    accountNumber?: string;
    buyingPower?: number;
}

export default function AutoIQPage() {
    const theme = useTheme();
    const { isAuthorized, userId, companyId, hasAutoIQ, loading: accessLoading } = useAccess();
    const toast = useToast();
    const [autoTradeMode, setAutoTradeMode] = useState<'auto-trade' | 'notify-only'>('notify-only');
    const [defaultBrokerConnectionId, setDefaultBrokerConnectionId] = useState<string | null>(null);
    const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccount[]>([]);
    const [loadingBrokers, setLoadingBrokers] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [upgradeUrl, setUpgradeUrl] = useState<string>('https://whop.com/checkout/');

    const fetchCheckoutUrl = useCallback(async () => {
        try {
            const response = await apiRequest('/api/autoiq/checkout', { userId, companyId });
            if (response.ok) {
                const data = await response.json();
                setUpgradeUrl(data.checkoutUrl || 'https://whop.com/checkout/');
            }
        } catch (error) {
            console.error('Error fetching checkout URL:', error);
            // Use default URL on error
        }
    }, [userId, companyId]);

    const loadBrokerAccounts = useCallback(async () => {
        if (!userId || !companyId) return Promise.resolve();
        setLoadingBrokers(true);
        try {
            const response = await apiRequest('/api/snaptrade/accounts', {
                method: 'GET',
                userId,
                companyId,
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.accounts) {
                    setBrokerAccounts(data.accounts);
                }
            }
        } catch (error) {
            console.error('Error loading broker accounts:', error);
        } finally {
            setLoadingBrokers(false);
        }
    }, [userId, companyId]);

    const fetchSettings = useCallback(async () => {
        if (!userId || !companyId) return;
        setLoading(true);
        try {
            const response = await apiRequest('/api/user', { userId, companyId });
            if (response.ok) {
                const data = await response.json();
                setAutoTradeMode(data.user.autoTradeMode || 'notify-only');
                // Convert to string to match Select component value format
                const savedBrokerId = data.user.defaultBrokerConnectionId
                    ? String(data.user.defaultBrokerConnectionId)
                    : null;
                setDefaultBrokerConnectionId(savedBrokerId);
            } else {
                toast.showError('Failed to load AutoIQ settings');
            }
        } catch (error) {
            console.error('Error fetching AutoIQ settings:', error);
            toast.showError('Failed to load AutoIQ settings');
        } finally {
            setLoading(false);
        }
    }, [userId, companyId, toast]);

    useEffect(() => {
        if (!accessLoading && isAuthorized) {
            // Always fetch checkout URL (for upgrade button)
            fetchCheckoutUrl();

            if (hasAutoIQ && userId && companyId) {
                // Load broker accounts first, then fetch settings
                // This ensures the Select component has options when the value is set
                loadBrokerAccounts().then(() => {
                    fetchSettings();
                });
            } else if (!hasAutoIQ) {
                // Don't show loading for non-subscribers
                setLoading(false);
            }
        }
    }, [accessLoading, isAuthorized, userId, companyId, hasAutoIQ, fetchSettings, fetchCheckoutUrl, loadBrokerAccounts]);

    // Ensure defaultBrokerConnectionId is valid when broker accounts are loaded
    useEffect(() => {
        if (defaultBrokerConnectionId && brokerAccounts.length > 0) {
            // Verify the saved broker connection ID exists in the loaded accounts
            const accountExists = brokerAccounts.some(acc => String(acc.id) === String(defaultBrokerConnectionId));
            if (!accountExists) {
                // If the saved account doesn't exist in the loaded accounts, reset to null
                console.warn('Saved default broker connection not found in loaded accounts, resetting to null');
                setDefaultBrokerConnectionId(null);
            }
        }
    }, [defaultBrokerConnectionId, brokerAccounts]);


    const handleSave = async () => {
        if (!userId || !companyId) return;
        setSaving(true);
        try {
            const response = await apiRequest('/api/user', {
                method: 'PATCH',
                body: JSON.stringify({
                    autoTradeMode,
                    defaultBrokerConnectionId: defaultBrokerConnectionId,
                }),
                userId,
                companyId,
            });

            if (response.ok) {
                toast.showSuccess('AutoIQ settings saved successfully!');
            } else {
                const error = await response.json();
                toast.showError(error.error || 'Failed to save AutoIQ settings');
            }
        } catch (error) {
            console.error('Error saving AutoIQ settings:', error);
            toast.showError('Failed to save AutoIQ settings');
        } finally {
            setSaving(false);
        }
    };

    if (accessLoading || loading) {
        return (
            <Container maxWidth="md" sx={{ py: 8 }}>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    if (!isAuthorized) {
        return (
            <Container maxWidth="md" sx={{ py: 8 }}>
                <Alert severity="error">You must be logged in to access this page.</Alert>
            </Container>
        );
    }

    if (!hasAutoIQ) {
        return (
            <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1, sm: 2 } }}>
                <Box sx={{ mb: 4 }}>
                    <Typography
                        variant="h4"
                        component="h1"
                        sx={{
                            fontWeight: 700,
                            mb: 1,
                            background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                        }}
                    >
                        AutoIQ
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        Automated trading for followed creators.
                    </Typography>
                </Box>

                <Paper
                    sx={{
                        p: 4,
                        bgcolor: 'var(--surface-bg)',
                        backdropFilter: 'blur(6px)',
                        borderRadius: 2,
                        border: '1px solid var(--surface-border)',
                        textAlign: 'center',
                    }}
                >
                    <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
                        Upgrade to AutoIQ
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
                        Get access to automated trading features. Automatically mirror trades from followed creators
                        to your connected broker with customizable risk settings.
                    </Typography>
                    <Button
                        variant="contained"
                        size="large"
                        onClick={() => {
                            // Manual upgrade - user will handle this
                            window.open(upgradeUrl, '_blank');
                        }}
                        sx={{
                            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                            color: '#ffffff',
                            px: 6,
                            py: 1.5,
                            fontWeight: 600,
                            textTransform: 'none',
                            borderRadius: 2,
                            boxShadow: (() => {
                              const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(theme.palette.primary.main);
                              if (rgb) {
                                const r = parseInt(rgb[1], 16);
                                const g = parseInt(rgb[2], 16);
                                const b = parseInt(rgb[3], 16);
                                return `0 4px 12px rgba(${r}, ${g}, ${b}, 0.3)`;
                              }
                              return '0 4px 12px rgba(34, 197, 94, 0.3)';
                            })(),
                            '&:hover': {
                                background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
                                boxShadow: (() => {
                                  const rgb = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(theme.palette.primary.main);
                                  if (rgb) {
                                    const r = parseInt(rgb[1], 16);
                                    const g = parseInt(rgb[2], 16);
                                    const b = parseInt(rgb[3], 16);
                                    return `0 6px 16px rgba(${r}, ${g}, ${b}, 0.4)`;
                                  }
                                  return '0 6px 16px rgba(34, 197, 94, 0.4)';
                                })(),
                                transform: 'translateY(-1px)',
                            },
                            transition: 'all 0.2s ease',
                        }}
                    >
                        Upgrade Now
                    </Button>
                </Paper>
            </Container>
        );
    }

    return (
        <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1, sm: 2 } }}>
            <Box sx={{ mb: 4 }}>
                <Typography
                    variant="h4"
                    component="h1"
                    sx={{
                        fontWeight: 700,
                        mb: 1,
                        background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}
                >
                    AutoIQ Settings
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Configure your automated trading preferences for followed creators.
                </Typography>
            </Box>

            <Paper
                sx={{
                    p: 4,
                    bgcolor: 'var(--surface-bg)',
                    backdropFilter: 'blur(6px)',
                    borderRadius: 2,
                    border: '1px solid var(--surface-border)',
                }}
            >
                <FormControl component="fieldset" fullWidth>
                    <FormLabel
                        component="legend"
                        sx={{
                            fontSize: '1.1rem',
                            fontWeight: 600,
                            mb: 2,
                            color: 'var(--app-text)',
                        }}
                    >
                        Global Mode
                    </FormLabel>
                    <RadioGroup
                        value={autoTradeMode}
                        onChange={(e) => setAutoTradeMode(e.target.value as 'auto-trade' | 'notify-only')}
                        sx={{ mb: 3 }}
                    >
                        <FormControlLabel
                            value="auto-trade"
                            control={
                                <Radio
                                    sx={{
                                        color: 'var(--text-muted)',
                                        '&.Mui-checked': {
                                            color: theme.palette.primary.main,
                                        },
                                    }}
                                />
                            }
                            label={
                                <Box>
                                    <Typography variant="body1" fontWeight={600} sx={{ mb: 0.5 }}>
                                        Auto-Trade Follows
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                                        Automatically mirror trades from followed creators to your connected broker.
                                        Only single-leg options during market hours will be executed.
                                    </Typography>
                                </Box>
                            }
                            sx={{
                                mb: 2,
                                p: 2,
                                borderRadius: 1,
                                border: '1px solid var(--surface-border)',
                                bgcolor: autoTradeMode === 'auto-trade' ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                                transition: 'all 0.2s ease',
                                '&:hover': {
                                    bgcolor: alpha(theme.palette.primary.main, 0.05),
                                },
                            }}
                        />
                        <FormControlLabel
                            value="notify-only"
                            control={
                                <Radio
                                    sx={{
                                        color: 'var(--text-muted)',
                                        '&.Mui-checked': {
                                            color: theme.palette.primary.main,
                                        },
                                    }}
                                />
                            }
                            label={
                                <Box>
                                    <Typography variant="body1" fontWeight={600} sx={{ mb: 0.5 }}>
                                        Notify Only
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                                        Receive follow trades in your Following tab and webhook notifications.
                                        You must manually execute trades using the Follow button.
                                    </Typography>
                                </Box>
                            }
                            sx={{
                                p: 2,
                                borderRadius: 1,
                                border: '1px solid var(--surface-border)',
                                bgcolor: autoTradeMode === 'notify-only' ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                                transition: 'all 0.2s ease',
                                '&:hover': {
                                    bgcolor: alpha(theme.palette.primary.main, 0.05),
                                },
                            }}
                        />
                    </RadioGroup>
                </FormControl>

                {autoTradeMode === 'auto-trade' && (
                    <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid var(--surface-border)' }}>
                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel sx={{ color: 'var(--app-text)' }}>
                                Default Broker Account
                            </InputLabel>
                            <Select
                                value={defaultBrokerConnectionId || ''}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setDefaultBrokerConnectionId(value === '' ? null : String(value));
                                }}
                                label="Default Broker Account"
                                disabled={loadingBrokers || brokerAccounts.length === 0}
                                displayEmpty
                                renderValue={(selected) => {
                                    if (!selected || selected === '') {
                                        return <em style={{ color: 'var(--text-muted)' }}>None (use first available)</em>;
                                    }
                                    const account = brokerAccounts.find(acc => String(acc.id) === String(selected));
                                    if (account) {
                                        return `${account.brokerName} - ${account.accountName}${account.accountNumber ? ` (${account.accountNumber})` : ''}`;
                                    }
                                    return selected;
                                }}
                                sx={{
                                    color: 'var(--app-text)',
                                    '& .MuiOutlinedInput-notchedOutline': {
                                        borderColor: 'var(--surface-border)',
                                    },
                                    '&:hover .MuiOutlinedInput-notchedOutline': {
                                        borderColor: theme.palette.primary.main,
                                    },
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                        borderColor: theme.palette.primary.main,
                                    },
                                }}
                            >

                                <MenuItem value="">None (use first available)</MenuItem>
                                {brokerAccounts.length > 0 && brokerAccounts.map((account) => (
                                    <MenuItem key={account.id} value={String(account.id)}>
                                        {account.brokerName} - {account.accountName}
                                        {account.accountNumber && ` (${account.accountNumber})`}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                )}

                <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid var(--surface-border)' }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'var(--text-muted)' }}>
                        Risk Settings
                    </Typography>
                    <Alert severity="info" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}` }}>
                        <Typography variant="body2">
                            Risk settings (Trade Size, Take Profit, Stop Loss, Trailing Stop) are coming soon.
                            For now, all auto-trades will use default settings.
                        </Typography>
                    </Alert>
                </Box>

                <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={saving}
                        sx={{
                            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                            color: '#ffffff',
                            px: 4,
                            py: 1.5,
                            fontWeight: 600,
                            textTransform: 'none',
                            borderRadius: 2,
                            boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.3)}`,
                            '&:hover': {
                                background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
                                boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.4)}`,
                                transform: 'translateY(-1px)',
                            },
                            transition: 'all 0.2s ease',
                        }}
                    >
                        {saving ? 'Saving...' : 'Save Settings'}
                    </Button>
                </Box>
            </Paper>
        </Container>
    );
}

