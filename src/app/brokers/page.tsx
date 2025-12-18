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
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  useEffect(() => {
    // Load connected accounts on mount
    loadConnectedAccounts();
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

  // Listen for postMessage from callback route
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Accept messages from our callback route
      if (event.data && typeof event.data === 'object' && event.data.status === 'SUCCESS') {
        setModalOpen(false);
        setPortalUrl(null);
        loadConnectedAccounts();
        toast.showSuccess('Broker connected successfully!');
      } else if (event.data && typeof event.data === 'object' && event.data.status === 'ERROR') {
        setModalOpen(false);
        setPortalUrl(null);
        toast.showError(event.data.detail || 'Connection failed');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectClick = async () => {
    setConnecting(true);

    try {
      // Create SnapTrade portal session (no specific broker - shows all brokers)
      const res = await apiRequest('/api/snaptrade/portal', {
        method: 'POST',
        body: JSON.stringify({}), // No brokerSlug - shows all available brokers
        userId,
        companyId,
      });

      const data = await res.json();
      if (!res.ok || !data.redirectURI) {
        toast.showError(data.error || 'Failed to create SnapTrade portal session');
        return;
      }

      // Open modal with iframe (like Alertsify)
      setPortalUrl(data.redirectURI as string);
      setModalOpen(true);
      toast.showSuccess('Opening broker connection portal...');
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
          Connect a Broker
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 3 }}>
          Connect your trading account to start placing trades and receiving alerts.
        </Typography>

        <Button
          variant="contained"
          size="large"
          disabled={connecting}
          onClick={handleConnectClick}
          sx={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: 'white',
            fontWeight: 600,
            textTransform: 'none',
            py: 1.5,
            px: 4,
            fontSize: '1rem',
            '&:hover': {
              background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            },
          }}
        >
          {connecting ? (
            <>
              <CircularProgress size={20} sx={{ mr: 1, color: 'white' }} />
              Opening Connection Portal...
            </>
          ) : (
            'Connect Broker Account'
          )}
        </Button>
      </Box>

      {/* SnapTrade Connection Modal (iframe) */}
      {modalOpen && portalUrl && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModalOpen(false);
              setPortalUrl(null);
            }
          }}
        >
          <Box
            sx={{
              position: 'relative',
              width: '90%',
              maxWidth: '900px',
              height: '90%',
              maxHeight: '700px',
              backgroundColor: 'white',
              borderRadius: '8px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header */}
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: '1px solid #e0e0e0',
              }}
            >
              <Typography variant="h6" fontWeight={600}>
                Connect Your Brokerage Account
              </Typography>
              <Button
                onClick={() => {
                  setModalOpen(false);
                  setPortalUrl(null);
                }}
                sx={{
                  minWidth: 'auto',
                  padding: '4px',
                  color: '#666',
                  '&:hover': { backgroundColor: '#f0f0f0' },
                }}
              >
                ×
              </Button>
            </Box>

            {/* Iframe */}
            <Box sx={{ flex: 1, overflow: 'hidden', borderRadius: '0 0 8px 8px' }}>
              <iframe
                id="snaptrade-iframe"
                src={portalUrl}
                title="SnapTrade Connection Portal"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                }}
                allowFullScreen
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
              />
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
