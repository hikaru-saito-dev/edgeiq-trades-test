'use client';

import { useState, useEffect, useRef } from 'react';
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

    // Use refs to track popup and intervals for cleanup
    const popupRef = useRef<Window | null>(null);
    const intervalsRef = useRef<{ popup: NodeJS.Timeout | null; success: NodeJS.Timeout | null }>({ popup: null, success: null });
    const isCompletedRef = useRef(false);

    // Cleanup on modal close
    useEffect(() => {
        if (!open) {
            setError(null);
            setRedirectUri(null);
            isCompletedRef.current = false;

            // Clean up intervals
            if (intervalsRef.current.popup) {
                clearInterval(intervalsRef.current.popup);
                intervalsRef.current.popup = null;
            }
            if (intervalsRef.current.success) {
                clearInterval(intervalsRef.current.success);
                intervalsRef.current.success = null;
            }

            // Close popup if still open
            if (popupRef.current && !popupRef.current.closed) {
                try {
                    popupRef.current.close();
                } catch {
                    // Ignore
                }
                popupRef.current = null;
            }
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
                // Store connectionId and userId for callback
                const connectionId = data.connectionId;
                const storedUserId = data.userId;

                // Open SnapTrade OAuth in new window
                const width = 600;
                const height = 700;
                const left = window.screen.width / 2 - width / 2;
                const top = window.screen.height / 2 - height / 2;

                // Append callback parameters to redirect URI if possible
                // Note: SnapTrade may not allow this, so we'll handle it in the callback route
                let redirectUrl = data.redirectURI;
                try {
                    const url = new URL(redirectUrl);
                    // Try to append our callback info (may be stripped by SnapTrade)
                    url.searchParams.set('_callback_connectionId', connectionId || '');
                    url.searchParams.set('_callback_userId', storedUserId || userId || '');
                    redirectUrl = url.toString();
                } catch {
                    // If URL parsing fails, use original
                }

                const popup = window.open(
                    redirectUrl,
                    'SnapTrade Connect',
                    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
                );

                if (!popup) {
                    throw new Error('Popup blocked. Please allow popups for this site.');
                }

                setRedirectUri(data.redirectURI);
                popupRef.current = popup;

                // Helper function to clean up and close everything
                const completeConnection = async () => {
                    if (isCompletedRef.current) return;
                    isCompletedRef.current = true;

                    // Clear all intervals
                    if (intervalsRef.current.popup) {
                        clearInterval(intervalsRef.current.popup);
                        intervalsRef.current.popup = null;
                    }
                    if (intervalsRef.current.success) {
                        clearInterval(intervalsRef.current.success);
                        intervalsRef.current.success = null;
                    }

                    // Close popup if still open
                    try {
                        if (popup && !popup.closed) {
                            popup.close();
                        }
                    } catch {
                        // Popup might already be closed
                    }

                    // Wait a moment for callback to process, then complete
                    setTimeout(async () => {
                        try {
                            const completeResponse = await apiRequest('/api/snaptrade/complete', {
                                method: 'POST',
                                userId,
                                companyId,
                            });

                            if (completeResponse.ok) {
                                const completeData = await completeResponse.json();
                                if (completeData.success) {
                                    if (onSuccess) onSuccess();
                                    onClose();
                                    toast.showSuccess('Account connected successfully!');
                                    return;
                                }
                            }
                        } catch {
                            // Continue anyway
                        }

                        // Fallback: still reload and close
                        if (onSuccess) onSuccess();
                        onClose();
                        toast.showSuccess('Connection completed!');
                    }, 1000);
                };

                // Poll for popup to detect success and close it automatically
                intervalsRef.current.popup = setInterval(() => {
                    // Check if popup was closed manually
                    if (popup.closed) {
                        completeConnection();
                        return;
                    }

                    // Try to detect if popup has redirected to our domain (success)
                    try {
                        const popupUrl = popup.location.href;
                        const currentOrigin = window.location.origin;

                        // Check if popup is on our domain
                        if (popupUrl && popupUrl.startsWith(currentOrigin)) {
                            // Popup is on our domain - check if it's a success page
                            if (
                                popupUrl.includes('/api/snaptrade/callback') ||
                                popupUrl.includes('/profile') ||
                                popupUrl.includes('success=connected') ||
                                popupUrl.includes('connection-complete')
                            ) {
                                // Connection successful! Close popup and modal
                                completeConnection();
                            }
                        }
                    } catch {
                        // CORS error - popup is still on different domain (SnapTrade)
                        // This is expected, continue polling
                    }
                }, 200); // Check every 200ms for fast response

                // Also check periodically if parent window is redirected to success page
                intervalsRef.current.success = setInterval(() => {
                    if (window.location.search.includes('success=connected')) {
                        completeConnection();
                    }
                }, 500);
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

