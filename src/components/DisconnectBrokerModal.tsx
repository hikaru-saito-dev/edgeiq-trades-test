'use client';

import { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    TextField,
} from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';

interface DisconnectBrokerModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    brokerName: string;
    loading?: boolean;
}

export default function DisconnectBrokerModal({
    open,
    onClose,
    onConfirm,
    brokerName,
    loading = false,
}: DisconnectBrokerModalProps) {
    const [confirmText, setConfirmText] = useState('');
    const isConfirmed = confirmText === 'DELETE';

    const handleConfirm = () => {
        if (isConfirmed) {
            onConfirm();
            setConfirmText(''); // Reset on close
        }
    };

    const handleClose = () => {
        setConfirmText('');
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
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
            <DialogTitle sx={{ color: 'var(--app-text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningIcon sx={{ color: '#f59e0b', fontSize: 24 }} />
                Disconnect {brokerName}
            </DialogTitle>
            <DialogContent>
                <Box sx={{ mb: 3 }}>
                    <Typography variant="body1" sx={{ color: 'var(--app-text)', mb: 2, fontWeight: 500 }}>
                        Warning: Disconnecting this broker will permanently delete:
                    </Typography>
                    <Box component="ul" sx={{ pl: 3, mb: 2, color: 'var(--app-text)' }}>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            All trading history and records
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            All position tracking data
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            All STC (Sell to Close) alerts
                        </Typography>
                        <Typography component="li" variant="body2" sx={{ mb: 1 }}>
                            Account balance information
                        </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 3 }}>
                        This action cannot be undone. You will need to reconnect your broker and all data will be lost.
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'var(--app-text)', mb: 1, fontWeight: 500 }}>
                        Type DELETE to confirm:
                    </Typography>
                    <TextField
                        fullWidth
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="DELETE"
                        variant="outlined"
                        disabled={loading}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                color: 'var(--app-text)',
                                '& fieldset': {
                                    borderColor: isConfirmed ? '#22c55e' : 'var(--surface-border)',
                                    borderWidth: isConfirmed ? 2 : 1,
                                },
                                '&:hover fieldset': {
                                    borderColor: isConfirmed ? '#22c55e' : 'var(--surface-border)',
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: isConfirmed ? '#22c55e' : 'var(--surface-border)',
                                },
                            },
                        }}
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1 }}>
                <Button
                    onClick={handleClose}
                    disabled={loading}
                    sx={{
                        color: 'var(--text-muted)',
                        '&:hover': {
                            background: 'rgba(255, 255, 255, 0.05)',
                        },
                    }}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleConfirm}
                    disabled={!isConfirmed || loading}
                    variant="contained"
                    sx={{
                        background: isConfirmed
                            ? 'linear-gradient(135deg, #22c55e, #059669)'
                            : 'rgba(34, 197, 94, 0.3)',
                        color: 'white',
                        fontWeight: 600,
                        '&:hover': {
                            background: isConfirmed
                                ? 'linear-gradient(135deg, #16a34a, #047857)'
                                : 'rgba(34, 197, 94, 0.3)',
                        },
                        '&:disabled': {
                            background: 'rgba(34, 197, 94, 0.3)',
                            color: 'rgba(255, 255, 255, 0.5)',
                        },
                    }}
                >
                    {loading ? 'Disconnecting...' : 'Disconnect Broker'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
