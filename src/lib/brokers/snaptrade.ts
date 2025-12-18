import { Snaptrade } from 'snaptrade-typescript-sdk';
import { IBrokerConnection } from '@/models/BrokerConnection';
import { ITrade } from '@/models/Trade';
import { BrokerOrderResult, IBroker } from './factory';
import { decrypt } from '@/lib/encryption';

export class SnapTradeBroker implements IBroker {
  private connection: IBrokerConnection;
  private client: Snaptrade;

  constructor(connection: IBrokerConnection) {
    this.connection = connection;

    // Initialize SnapTrade client
    const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
    const clientId = process.env.SNAPTRADE_CLIENT_ID;

    if (!consumerKey || !clientId) {
      throw new Error('SnapTrade credentials not configured');
    }

    this.client = new Snaptrade({
      consumerKey,
      clientId,
    });
  }

  private async getUserSecret(): Promise<string> {
    // Decrypt the stored user secret
    const encryptedSecret = this.connection.snaptradeUserSecret;
    return decrypt(encryptedSecret);
  }

  async placeOptionOrder(
    trade: ITrade,
    side: 'BUY' | 'SELL',
    contracts: number
  ): Promise<BrokerOrderResult> {
    try {
      if (!this.connection.accountId) {
        return {
          success: false,
          error: 'No account ID configured for this connection',
        };
      }

      const userSecret = await this.getUserSecret();

      // Format option symbol in OCC format (21 characters)
      // Format: ROOT(6 chars, space-padded) + YYMMDD(6) + C/P(1) + STRIKE*1000(8 digits, zero-padded)
      // Example from SDK: AAPL  251114C00240000 (AAPL call, 2025-11-14, $240 strike)
      // Example: SPY PUT 680 expiring 12/19/2025 -> "SPY   251219P00680000"
      // Note: trade.expiryDate is stored as UTC midnight, so use UTC methods
      const expiryDate = new Date(trade.expiryDate);
      const year = expiryDate.getUTCFullYear().toString().slice(-2); // Last 2 digits of year (YY)
      const month = String(expiryDate.getUTCMonth() + 1).padStart(2, '0'); // MM (1-12)
      const day = String(expiryDate.getUTCDate()).padStart(2, '0'); // DD
      const dateStr = `${year}${month}${day}`; // YYMMDD (6 digits)

      // Root symbol: 6 characters, space-padded on the right
      const rootSymbol = trade.ticker.toUpperCase().padEnd(6, ' ');

      // Option type: C or P
      const optionType = trade.optionType === 'C' ? 'C' : 'P';

      // Strike: multiply by 1000, round, pad to 8 digits
      const strikeInt = Math.round(trade.strike * 1000);
      const strikeStr = String(strikeInt).padStart(8, '0');

      // Combine: ROOT(6) + YYMMDD(6) + C/P(1) + STRIKE(8) = 21 characters
      const occSymbol = `${rootSymbol}${dateStr}${optionType}${strikeStr}`;

      // Place the order using placeForceOrder for options
      // For options: BUY -> BUY_TO_OPEN, SELL -> SELL_TO_OPEN
      // Use 'symbol' field with OCC format (not universal_symbol_id)
      const orderResponse = await this.client.trading.placeForceOrder({
        userId: this.connection.snaptradeUserId,
        userSecret,
        account_id: this.connection.accountId,
        action: side === 'BUY' ? 'BUY_TO_OPEN' : 'SELL_TO_OPEN',
        symbol: occSymbol, // Use OCC format symbol directly
        universal_symbol_id: null, // Must be null when symbol is provided
        order_type: 'Market',
        time_in_force: 'Day',
        units: contracts,
      });

      if (!orderResponse.data) {
        return {
          success: false,
          error: 'Failed to place order: No response data',
        };
      }

      const orderData = orderResponse.data;
      const orderId = orderData.brokerageOrderId || orderData.id || 'unknown';

      // Calculate cost info using the trade fill price
      // Options are priced per share, but each contract represents 100 shares
      const grossCost = trade.fillPrice * contracts * 100;
      const commission = 0; // SnapTrade may provide this in the response
      const totalCost = grossCost + commission;

      return {
        success: true,
        orderId,
        orderDetails: orderData as unknown as Record<string, unknown>,
        costInfo: {
          grossCost,
          commission,
          estimatedFees: {},
          totalCost,
        },
      };
    } catch (error: unknown) {
      // Extract detailed error message from SnapTrade API response
      let errorMessage = 'Unknown error placing order';

      if (error && typeof error === 'object') {
        // Check if it's a SnapTrade SDK error with responseBody
        const snaptradeError = error as {
          message?: string;
          responseBody?: { error?: string; message?: string; detail?: string };
          status?: number;
          statusText?: string;
        };

        // Try to get the actual error message from response body
        if (snaptradeError.responseBody) {
          errorMessage =
            snaptradeError.responseBody.error ||
            snaptradeError.responseBody.message ||
            snaptradeError.responseBody.detail ||
            errorMessage;
        } else if (snaptradeError.message) {
          errorMessage = snaptradeError.message;
        }

        // Add status code context for 403 errors
        if (snaptradeError.status === 403) {
          if (!errorMessage.includes('403') && !errorMessage.includes('Forbidden')) {
            errorMessage = `Forbidden (403): ${errorMessage}. This usually means: 1) Options trading may not be enabled on your account, 2) The account may need to be refreshed, or 3) Your brokerage may have restrictions on options trading.`;
          }
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async getAccountInfo(): Promise<{
    buyingPower?: number;
    accountName?: string;
    accountNumber?: string;
  }> {
    try {
      if (!this.connection.accountId) {
        return {};
      }

      const userSecret = await this.getUserSecret();

      const balanceResponse = await this.client.accountInformation.getUserAccountBalance({
        userId: this.connection.snaptradeUserId,
        userSecret,
        accountId: this.connection.accountId,
      });

      const accountResponse = await this.client.accountInformation.getUserAccountDetails({
        userId: this.connection.snaptradeUserId,
        userSecret,
        accountId: this.connection.accountId,
      });

      // balanceResponse.data is an array of Balance objects
      const balances = balanceResponse.data || [];
      const balance = balances.find(b => b.currency?.code === 'USD') || balances[0];
      const account = accountResponse.data;

      return {
        buyingPower: balance?.buying_power || balance?.cash || undefined,
        accountName: account?.name || account?.number || undefined,
        accountNumber: account?.number || undefined,
      };
    } catch (error) {
      console.error('Error fetching account info:', error);
      return {};
    }
  }
}

