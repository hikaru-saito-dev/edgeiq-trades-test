'use client';

import { Container, Box, Typography, Paper, Radio, RadioGroup, FormControlLabel, FormControl, FormLabel, Button, CircularProgress, Alert, Select, MenuItem, InputLabel } from '@mui/material';
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
        if (!userId || !companyId) return;
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
                setDefaultBrokerConnectionId(data.user.defaultBrokerConnectionId || null);
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
                loadBrokerAccounts();
                fetchSettings();
            } else if (!hasAutoIQ) {
                // Don't show loading for non-subscribers
                setLoading(false);
            }
        }
    }, [accessLoading, isAuthorized, userId, companyId, hasAutoIQ, fetchSettings, fetchCheckoutUrl, loadBrokerAccounts]);


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
                            background: 'linear-gradient(135deg, #22c55e 0%, #059669 100%)',
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
                            background: 'linear-gradient(135deg, #22c55e, #059669)',
                            color: '#ffffff',
                            px: 6,
                            py: 1.5,
                            fontWeight: 600,
                            textTransform: 'none',
                            borderRadius: 2,
                            boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
                            '&:hover': {
                                background: 'linear-gradient(135deg, #16a34a, #047857)',
                                boxShadow: '0 6px 16px rgba(34, 197, 94, 0.4)',
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
                        background: 'linear-gradient(135deg, #22c55e 0%, #059669 100%)',
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
                                            color: '#22c55e',
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
                                bgcolor: autoTradeMode === 'auto-trade' ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                                transition: 'all 0.2s ease',
                                '&:hover': {
                                    bgcolor: 'rgba(34, 197, 94, 0.05)',
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
                                            color: '#22c55e',
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
                                bgcolor: autoTradeMode === 'notify-only' ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                                transition: 'all 0.2s ease',
                                '&:hover': {
                                    bgcolor: 'rgba(34, 197, 94, 0.05)',
                                },
                            }}
                        />
                    </RadioGroup>
                </FormControl>

                {autoTradeMode === 'auto-trade' && (
                    <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid var(--surface-border)' }}>
                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel  sx={{ color: 'var(--app-text)' }}>
                                Default Broker Account
                            </InputLabel>
                            <Select
                                value={defaultBrokerConnectionId ? String(defaultBrokerConnectionId) : ''}
                                onChange={(e) => {
                                    setDefaultBrokerConnectionId((e.target.value).toString());
                                }}
                                label="Default Broker Account"
                                disabled={loadingBrokers || brokerAccounts.length === 0}
                                sx={{
                                    color: 'var(--app-text)',
                                    '& .MuiOutlinedInput-notchedOutline': {
                                        borderColor: 'var(--surface-border)',
                                    },
                                    '&:hover .MuiOutlinedInput-notchedOutline': {
                                        borderColor: '#22c55e',
                                    },
                                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                        borderColor: '#22c55e',
                                    },
                                }}
                            >
                                {loadingBrokers ? (
                                    <MenuItem disabled value="">
                                        Loading accounts...
                                    </MenuItem>
                                ) : brokerAccounts.length === 0 ? (
                                    <MenuItem disabled value="">
                                        No broker accounts connected
                                    </MenuItem>
                                ) : (
                                    <>
                                        <MenuItem value="">
                                            <em>None (use first available)</em>
                                        </MenuItem>
                                        {brokerAccounts.map((account) => (
                                            <MenuItem key={account.id} value={String(account.id)}>
                                                {account.brokerName} - {account.accountName}
                                                {account.accountNumber && ` (${account.accountNumber})`}
                                            </MenuItem>
                                        ))}
                                    </>
                                )}
                            </Select>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                Select the default broker account to use for auto-trading. If not set, the first available account will be used.
                            </Typography>
                            {brokerAccounts.length === 0 && !loadingBrokers && (
                                <Alert severity="warning" sx={{ mt: 2 }}>
                                    No broker accounts connected. Please connect a broker account in your Profile settings to enable auto-trading.
                                </Alert>
                            )}
                        </FormControl>
                    </Box>
                )}

                <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid var(--surface-border)' }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'var(--text-muted)' }}>
                        Risk Settings
                    </Typography>
                    <Alert severity="info" sx={{ bgcolor: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
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
                            background: 'linear-gradient(135deg, #22c55e, #059669)',
                            color: '#ffffff',
                            px: 4,
                            py: 1.5,
                            fontWeight: 600,
                            textTransform: 'none',
                            borderRadius: 2,
                            boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
                            '&:hover': {
                                background: 'linear-gradient(135deg, #16a34a, #047857)',
                                boxShadow: '0 6px 16px rgba(34, 197, 94, 0.4)',
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

