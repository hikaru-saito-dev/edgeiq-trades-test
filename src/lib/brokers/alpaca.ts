import { BaseBroker, OrderResult, AccountInfo } from './base';
import { IBrokerConnection } from '@/models/BrokerConnection';
import { ITrade } from '@/models/Trade';
import { convertToAlpacaSymbol } from '@/utils/optionSymbol';

const ALPACA_PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE_BASE_URL = 'https://api.alpaca.markets';

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

  private async alpacaRequest<T>(
    path: string,
    options: { method?: string; body?: Record<string, unknown> } = {}
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const apiKey = this.getApiKey();
    const apiSecret = this.getApiSecret();

    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      'Content-Type': 'application/json',
    };

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
    const account = await this.alpacaRequest<AlpacaAccountResponse>('/v2/account');

    return {
      accountId: account.id || account.account_number || '',
      optionApprovedLevel: account.option_approved_level,
      optionTradingLevel: account.option_trading_level,
    };
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

      // Place order
      const order = await this.alpacaRequest<AlpacaOrderResponse>('/v2/orders', {
        method: 'POST',
        body: orderBody,
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
