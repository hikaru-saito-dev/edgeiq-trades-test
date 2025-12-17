import { Snaptrade } from 'snaptrade-typescript-sdk';
import { BaseBroker, OrderResult, AccountInfo } from './base';
import { IBrokerConnection } from '@/models/BrokerConnection';
import { ITrade } from '@/models/Trade';

const clientId = process.env.SNAPTRADE_CLIENT_ID;
const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;

if (!clientId || !consumerKey) {
  throw new Error('SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY must be set');
}

const snaptrade = new Snaptrade({ clientId, consumerKey });

/**
 * SnapTrade broker implementation
 * Uses SnapTrade SDK to place option trades via connected broker accounts
 */
export class SnapTradeBroker extends BaseBroker {
  constructor(connection: IBrokerConnection) {
    super(connection);

    if (connection.brokerType !== 'snaptrade') {
      throw new Error('SnapTradeBroker requires brokerType to be "snaptrade"');
    }

    if (!connection.snaptradeUserId || !connection.snaptradeAccountId) {
      throw new Error('SnapTrade connection missing required fields: snaptradeUserId and snaptradeAccountId');
    }
  }

  /**
   * Place an option order via SnapTrade
   */
  async placeOptionOrder(
    trade: ITrade,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<OrderResult> {
    const userSecret = this.connection.getDecryptedSnaptradeUserSecret();
    if (!userSecret) {
      return {
        success: false,
        error: 'Missing SnapTrade user secret',
      };
    }

    if (!this.connection.snaptradeUserId || !this.connection.snaptradeAccountId) {
      return {
        success: false,
        error: 'Missing SnapTrade user ID or account ID',
      };
    }

    try {
      // Convert trade to SnapTrade option symbol format
      // Format: "TICKER YYYY-MM-DD STRIKE C/P" (e.g., "AAPL 2024-12-20 190 C")
      const expiryDate = new Date(trade.expiryDate);
      const year = expiryDate.getFullYear();
      const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
      const day = String(expiryDate.getDate()).padStart(2, '0');
      const optionType = trade.optionType === 'C' ? 'C' : 'P';
      const optionSymbol = `${trade.ticker} ${year}-${month}-${day} ${trade.strike} ${optionType}`;

      // Map side to SnapTrade action
      // BUY -> BUY_TO_OPEN, SELL -> SELL_TO_CLOSE (for closing) or SELL_TO_OPEN (for opening)
      const action = side === 'BUY' ? 'BUY_TO_OPEN' : 'SELL_TO_CLOSE';

      // Place order via SnapTrade
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderResp = await snaptrade.trading.placeMlegOrder({
        userId: this.connection.snaptradeUserId,
        userSecret: userSecret,
        accountId: this.connection.snaptradeAccountId,
        options: [
          {
            action: action,
            quantity: quantity,
            optionSymbol: optionSymbol,
          },
        ],
        timeInForce: 'DAY',
        orderType: 'MARKET', // Use market orders to match existing behavior
      } as any);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderData = (orderResp.data as any);

      // Calculate cost (SnapTrade may not provide detailed cost breakdown, so estimate)
      const filledQty = parseFloat(orderData.filled_quantity || String(quantity));
      const filledPrice = parseFloat(orderData.filled_price || String(trade.fillPrice));
      const grossCost = filledQty * filledPrice * 100; // Options are per 100 shares
      const commission = parseFloat(orderData.commission || '0');

      // Estimate fees (same as Alpaca)
      const contracts = filledQty;
      const orf = contracts * 0.02685; // Options Regulatory Fee
      const occ = Math.min(contracts * 0.02, 55); // OCC fee (capped at $55)
      const taf = side === 'SELL' ? contracts * 0.00279 : 0; // Trading Activity Fee (sells only)
      const notional = grossCost;
      const sec = side === 'SELL' ? Math.max(notional * 0.000008, 0.01) : 0; // SEC fee (sells only, min $0.01)

      const estimatedFees = {
        orf,
        occ,
        taf,
        sec,
      };

      const totalCost = grossCost + commission + orf + occ + taf + sec;

      return {
        success: true,
        orderId: orderData.id || orderData.order_id,
        orderDetails: orderData,
        costInfo: {
          grossCost,
          commission,
          estimatedFees,
          totalCost,
        },
      };
    } catch (error) {
      console.error('SnapTrade placeOptionOrder error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `SnapTrade order failed: ${message}`,
      };
    }
  }

  /**
   * Get account information
   */
  async getAccountInfo(): Promise<AccountInfo> {
    const userSecret = this.connection.getDecryptedSnaptradeUserSecret();
    if (!userSecret || !this.connection.snaptradeUserId || !this.connection.snaptradeAccountId) {
      throw new Error('Missing SnapTrade credentials');
    }

    try {
      const accountResp = await snaptrade.accountInformation.getUserAccountPositions({
        userId: this.connection.snaptradeUserId,
        userSecret: userSecret,
        accountId: this.connection.snaptradeAccountId,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accountData = (accountResp.data as any);

      return {
        accountId: this.connection.snaptradeAccountId,
        optionApprovedLevel: accountData.account?.option_level || 'UNKNOWN',
        optionTradingLevel: accountData.account?.option_level || 'UNKNOWN',
        ...accountData,
      };
    } catch (error) {
      console.error('SnapTrade getAccountInfo error:', error);
      throw error;
    }
  }

  /**
   * Validate the connection
   */
  async validateConnection(): Promise<boolean> {
    try {
      await this.getAccountInfo();
      return true;
    } catch {
      return false;
    }
  }
}
