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

  // Helper to safely serialize error object for debugging
  private serializeError(err: unknown): string {
    try {
      if (err instanceof Error) {
        const errorObj: Record<string, unknown> = {
          name: err.name,
          message: err.message,
          stack: err.stack,
        };
        // Add any additional properties
        if (err && typeof err === 'object') {
          Object.keys(err).forEach(key => {
            if (!['name', 'message', 'stack'].includes(key)) {
              try {
                errorObj[key] = (err as unknown as Record<string, unknown>)[key];
              } catch {
                errorObj[key] = '[Unable to serialize]';
              }
            }
          });
        }
        return JSON.stringify(errorObj, null, 2);
      } else if (err && typeof err === 'object') {
        return JSON.stringify(err, null, 2);
      }
      return String(err);
    } catch {
      return String(err);
    }
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
      try {
        await this.client.connections.refreshBrokerageAuthorization({
          authorizationId: this.connection.authorizationId,
          userId: this.connection.snaptradeUserId,
          userSecret,
        });
        // Wait longer when closing to ensure position exists and is synced
        const waitTime = side === 'SELL' ? 2000 : 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } catch (refreshError: unknown) {
        // Extract error message from refresh failure
        let refreshErrorMessage = 'Failed to refresh broker authorization';
        let httpStatus: number | undefined;
        const errorDetails: string[] = [];

        if (refreshError && typeof refreshError === 'object') {
          if ('status' in refreshError && typeof refreshError.status === 'number') {
            httpStatus = refreshError.status;
          } else if ('statusCode' in refreshError && typeof refreshError.statusCode === 'number') {
            httpStatus = refreshError.statusCode;
          } else if ('response' in refreshError && refreshError.response && typeof refreshError.response === 'object') {
            const response = refreshError.response as { status?: number; statusCode?: number; data?: unknown; body?: unknown };
            if (typeof response.status === 'number') {
              httpStatus = response.status;
            } else if (typeof response.statusCode === 'number') {
              httpStatus = response.statusCode;
            }
            const responseBody = response.data || response.body;
            if (responseBody && typeof responseBody === 'object') {
              const body = responseBody as { error?: string; message?: string; detail?: string };
              refreshErrorMessage = body.error || body.message || body.detail || refreshErrorMessage;
            }
          }

          // Handle specific status codes for authorization refresh
          if (httpStatus === 402) {
            refreshErrorMessage = 'Payment Required: Your SnapTrade account may require a paid subscription to access this broker. Please check your SnapTrade subscription status or contact SnapTrade support.';
          } else if (httpStatus === 401) {
            refreshErrorMessage = 'Unauthorized: Your SnapTrade connection has expired. Please reconnect your broker account.';
          } else if (httpStatus === 404) {
            refreshErrorMessage = 'Authorization Not Found: Your broker connection may have been deleted. Please reconnect your broker account.';
          } else if (httpStatus && httpStatus >= 400) {
            refreshErrorMessage = `Authorization refresh failed (${httpStatus}): ${refreshErrorMessage}`;
          }

          // Include error structure for debugging
          errorDetails.push(`Error Structure: ${this.serializeError(refreshError)}`);
          if (httpStatus) {
            errorDetails.push(`HTTP Status: ${httpStatus}`);
          }
          const responseBody = (refreshError as { response?: { data?: unknown; body?: unknown } })?.response?.data || 
                               (refreshError as { response?: { data?: unknown; body?: unknown } })?.response?.body;
          if (responseBody) {
            errorDetails.push(`Response Body: ${JSON.stringify(responseBody, null, 2)}`);
          }
        } else if (refreshError instanceof Error) {
          refreshErrorMessage = refreshError.message;
          // Check for status codes in error message
          const statusMatch = refreshErrorMessage.match(/status code (\d{3})/i) || refreshErrorMessage.match(/(\d{3})/);
          if (statusMatch) {
            const status = parseInt(statusMatch[1], 10);
            httpStatus = status;
            if (status === 402) {
              refreshErrorMessage = 'Payment Required: Your SnapTrade account may require a paid subscription to access this broker. Please check your SnapTrade subscription status or contact SnapTrade support.';
            }
          }
          // Include error structure for debugging
          errorDetails.push(`Error Structure: ${this.serializeError(refreshError)}`);
          if (httpStatus) {
            errorDetails.push(`HTTP Status: ${httpStatus}`);
          }
        } else {
          // Unknown error type - include full serialization
          errorDetails.push(`Error Structure: ${this.serializeError(refreshError)}`);
        }

        // Throw error with clear message and debug info - don't proceed with order if authorization refresh fails
        const fullErrorMessage = errorDetails.length > 0
          ? `${refreshErrorMessage}\n\nDebug Info:\n${errorDetails.join('\n')}`
          : refreshErrorMessage;
        throw new Error(fullErrorMessage);
      }
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
          time_placed?: string | null; // ISO 8601 timestamp when order was placed
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

      // Extract execution_price and time_placed from the orders array if available
      // MlegOrderResponse contains an 'orders' array with AccountOrderRecord objects
      let executionPrice: number | null = null;
      let priceSource: 'broker' | 'market_data' = 'market_data';
      let executedAt: Date | null = null;

      if (data.orders && Array.isArray(data.orders) && data.orders.length > 0) {
        // Get execution_price and time_placed from the first order (for single-leg orders, there's only one)
        const firstOrder = data.orders[0];
        if (firstOrder.execution_price !== undefined && firstOrder.execution_price !== null) {
          executionPrice = firstOrder.execution_price;
          priceSource = 'broker';
        }
        // Extract time_placed timestamp (when order was placed with broker)
        if (firstOrder.time_placed) {
          executedAt = new Date(firstOrder.time_placed);
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
        executedAt,
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
      // Only set limit price when we have a finite number
      if (
        useLimit &&
        typeof limitPriceValue === 'number' &&
        Number.isFinite(limitPriceValue)
      ) {
        orderRequest.limit_price = limitPriceValue.toFixed(2);
      }

      const orderResponse = await this.client.trading.placeMlegOrder(orderRequest);
      return processOrderResponse(orderResponse.data);
    };

    try {
      // Try MARKET order first
      const result = await tryPlaceOrder(false);

      // If execution price not available immediately (status is PENDING), poll continuously until data appears
      // Poll without delays until execution_price is found or timeout is reached
      if (result.success && result.orderId && (!result.executionPrice || result.executionPrice === null)) {
        const maxTimeoutMs = parseInt(process.env.EXECUTION_PRICE_TIMEOUT_MS || '30000', 10); // Default 30 seconds timeout
        const startTime = Date.now();
        let attempt = 0;

        // Poll continuously without delays until execution data appears
        while (Date.now() - startTime < maxTimeoutMs) {
          attempt++;
          try {
            const userSecret = await this.getUserSecret();
            const orderDetailResponse = await this.client.accountInformation.getUserAccountOrderDetail({
              accountId: this.connection.accountId!,
              userId: this.connection.snaptradeUserId,
              userSecret,
              brokerage_order_id: result.orderId,
            });

            // SnapTrade order detail can be either an order record or a wrapper containing `orders: [...]`
            const detail = orderDetailResponse.data as {
              execution_price?: number | null;
              time_placed?: string | null;
              time_executed?: string | null;
              status?: string | null;
              orders?: Array<{
                execution_price?: number | null;
                time_placed?: string | null;
                time_executed?: string | null;
                status?: string | null;
                [key: string]: unknown;
              }>;
              [key: string]: unknown;
            };
            const order = Array.isArray(detail?.orders) && detail.orders.length > 0 ? detail.orders[0] : detail;

            // Update orders[0] with final execution data - replace stale initial data
            // This ensures orders[0] always has the latest execution_price, status, etc.
            if (result.orderDetails) {
              // Extract the final order data (either from detail.orders[0] or detail itself)
              const finalOrder = Array.isArray(detail?.orders) && detail.orders.length > 0
                ? detail.orders[0]
                : order; // 'order' is already extracted above (line 247)

              // Update orders[0] with final execution data, merging initial structure with final data
              const updatedOrders = Array.isArray(result.orderDetails.orders) && result.orderDetails.orders.length > 0
                ? [{ ...result.orderDetails.orders[0], ...finalOrder }] // Merge: initial fields + final execution data
                : [finalOrder]; // If no initial orders, use final order

              result.orderDetails = {
                ...result.orderDetails,
                brokerage_order_id: detail?.brokerage_order_id || result.orderDetails.brokerage_order_id,
                orders: updatedOrders,
                // Remove orderDetail - orders[0] is now the single source of truth
              };
            } else {
              // No initial orderDetails, create new structure with final data
              const finalOrder = Array.isArray(detail?.orders) && detail.orders.length > 0
                ? detail.orders[0]
                : order;

              result.orderDetails = {
                brokerage_order_id: detail?.brokerage_order_id,
                orders: [finalOrder],
              };
            }

            // Always update executedAt from order detail if available (even if execution_price is null)
            // Prefer time_executed if available (order has filled), otherwise use time_placed (order is pending)
            if (order?.time_executed) {
              result.executedAt = new Date(order.time_executed);
            } else if (order?.time_placed) {
              // Update time_placed even if executedAt was already set (order detail is more accurate)
              result.executedAt = new Date(order.time_placed);
            }

            // Check if order has executed and execution_price is available
            if (order?.execution_price !== undefined && order.execution_price !== null) {
              result.executionPrice = order.execution_price;
              result.priceSource = 'broker';

              // Recalculate cost info with actual execution price
              const fillPrice = order.execution_price;
              const grossCost = fillPrice * contracts * 100;
              result.costInfo = {
                grossCost,
                commission: 0,
                estimatedFees: {},
                totalCost: grossCost,
              };
              // Order has executed, exit loop immediately
              console.log(`Order executed after ${attempt} attempts (${Date.now() - startTime}ms)`);
              break;
            }

            // If order status is not PENDING (e.g., FILLED, EXECUTED), stop polling even if execution_price is null
            // Some brokers may not provide execution_price immediately even after fill
            if (order?.status && order.status !== 'PENDING' && order.status !== 'pending') {
              console.log(`Order status changed to ${order.status} after ${attempt} attempts (${Date.now() - startTime}ms)`);
              break;
            }

            // Continue polling immediately (no delay) - only break if timeout or data found
          } catch (error) {
            // If order detail check fails, log warning but continue polling
            console.warn(`Could not fetch execution price from order detail (attempt ${attempt}):`, error);
            // Continue polling - don't break on errors unless timeout
          }

          // Small delay only to prevent overwhelming the API (10ms - minimal)
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (attempt > 0 && (!result.executionPrice || result.executionPrice === null)) {
          result.executionPriceTimedOut = true;
          console.warn(`Order detail polling timed out after ${attempt} attempts (${Date.now() - startTime}ms). Continuing with market data price.`);
        }
      }

      return result;
    } catch (error: unknown) {
      // Extract actual error message from SnapTrade response
      let errorMessage = 'Failed to place order with broker';
      let shouldRetryWithLimit = false;
      let httpStatus: number | undefined;
      const errorDetails: string[] = [];

      // Check for HTTP status code in error object
      if (error && typeof error === 'object') {
        // SnapTrade SDK may include status/statusCode directly
        if ('status' in error && typeof error.status === 'number') {
          httpStatus = error.status;
        } else if ('statusCode' in error && typeof error.statusCode === 'number') {
          httpStatus = error.statusCode;
        } else if ('response' in error && error.response && typeof error.response === 'object') {
          // Check nested response object (common in HTTP client libraries)
          const response = error.response as { status?: number; statusCode?: number; data?: unknown; body?: unknown };
          if (typeof response.status === 'number') {
            httpStatus = response.status;
          } else if (typeof response.statusCode === 'number') {
            httpStatus = response.statusCode;
          }
        }

        // Extract response body from various possible locations
        let responseBody: unknown = null;
        if ('responseBody' in error) {
          responseBody = error.responseBody;
        } else if ('response' in error && error.response && typeof error.response === 'object') {
          const response = error.response as { data?: unknown; body?: unknown };
          responseBody = response.data || response.body;
        } else if ('body' in error) {
          responseBody = error.body;
        }

        // Parse response body if it's a string
        if (typeof responseBody === 'string') {
          const responseBodyStr = responseBody;
          try {
            responseBody = JSON.parse(responseBodyStr);
          } catch {
            // If not JSON, use as-is
            errorMessage = responseBodyStr;
          }
        }

        // Extract error message from response body
        if (responseBody && typeof responseBody === 'object') {
          const body = responseBody as { error?: string; message?: string; detail?: string; [key: string]: unknown };
          errorMessage = body.error || body.message || body.detail || JSON.stringify(responseBody) || errorMessage;
        }

        // Handle specific HTTP status codes with user-friendly messages
        if (httpStatus === 402) {
          errorMessage = 'Payment Required: Your SnapTrade account may require a paid subscription to trade with this broker. Please check your SnapTrade subscription status or contact SnapTrade support.';
        } else if (httpStatus === 403) {
          errorMessage = 'Forbidden: Options trading may not be enabled for this account, or your account may have restrictions. Please check your broker account settings.';
        } else if (httpStatus === 401) {
          errorMessage = 'Unauthorized: Your SnapTrade connection may have expired. Please reconnect your broker account.';
        } else if (httpStatus === 404) {
          errorMessage = 'Not Found: The account or authorization may have been deleted. Please reconnect your broker account.';
        } else if (httpStatus === 429) {
          errorMessage = 'Rate Limit Exceeded: Too many requests. Please wait a moment and try again.';
        } else if (httpStatus && httpStatus >= 400) {
          errorMessage = `Broker API error (${httpStatus}): ${errorMessage}`;
        }

        // Include error structure for debugging
        errorDetails.push(`Error Structure: ${this.serializeError(error)}`);
        if (httpStatus) {
          errorDetails.push(`HTTP Status: ${httpStatus}`);
        }
        if (responseBody) {
          errorDetails.push(`Response Body: ${JSON.stringify(responseBody, null, 2)}`);
        }

        // Check if error is about no available quote - retry with LIMIT order
        const errorStr = errorMessage.toLowerCase();
        if (errorStr.includes('no available quote') || errorStr.includes('please reenter with a limit')) {
          shouldRetryWithLimit = true;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
        const errorStr = errorMessage.toLowerCase();
        if (errorStr.includes('no available quote') || errorStr.includes('please reenter with a limit')) {
          shouldRetryWithLimit = true;
        }
        // Check if error message contains HTTP status codes (e.g., "Request failed with status code 402")
        const statusMatch = errorMessage.match(/status code (\d{3})/i) || errorMessage.match(/(\d{3})/);
        if (statusMatch) {
          const status = parseInt(statusMatch[1], 10);
          httpStatus = status;
          if (status === 402) {
            errorMessage = 'Payment Required: Your SnapTrade account may require a paid subscription to trade with this broker. Please check your SnapTrade subscription status or contact SnapTrade support.';
          } else if (status === 403) {
            errorMessage = 'Forbidden: Options trading may not be enabled for this account, or your account may have restrictions.';
          } else if (status === 401) {
            errorMessage = 'Unauthorized: Your SnapTrade connection may have expired. Please reconnect your broker account.';
          }
        }
        // Include error structure for debugging
        errorDetails.push(`Error Structure: ${this.serializeError(error)}`);
        if (httpStatus) {
          errorDetails.push(`HTTP Status: ${httpStatus}`);
        }
      } else {
        // Unknown error type - include full serialization
        errorDetails.push(`Error Structure: ${this.serializeError(error)}`);
      }

      // If error is about no quote, retry with LIMIT order using provided limitPrice or trade.fillPrice
      if (shouldRetryWithLimit) {
        const limitPriceValue = limitPrice || trade.fillPrice;
        if (limitPriceValue) {
          try {
            return await tryPlaceOrder(true, limitPriceValue);
          } catch {
            // If LIMIT order also fails, throw the original error with details
            const fullErrorMessage = errorDetails.length > 0
              ? `${errorMessage}\n\nDebug Info:\n${errorDetails.join('\n')}`
              : errorMessage;
            throw new Error(fullErrorMessage);
          }
        }
      }

      // Include error details in the final error message
      const fullErrorMessage = errorDetails.length > 0
        ? `${errorMessage}\n\nDebug Info:\n${errorDetails.join('\n')}`
        : errorMessage;
      throw new Error(fullErrorMessage);
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

