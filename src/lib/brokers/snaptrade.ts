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

      if (!this.connection.authorizationId) {
        return {
          success: false,
          error: 'No authorization ID configured for this connection',
        };
      }

      const userSecret = await this.getUserSecret();

      // Refresh account to ensure latest permissions and data are synced
      // This is recommended by SnapTrade before placing orders
      try {
        await this.client.connections.refreshBrokerageAuthorization({
          authorizationId: this.connection.authorizationId,
          userId: this.connection.snaptradeUserId,
          userSecret,
        });
        // Wait a moment for refresh to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (refreshError) {
        // Log but don't fail - refresh is optional
        console.warn('Account refresh failed (continuing anyway):', refreshError);
      }

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

      // Helper to process order response and calculate costs
      const processOrderResponse = (orderData: unknown): BrokerOrderResult => {
        if (!orderData) {
          return {
            success: false,
            error: 'Failed to place order: No response data',
          };
        }

        const data = orderData as { brokerageOrderId?: string; id?: string };
        const orderId = data.brokerageOrderId || data.id || 'unknown';
        const grossCost = trade.fillPrice * contracts * 100;

        return {
          success: true,
          orderId,
          orderDetails: orderData as unknown as Record<string, unknown>,
          costInfo: {
            grossCost,
            commission: 0,
            estimatedFees: {},
            totalCost: grossCost,
          },
        };
      };

      // Try placeMlegOrder first (preferred for options, even single-leg)
      // This matches the API documentation structure with legs array
      try {
        const orderResponse = await this.client.trading.placeMlegOrder({
          userId: this.connection.snaptradeUserId,
          userSecret,
          accountId: this.connection.accountId,
          order_type: 'MARKET',
          time_in_force: 'Day',
          legs: [
            {
              instrument: {
                symbol: occSymbol,
                instrument_type: 'OPTION',
              },
              action: side === 'BUY' ? 'BUY_TO_OPEN' : 'SELL_TO_OPEN',
              units: contracts,
            },
          ],
        });

        return processOrderResponse(orderResponse.data);
      } catch (mlegError) {
        // If placeMlegOrder fails, fall back to placeForceOrder
        // This handles brokerages that don't support multi-leg orders
        try {
          const orderResponse = await this.client.trading.placeForceOrder({
            userId: this.connection.snaptradeUserId,
            userSecret,
            account_id: this.connection.accountId,
            action: side === 'BUY' ? 'BUY_TO_OPEN' : 'SELL_TO_OPEN',
            symbol: occSymbol,
            universal_symbol_id: null,
            order_type: 'Market',
            time_in_force: 'Day',
            units: contracts,
          });

          return processOrderResponse(orderResponse.data);
        } catch {
          // Both methods failed - rethrow the original mlegError
          throw mlegError;
        }
      }
    } catch (error: unknown) {
      // Extract detailed error message from SnapTrade response
      let errorMessage = 'Failed to place order';

      if (error && typeof error === 'object') {
        const snaptradeError = error as {
          message?: string;
          responseBody?: unknown;
          status?: number;
          response?: {
            data?: {
              error?: string;
              message?: string;
              detail?: string;
              errors?: Array<{ message?: string; field?: string }>;
            };
          };
        };

        // Extract error message from response body
        const responseData = snaptradeError.response?.data;
        if (responseData) {
          errorMessage = responseData.message || responseData.error || responseData.detail ||
            (responseData.errors?.map((e: { message?: string; field?: string }) => e.message || e.field).join(', ')) ||
            errorMessage;
        } else if (snaptradeError.responseBody && typeof snaptradeError.responseBody === 'object') {
          const body = snaptradeError.responseBody as { error?: string; message?: string; detail?: string };
          errorMessage = body.message || body.error || body.detail || errorMessage;
        } else if (snaptradeError.message) {
          // Extract first line of error message, removing technical details
          errorMessage = snaptradeError.message.split('\n')[0].trim();
        }

        // Provide user-friendly guidance for common errors
        if (snaptradeError.status === 403) {
          if (!errorMessage || errorMessage === 'Failed to place order') {
            errorMessage = 'Account does not have permission to place this order. Please verify options trading is enabled.';
          }
        } else if (snaptradeError.status === 400) {
          if (!errorMessage || errorMessage === 'Failed to place order') {
            errorMessage = 'Invalid order request. Please verify the option details are correct.';
          }
        }
      } else if (error instanceof Error) {
        errorMessage = error.message.split('\n')[0].trim();
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

