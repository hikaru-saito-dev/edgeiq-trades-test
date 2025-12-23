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
    contracts: number,
    limitPrice?: number
  ): Promise<BrokerOrderResult> {
    if (!this.connection.accountId) {
      throw new Error('No account ID configured');
    }

    if (!this.connection.authorizationId) {
      throw new Error('No authorization ID configured');
    }

    const accountId = this.connection.accountId; // Store for TypeScript
    const userSecret = await this.getUserSecret();

    // Refresh account to sync latest permissions and data
    // When closing positions, wait longer to ensure position data is synced
    if (this.connection.authorizationId) {
      await this.client.connections.refreshBrokerageAuthorization({
        authorizationId: this.connection.authorizationId,
        userId: this.connection.snaptradeUserId,
        userSecret,
      });
      // Wait longer when closing to ensure position exists and is synced
      const waitTime = side === 'SELL' ? 2000 : 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
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

      // SnapTrade SDK uses snake_case: 'brokerage_order_id' not 'brokerageOrderId'
      const data = orderData as {
        brokerage_order_id?: string;
        brokerageOrderId?: string;
        id?: string;
        orders?: Array<{
          execution_price?: number | null;
          [key: string]: unknown;
        }>;
      };
      const orderId = data.brokerage_order_id || data.brokerageOrderId || data.id;

      if (!orderId) {
        return {
          success: false,
          error: 'Failed to place order: No order ID in response',
        };
      }

      // Extract execution_price from the orders array if available
      // MlegOrderResponse contains an 'orders' array with AccountOrderRecord objects
      let executionPrice: number | null = null;
      let priceSource: 'broker' | 'market_data' = 'market_data';

      if (data.orders && Array.isArray(data.orders) && data.orders.length > 0) {
        // Get execution_price from the first order (for single-leg orders, there's only one)
        const firstOrder = data.orders[0];
        if (firstOrder.execution_price !== undefined && firstOrder.execution_price !== null) {
          executionPrice = firstOrder.execution_price;
          priceSource = 'broker';
        }
      }

      // Use execution price from broker if available, otherwise use the market data price we sent
      const fillPrice = executionPrice !== null ? executionPrice : trade.fillPrice;
      const grossCost = fillPrice * contracts * 100;

      return {
        success: true,
        orderId,
        orderDetails: orderData as unknown as Record<string, unknown>,
        executionPrice,
        priceSource,
        costInfo: {
          grossCost,
          commission: 0,
          estimatedFees: {},
          totalCost: grossCost,
        },
      };
    };

    // Determine correct action: BUY opens position, SELL closes position
    const action: 'BUY_TO_OPEN' | 'SELL_TO_CLOSE' = side === 'BUY' ? 'BUY_TO_OPEN' : 'SELL_TO_CLOSE';

    // Use placeMlegOrder for options (required structure even for single-leg)
    // Try MARKET order first, fall back to LIMIT if no quote available
    const tryPlaceOrder = async (useLimit: boolean, limitPriceValue?: number): Promise<BrokerOrderResult> => {
      const orderRequest: {
        userId: string;
        userSecret: string;
        accountId: string;
        order_type: 'MARKET' | 'LIMIT';
        time_in_force: 'Day';
        limit_price?: string | null;
        legs: Array<{
          instrument: {
            symbol: string;
            instrument_type: 'OPTION';
          };
          action: 'BUY_TO_OPEN' | 'SELL_TO_CLOSE';
          units: number;
        }>;
      } = {
        userId: this.connection.snaptradeUserId,
        userSecret,
        accountId,
        order_type: useLimit ? 'LIMIT' : 'MARKET',
        time_in_force: 'Day',
        legs: [
          {
            instrument: {
              symbol: occSymbol,
              instrument_type: 'OPTION',
            },
            action,
            units: contracts,
          },
        ],
      };

      // Add limit_price for LIMIT orders (required for LIMIT order type)
      if (useLimit && limitPriceValue !== undefined) {
        orderRequest.limit_price = limitPriceValue.toFixed(2);
      }

      const orderResponse = await this.client.trading.placeMlegOrder(orderRequest);
      return processOrderResponse(orderResponse.data);
    };

    try {
      // Try MARKET order first
      return await tryPlaceOrder(false);
    } catch (error: unknown) {
      // Extract actual error message from SnapTrade response
      let errorMessage = 'Failed to place order with broker';
      let shouldRetryWithLimit = false;

      if (error && typeof error === 'object' && 'responseBody' in error) {
        // Try to extract error message from response body
        const responseBody = typeof error.responseBody === 'string'
          ? JSON.parse(error.responseBody)
          : error.responseBody;

        if (responseBody && typeof responseBody === 'object') {
          errorMessage = (responseBody as { error?: string; message?: string; detail?: string }).error ||
            (responseBody as { error?: string; message?: string; detail?: string }).message ||
            (responseBody as { error?: string; message?: string; detail?: string }).detail ||
            JSON.stringify(responseBody) ||
            errorMessage;

          // Check if error is about no available quote - retry with LIMIT order
          const errorStr = errorMessage.toLowerCase();
          if (errorStr.includes('no available quote') || errorStr.includes('please reenter with a limit')) {
            shouldRetryWithLimit = true;
          }
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
        const errorStr = errorMessage.toLowerCase();
        if (errorStr.includes('no available quote') || errorStr.includes('please reenter with a limit')) {
          shouldRetryWithLimit = true;
        }
      }

      // If error is about no quote, retry with LIMIT order using provided limitPrice or trade.fillPrice
      if (shouldRetryWithLimit) {
        const limitPriceValue = limitPrice || trade.fillPrice;
        if (limitPriceValue) {
          try {
            return await tryPlaceOrder(true, limitPriceValue);
          } catch {
            // If LIMIT order also fails, throw the original error
            throw new Error(errorMessage);
          }
        }
      }

      throw new Error(errorMessage);
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

