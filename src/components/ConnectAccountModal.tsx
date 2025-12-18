'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    CircularProgress,
    Alert,
} from '@mui/material';
import { useToast } from './ToastProvider';
import { apiRequest } from '@/lib/apiClient';
import { useAccess } from './AccessProvider';

interface ConnectAccountModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

export default function ConnectAccountModal({
    open,
    onClose,
    onSuccess,
}: ConnectAccountModalProps) {
    const toast = useToast();
    const { userId, companyId } = useAccess();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [redirectUri, setRedirectUri] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setError(null);
            setRedirectUri(null);
        }
    }, [open]);

    const handleConnect = async () => {
        if (!userId || !companyId) {
            setError('User not authenticated');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await apiRequest('/api/snaptrade/connect', {
                method: 'POST',
                userId,
                companyId,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to initiate connection');
            }

            if (data.redirectURI) {
                // Open SnapTrade OAuth in new window
                const width = 600;
                const height = 700;
                const left = window.screen.width / 2 - width / 2;
                const top = window.screen.height / 2 - height / 2;

                const popup = window.open(
                    data.redirectURI,
                    'SnapTrade Connect',
                    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
                );

                if (!popup) {
                    throw new Error('Popup blocked. Please allow popups for this site.');
                }

                setRedirectUri(data.redirectURI);

                // Poll for popup to close (user completed OAuth)
                const checkClosed = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(checkClosed);
                        // Wait a moment for callback to process
                        setTimeout(() => {
                            if (onSuccess) onSuccess();
                            onClose();
                            toast.showSuccess('Account connected successfully!');
                        }, 1000);
                    }
                }, 500);

                // Also listen for message from popup (if callback page sends it)
                const messageHandler = (event: MessageEvent) => {
                    if (event.data === 'snaptrade-connected') {
                        clearInterval(checkClosed);
                        window.removeEventListener('message', messageHandler);
                        if (onSuccess) onSuccess();
                        onClose();
                        toast.showSuccess('Account connected successfully!');
                    }
                };
                window.addEventListener('message', messageHandler);
            } else {
                throw new Error('No redirect URI received');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to connect account';
            setError(message);
            toast.showError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenInNewTab = () => {
        if (redirectUri) {
            window.open(redirectUri, '_blank');
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    background: 'var(--surface-bg)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid var(--surface-border)',
                },
            }}
        >
            <DialogTitle sx={{ color: 'var(--app-text)', fontWeight: 600 }}>
                Connect Trading Account
            </DialogTitle>
            <DialogContent>
                <Box sx={{ mb: 2 }}>
                    <Typography variant="body1" sx={{ color: 'var(--app-text)', mb: 2 }}>
                        Connect your brokerage account through SnapTrade to enable option trading.
                        Your credentials are securely managed through SnapTrade&apos;s OAuth portal.
                    </Typography>

                    <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 2 }}>
                        You will be redirected to SnapTrade to securely authorize access to your brokerage account.
                        This process is safe and your credentials are never stored by us.
                    </Typography>

                    {error && (
                        <Alert severity="error" sx={{ mt: 2, mb: 2 }}>
                            {error}
                        </Alert>
                    )}

                    {redirectUri && (
                        <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                If the popup was blocked, you can open the connection page manually:
                            </Typography>
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={handleOpenInNewTab}
                                sx={{ mt: 1 }}
                            >
                                Open Connection Page
                            </Button>
                        </Alert>
                    )}
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1 }}>
                <Button
                    onClick={onClose}
                    disabled={loading}
                    sx={{ color: 'var(--text-muted)' }}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleConnect}
                    disabled={loading || !!redirectUri}
                    variant="contained"
                    sx={{
                        background: 'linear-gradient(135deg, #22c55e, #059669)',
                        color: 'white',
                        '&:hover': {
                            background: 'linear-gradient(135deg, #16a34a, #047857)',
                        },
                        '&:disabled': {
                            background: 'rgba(34, 197, 94, 0.3)',
                        },
                    }}
                >
                    {loading ? (
                        <>
                            <CircularProgress size={16} sx={{ mr: 1 }} />
                            Connecting...
                        </>
                    ) : redirectUri ? (
                        'Connection in Progress'
                    ) : (
                        'Connect Account'
                    )}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

