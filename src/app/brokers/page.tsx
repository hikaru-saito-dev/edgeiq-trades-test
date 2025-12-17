'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Chip,
  CircularProgress,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RefreshIcon from '@mui/icons-material/Refresh';
import { apiRequest } from '@/lib/apiClient';
import { useAccess } from '@/components/AccessProvider';
import { useToast } from '@/components/ToastProvider';

interface Broker {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string | null;
  brokerageType?: string | null;
}

interface ConnectedBroker {
  id: string;
  connectionId?: string;
  accountId: string;
  brokerName: string;
  accountName: string;
  accountNumber: string;
  buyingPower?: number;
  lastSync?: string;
}

export default function BrokerTestPage() {
  const toast = useToast();
  const { userId, companyId } = useAccess();

  const [connectedBrokers, setConnectedBrokers] = useState<ConnectedBroker[]>([]);
  const [availableBrokers, setAvailableBrokers] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingBrokers, setLoadingBrokers] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<Broker | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    // Load connected accounts and available brokers on mount
    loadConnectedAccounts();
    loadAvailableBrokers();
  }, []);

  const loadConnectedAccounts = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/snaptrade/accounts', {
        method: 'GET',
        userId,
        companyId,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConnectedBrokers(data.accounts || []);
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableBrokers = async () => {
    setLoadingBrokers(true);
    try {
      const res = await apiRequest('/api/snaptrade/brokerages', {
        method: 'GET',
      });
      const data = await res.json();
      if (res.ok && data.success && data.brokerages) {
        // Map SnapTrade brokerages to our Broker interface
        const brokers: Broker[] = data.brokerages
          .filter((b: { slug: string; name: string }) => b?.slug && b?.name) // Only include brokers with required fields
          .map((b: { slug: string; name: string; brokerageType: string; logoUrl: string }) => ({
            id: String(b.slug || '').toLowerCase().replace(/_/g, '-'),
            name: String(b.name || ''),
            slug: String(b.slug || ''), // Use the official SnapTrade slug
            description: b.brokerageType ? String(b.brokerageType) : undefined,
            logoUrl: b.logoUrl || null,
            brokerageType: b.brokerageType || null,
          }));
        setAvailableBrokers(brokers);
      }
    } catch (error) {
      console.error('Failed to load brokerages:', error);
      toast.showError('Failed to load available brokers');
    } finally {
      setLoadingBrokers(false);
    }
  };

  const handleConnectClick = async (broker: Broker) => {
    setSelectedBroker(broker);
    setConnecting(true);

    try {
      // Create SnapTrade portal session for this specific broker
      const res = await apiRequest('/api/snaptrade/portal', {
        method: 'POST',
        body: JSON.stringify({
          brokerSlug: broker.slug, // Pass broker slug to show specific broker in portal
        }),
        userId,
        companyId,
      });

      const data = await res.json();
      if (!res.ok || !data.redirectURI) {
        toast.showError(data.error || 'Failed to create SnapTrade portal session');
        return;
      }

      // Open SnapTrade's portal directly - it will show their own modal with the 3 steps
      const width = 960;
      const height = 720;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        data.redirectURI as string,
        'snaptrade-connection-portal',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
      );

      if (popup) {
        toast.showSuccess(`Opening ${broker.name} connection portal...`);

        // Listen for popup close to refresh connections
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            // Reload connected accounts after connection completes
            loadConnectedAccounts();
            toast.showSuccess('Connection process completed. Your connected broker has been added.');
          }
        }, 500);
      } else {
        toast.showError('Popup blocked. Please allow popups for this site.');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      toast.showError(`Failed to open connection portal: ${msg}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    try {
      const res = await apiRequest(`/api/brokers/${connectionId}`, {
        method: 'DELETE',
        userId,
        companyId,
      });
      if (res.ok) {
        toast.showSuccess('Broker disconnected');
        loadConnectedAccounts();
      } else {
        toast.showError('Failed to disconnect broker');
      }
    } catch (error) {
      toast.showError('Failed to disconnect broker');
    }
  };

  const handleRefresh = () => {
    loadConnectedAccounts();
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, minHeight: '100vh', background: 'var(--background)' }}>
      <Typography variant="h4" fontWeight={700} sx={{ mb: 4, color: 'var(--app-text)' }}>
        Brokers
      </Typography>

      {/* Connected Brokers Section */}
      <Card sx={{ mb: 4, background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6" fontWeight={600} sx={{ color: 'var(--app-text)' }}>
              Connected Brokers
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={handleRefresh}
              disabled={loading}
            >
              Refresh Data
            </Button>
          </Box>

          {connectedBrokers.length === 0 ? (
            <Box
              sx={{
                border: '2px dashed var(--surface-border)',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                background: 'rgba(0,0,0,0.2)',
              }}
            >
              <Typography variant="body1" sx={{ color: 'var(--text-muted)', mb: 1 }}>
                No brokers connected
              </Typography>
              <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                Connect a broker below to start trading and receiving alerts.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {connectedBrokers.map((broker) => (
                <Box
                  key={broker.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 2,
                    border: '1px solid var(--surface-border)',
                    borderRadius: 1,
                    background: 'var(--surface-bg)',
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <Box>
                      <Typography variant="h6" sx={{ color: 'var(--app-text)', fontWeight: 600 }}>
                        {broker.brokerName}
                      </Typography>
                      <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                        <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                        <Chip label="Connected" size="small" color="success" />
                      </Box>
                    </Box>
                  </Box>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="caption" sx={{ color: 'var(--text-muted)', display: 'block' }}>
                        Accounts (1)
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'var(--app-text)', fontWeight: 500 }}>
                        {broker.accountName}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                        {broker.accountNumber}
                      </Typography>
                      {broker.buyingPower !== undefined && (
                        <>
                          <Typography variant="h6" sx={{ color: 'var(--app-text)', fontWeight: 700, mt: 1 }}>
                            ${broker.buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                            Buying Power
                          </Typography>
                        </>
                      )}
                    </Box>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => handleDisconnect(broker.id)}
                    >
                      Disconnect
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Connect a Broker Section */}
      <Box>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1, color: 'var(--app-text)' }}>
          Connect a Broker to Get Started
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 3 }}>
          Choose a broker below to connect your trading account and start receiving alerts.
        </Typography>

        {loadingBrokers ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : availableBrokers.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'var(--text-muted)', textAlign: 'center', py: 4 }}>
            No brokers available at this time.
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            {availableBrokers.map((broker) => (
              <Card
                key={broker.id}
                sx={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 2,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  },
                }}
              >
                <CardContent sx={{ p: 2.5 }}>
                  <Box sx={{ mb: 2, minHeight: 48, display: 'flex', alignItems: 'center' }}>
                    <Typography variant="h6" sx={{ color: 'var(--app-text)', fontWeight: 600 }}>
                      {broker.name}
                    </Typography>
                  </Box>
                  {broker.description && (
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'var(--text-muted)',
                        mb: 2,
                        minHeight: 40,
                        fontSize: '0.875rem',
                        lineHeight: 1.5,
                      }}
                    >
                      {broker.description}
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    fullWidth
                    disabled={connecting && selectedBroker?.id === broker.id}
                    sx={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: 'white',
                      fontWeight: 600,
                      textTransform: 'none',
                      py: 1.25,
                      '&:hover': {
                        background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                      },
                    }}
                    onClick={() => handleConnectClick(broker)}
                  >
                    {connecting && selectedBroker?.id === broker.id ? (
                      <>
                        <CircularProgress size={16} sx={{ mr: 1, color: 'white' }} />
                        Connecting...
                      </>
                    ) : (
                      `Connect to ${broker.name}`
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Box>

    </Box>
  );
}
