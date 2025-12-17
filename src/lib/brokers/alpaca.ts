import { BaseBroker, OrderResult, AccountInfo } from './base';
import { IBrokerConnection } from '@/models/BrokerConnection';
import { ITrade } from '@/models/Trade';
import { convertToAlpacaSymbol } from '@/utils/optionSymbol';

const ALPACA_AUTH_URL = 'https://authx.alpaca.markets';
const ALPACA_PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE_BASE_URL = 'https://api.alpaca.markets';
const ALPACA_BROKER_API_BASE_URL = 'https://broker-api.alpaca.markets';

interface AlpacaAccountResponse {
  id: string;
  account_number: string;
  option_approved_level?: string;
  option_trading_level?: string;
  [key: string]: unknown;
}

interface AlpacaOrderResponse {
  id: string;
  client_order_id?: string;
  symbol: string;
  asset_id?: string;
  asset_class?: string;
  qty: string;
  filled_qty?: string;
  filled_avg_price?: string | null;
  order_class?: string;
  type: string;
  side: string;
  time_in_force: string;
  status: string;
  extended_hours?: boolean;
  commission?: string;
  legs?: unknown;
  [key: string]: unknown;
}

export class AlpacaBroker extends BaseBroker {
  private getBaseUrl(): string {
    return this.connection.paperTrading ? ALPACA_PAPER_BASE_URL : ALPACA_LIVE_BASE_URL;
  }

  private getApiKey(): string {
    // Type assertion needed because mongoose methods aren't always recognized by TypeScript
    const conn = this.connection as IBrokerConnection & { getDecryptedApiKey(): string; getDecryptedApiSecret(): string };
    return conn.getDecryptedApiKey();
  }

  private getApiSecret(): string {
    // Type assertion needed because mongoose methods aren't always recognized by TypeScript
    const conn = this.connection as IBrokerConnection & { getDecryptedApiKey(): string; getDecryptedApiSecret(): string };
    return conn.getDecryptedApiSecret();
  }

  private getAccessToken(): string | undefined {
    const conn = this.connection as IBrokerConnection & { getDecryptedAccessToken(): string | undefined };
    return conn.getDecryptedAccessToken();
  }

  /**
   * Obtain OAuth2 access token using client credentials flow
   */
  private async obtainAccessToken(): Promise<string> {
    const apiKey = this.getApiKey();
    const apiSecret = this.getApiSecret();

    const formData = new URLSearchParams();
    formData.append('grant_type', 'client_credentials');
    formData.append('client_id', apiKey);
    formData.append('client_secret', apiSecret);

    const response = await fetch(`${ALPACA_AUTH_URL}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to obtain access token: HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    // Store token and expiration in connection
    // Note: This will be saved to DB when connection.save() is called
    this.connection.accessToken = data.access_token;
    // expires_in is in seconds, convert to Date
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + data.expires_in);
    this.connection.accessTokenExpiresAt = expiresAt;

    // Save token to database if connection is persisted
    if (this.connection.isNew === false) {
      await this.connection.save();
    }

    return data.access_token;
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getValidAccessToken(): Promise<string> {
    const existingToken = this.getAccessToken();
    const expiresAt = this.connection.accessTokenExpiresAt;

    // Check if token exists and is still valid (with 60 second buffer)
    if (existingToken && expiresAt) {
      const now = new Date();
      const bufferTime = 60 * 1000; // 60 seconds in milliseconds
      if (expiresAt.getTime() > now.getTime() + bufferTime) {
        return existingToken;
      }
    }

    // Token doesn't exist or is expired, obtain a new one
    return await this.obtainAccessToken();
  }

  private async alpacaRequest<T>(
    path: string,
    options: { method?: string; body?: Record<string, unknown>; useBrokerAPI?: boolean } = {}
  ): Promise<T> {
    // Use Broker API for OAuth2, or regular API for direct key auth
    const useBrokerAPI = options.useBrokerAPI === true;
    const baseUrl = useBrokerAPI
      ? ALPACA_BROKER_API_BASE_URL
      : this.getBaseUrl();

    // For Broker API, use OAuth2 Bearer token
    // For regular API, use direct API key authentication
    const useOAuth = useBrokerAPI;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (useOAuth) {
      // Use OAuth2 Bearer token for Broker API
      const accessToken = await this.getValidAccessToken();
      headers['Authorization'] = `Bearer ${accessToken}`;
    } else {
      // Use direct API key authentication for regular API
      const apiKey = this.getApiKey();
      const apiSecret = this.getApiSecret();
      headers['APCA-API-KEY-ID'] = apiKey;
      headers['APCA-API-SECRET-KEY'] = apiSecret;
    }

    const url = `${baseUrl}${path}`;
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = `HTTP ${response.status}: ${text}`;

      try {
        const errorJson = JSON.parse(text);
        if (errorJson.message) {
          errorMessage = errorJson.message;
        } else if (typeof errorJson === 'string') {
          errorMessage = errorJson;
        }
      } catch {
        // Use default error message
      }

      throw new Error(errorMessage);
    }

    return (await response.json()) as T;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    // Try Broker API first (OAuth2), fallback to regular API
    try {
      const account = await this.alpacaRequest<AlpacaAccountResponse>('/v1/accounts', {
        useBrokerAPI: true,
      });

      return {
        accountId: account.id || account.account_number || '',
        optionApprovedLevel: account.option_approved_level,
        optionTradingLevel: account.option_trading_level,
      };
    } catch {
      // Fallback to regular API with direct key auth
      const account = await this.alpacaRequest<AlpacaAccountResponse>('/v2/account', {
        useBrokerAPI: false,
      });

      return {
        accountId: account.id || account.account_number || '',
        optionApprovedLevel: account.option_approved_level,
        optionTradingLevel: account.option_trading_level,
      };
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.getAccountInfo();
      return true;
    } catch {
      return false;
    }
  }

  async placeOptionOrder(
    trade: ITrade,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<OrderResult> {
    try {
      // Convert ITrade to Alpaca option symbol
      const symbol = convertToAlpacaSymbol(
        trade.ticker,
        trade.strike,
        trade.expiryDate,
        trade.optionType
      );

      // Validate account has options approval
      const accountInfo = await this.getAccountInfo();
      if (!accountInfo.optionApprovedLevel || accountInfo.optionApprovedLevel === '0') {
        return {
          success: false,
          error: 'Your Alpaca account is not approved for options trading. Please enable options trading in your Alpaca account settings.',
        };
      }

      // Prepare order body
      const orderBody = {
        symbol,
        qty: String(quantity),
        side: side.toLowerCase(), // 'buy' or 'sell'
        type: 'market',
        time_in_force: 'day',
      };

      // Place order - use Broker API with OAuth2
      const order = await this.alpacaRequest<AlpacaOrderResponse>('/v1/orders', {
        method: 'POST',
        body: orderBody,
        useBrokerAPI: true,
      });

      // Calculate cost information
      const filledQty = parseFloat(order.filled_qty || order.qty || '0');
      const filledAvgPrice = parseFloat(order.filled_avg_price || '0');
      const grossCost = filledQty * filledAvgPrice * 100; // Options are per share, contract = 100 shares
      const commission = parseFloat(order.commission || '0');

      // Calculate regulatory fees
      // Options Regulatory Fee (ORF): $0.02685 per contract (both buys and sells)
      const orf = filledQty * 0.02685;

      // OCC fee: $0.02/contract up to 2750 contracts (capped at $55), then $55 flat
      const occ = filledQty <= 2750 ? filledQty * 0.02 : 55;

      let taf: number | undefined;
      let sec: number | undefined;

      // Trading Activity Fee (TAF): $0.00279 per contract (sells only)
      if (side === 'SELL') {
        taf = filledQty * 0.00279;

        // SEC Regulatory Transaction Fee: 0.000008 × notional (sells only, min $0.01)
        const notional = grossCost;
        sec = Math.max(0.01, notional * 0.000008);
      }

      const totalFees = orf + occ + (taf || 0) + (sec || 0);
      const totalCost = side === 'BUY'
        ? grossCost + commission + totalFees  // Buy: cost + fees
        : grossCost - commission - totalFees;   // Sell: proceeds - fees

      return {
        success: true,
        orderId: order.id || order.client_order_id,
        orderDetails: {
          id: order.id,
          client_order_id: order.client_order_id,
          symbol: order.symbol,
          qty: order.qty,
          filled_qty: order.filled_qty,
          filled_avg_price: order.filled_avg_price,
          status: order.status,
          order_class: order.order_class,
          type: order.type,
          side: order.side,
          time_in_force: order.time_in_force,
          commission: order.commission,
        },
        costInfo: {
          grossCost,
          commission,
          estimatedFees: {
            orf,
            occ,
            ...(taf !== undefined && { taf }),
            ...(sec !== undefined && { sec }),
          },
          totalCost,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error placing order';

      // Provide user-friendly error messages
      if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        return {
          success: false,
          error: 'Alpaca API access denied. Please check your API credentials and account permissions.',
        };
      }

      if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
        return {
          success: false,
          error: 'Invalid option symbol or Alpaca endpoint not found. Please verify the option contract exists.',
        };
      }

      if (errorMessage.includes('422') || errorMessage.includes('Unprocessable')) {
        return {
          success: false,
          error: `Invalid order parameters: ${errorMessage}`,
        };
      }

      return {
        success: false,
        error: `Failed to place order: ${errorMessage}`,
      };
    }
  }
}
