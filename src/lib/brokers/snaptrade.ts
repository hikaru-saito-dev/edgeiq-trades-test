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

      // Format expiry date for SnapTrade (YYYY-MM-DD)
      const expiryDate = new Date(trade.expiryDate);
      const expiryDateStr = expiryDate.toISOString().split('T')[0];

      // Get option symbol format for SnapTrade
      // SnapTrade uses format like: AAPL_20250117_C_200.00
      const optionSymbol = `${trade.ticker}_${expiryDateStr.replace(/-/g, '')}_${trade.optionType === 'C' ? 'C' : 'P'}_${trade.strike.toFixed(2)}`;

      // Get quote first to verify the option exists
      const quoteResponse = await this.client.trading.getUserAccountQuotes({
        userId: this.connection.snaptradeUserId,
        userSecret,
        accountId: this.connection.accountId,
        symbols: optionSymbol, // Comma-separated string for multiple symbols
      });

      if (!quoteResponse.data || quoteResponse.data.length === 0) {
        return {
          success: false,
          error: `Option symbol ${optionSymbol} not found or not tradeable`,
        };
      }

      const quote = quoteResponse.data[0];
      const lastPrice = quote.last_trade_price || quote.bid_price || trade.fillPrice;

      // Get universal symbol ID from quote
      const universalSymbolId = quote.symbol?.id;
      if (!universalSymbolId) {
        return {
          success: false,
          error: `Could not find universal symbol ID for ${optionSymbol}`,
        };
      }

      // Place the order using placeForceOrder for options
      // For options: BUY -> BUY_TO_OPEN, SELL -> SELL_TO_OPEN
      // TradingApiPlaceForceOrderRequest = { userId, userSecret } & ManualTradeFormWithOptions
      const orderResponse = await this.client.trading.placeForceOrder({
        userId: this.connection.snaptradeUserId,
        userSecret,
        account_id: this.connection.accountId,
        action: side === 'BUY' ? 'BUY' : 'SELL',
        universal_symbol_id: universalSymbolId,
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

      // Calculate cost info
      const grossCost = lastPrice * contracts * 100; // Options are per 100 shares
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
    } catch (error) {
      console.error('SnapTrade order error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error placing order',
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

