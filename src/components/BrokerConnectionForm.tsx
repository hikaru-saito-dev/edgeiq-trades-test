'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useToast } from './ToastProvider';
import { apiRequest } from '@/lib/apiClient';
import { useAccess } from './AccessProvider';

type BrokerType = 'alpaca' | 'webull';

interface BrokerConnection {
  id: string;
  brokerType: BrokerType;
  isActive: boolean;
  paperTrading: boolean;
  accountId?: string;
  createdAt: string;
  updatedAt: string;
}

export default function BrokerConnectionForm() {
  const toast = useToast();
  const { userId, companyId } = useAccess();
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [brokerType, setBrokerType] = useState<BrokerType>('alpaca');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [paperTrading, setPaperTrading] = useState(true); // Default to paper trading for testing
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string; accountInfo?: unknown } | null>(null);

  useEffect(() => {
    if (userId) {
      fetchConnections();
    }
  }, [userId, companyId]);

  const fetchConnections = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await apiRequest('/api/brokers', { userId, companyId });
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
      }
    } catch (error) {
      console.error('Error fetching connections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.showError('Please enter API Key and Secret');
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest('/api/brokers/test', {
        method: 'POST',
        body: JSON.stringify({
          brokerType,
          apiKey,
          apiSecret,
          paperTrading,
        }),
        userId,
        companyId,
      });

      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.message,
        accountInfo: data.accountInfo,
      });

      if (data.success) {
        toast.showSuccess('Connection test successful!');
      } else {
        toast.showError(data.message || 'Connection test failed');
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      });
      toast.showError('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.showError('Please enter API Key and Secret');
      return;
    }

    setSaving(true);
    try {
      const res = await apiRequest('/api/brokers', {
        method: 'POST',
        body: JSON.stringify({
          brokerType,
          apiKey,
          apiSecret,
          paperTrading,
        }),
        userId,
        companyId,
      });

      if (res.ok) {
        toast.showSuccess(`${brokerType.toUpperCase()} account connected successfully!`);
        setApiKey('');
        setApiSecret('');
        setTestResult(null);
        await fetchConnections();
      } else {
        const error = await res.json();
        toast.showError(error.error || 'Failed to connect broker');
      }
    } catch (error) {
      toast.showError('Failed to connect broker');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Are you sure you want to disconnect this broker?')) {
      return;
    }

    try {
      const res = await apiRequest(`/api/brokers?id=${connectionId}`, {
        method: 'DELETE',
        userId,
        companyId,
      });

      if (res.ok) {
        toast.showSuccess('Broker disconnected');
        await fetchConnections();
      } else {
        const error = await res.json();
        toast.showError(error.error || 'Failed to disconnect broker');
      }
    } catch (error) {
      toast.showError('Failed to disconnect broker');
    }
  };

  const existingConnection = connections.find((c) => c.brokerType === brokerType);

  return (
    <Card sx={{ mb: 3, background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}>
      <CardContent>
        <Typography variant="h6" sx={{ color: 'var(--app-text)', mb: 2, fontWeight: 600 }}>
          Broker Connections
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 3 }}>
          Connect your Alpaca account to automatically sync trades. Your credentials are encrypted and stored securely.
        </Typography>

        {loading ? (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            {/* Existing Connections */}
            {connections.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ color: 'var(--app-text)', mb: 1, fontWeight: 600 }}>
                  Connected Brokers
                </Typography>
                {connections.map((conn) => (
                  <Box
                    key={conn.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 1.5,
                      mb: 1,
                      border: '1px solid var(--surface-border)',
                      borderRadius: 1,
                      background: 'var(--surface-bg)',
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={1.5}>
                      <Chip
                        label={conn.brokerType.toUpperCase()}
                        size="small"
                        color={conn.isActive ? 'success' : 'default'}
                      />
                      {conn.paperTrading && (
                        <Chip label="Paper Trading" size="small" variant="outlined" />
                      )}
                      {conn.accountId && (
                        <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                          Account: {conn.accountId.slice(0, 8)}...
                        </Typography>
                      )}
                    </Box>
                    <IconButton
                      size="small"
                      onClick={() => handleDisconnect(conn.id)}
                      sx={{ color: 'error.main' }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            )}

            {/* Connection Form */}
            {!existingConnection && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>Broker Type</InputLabel>
                  <Select
                    value={brokerType}
                    onChange={(e) => setBrokerType(e.target.value as BrokerType)}
                    label="Broker Type"
                  >
                    <MenuItem value="alpaca">Alpaca Markets</MenuItem>
                    <MenuItem value="webull" disabled>Webull (Coming Soon)</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  label="API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  fullWidth
                  type="text"
                />

                <TextField
                  label="API Secret"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  fullWidth
                  type="password"
                />

                {brokerType === 'alpaca' && (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={paperTrading}
                        onChange={(e) => setPaperTrading(e.target.checked)}
                      />
                    }
                    label="Paper Trading (Sandbox Mode)"
                  />
                )}

                {testResult && (
                  <Alert
                    severity={testResult.success ? 'success' : 'error'}
                    icon={testResult.success ? <CheckCircleIcon /> : <ErrorIcon />}
                  >
                    {testResult.message}
                    {testResult.accountInfo !== undefined && (
                      <Box component="pre" sx={{ mt: 1, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(testResult.accountInfo as Record<string, unknown>, null, 2)}
                      </Box>
                    )}
                  </Alert>
                )}

                <Box display="flex" gap={1}>
                  <Button
                    variant="outlined"
                    onClick={handleTest}
                    disabled={testing || saving || !apiKey.trim() || !apiSecret.trim()}
                  >
                    {testing ? <CircularProgress size={20} /> : 'Test Connection'}
                  </Button>
                  <Button
                    variant="contained"
                    onClick={handleConnect}
                    disabled={saving || testing || !apiKey.trim() || !apiSecret.trim()}
                  >
                    {saving ? <CircularProgress size={20} /> : 'Connect'}
                  </Button>
                </Box>
              </Box>
            )}

            {existingConnection && (
              <Alert severity="info">
                You already have a {brokerType.toUpperCase()} connection. Disconnect it first to create a new one.
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
