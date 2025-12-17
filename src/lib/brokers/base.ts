import { ITrade } from '@/models/Trade';
import { IBrokerConnection } from '@/models/BrokerConnection';

export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  // Detailed order information from broker
  orderDetails?: {
    id: string;
    client_order_id?: string;
    symbol: string;
    qty: string;
    filled_qty?: string;
    filled_avg_price?: string | null;
    status: string;
    order_class?: string;
    type: string;
    side: string;
    time_in_force: string;
    commission?: string;
    [key: string]: unknown; // Allow broker-specific fields
  };
  // Cost calculation helpers
  costInfo?: {
    grossCost: number; // filled_qty * filled_avg_price * 100
    commission: number;
    estimatedFees: {
      orf: number; // Options Regulatory Fee: $0.02685 per contract
      occ: number; // OCC fee: $0.02/contract (capped at $55)
      taf?: number; // Trading Activity Fee: $0.00279 per contract (sells only)
      sec?: number; // SEC Regulatory Transaction Fee: 0.000008 × notional (sells only, min $0.01)
    };
    totalCost: number; // grossCost + commission + all fees
  };
}

export interface AccountInfo {
  accountId: string;
  optionApprovedLevel?: string;
  optionTradingLevel?: string;
  [key: string]: unknown; // Allow broker-specific fields
}

export abstract class BaseBroker {
  constructor(protected connection: IBrokerConnection) { }

  /**
   * Place an option order (BUY or SELL)
   */
  abstract placeOptionOrder(
    trade: ITrade,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<OrderResult>;

  /**
   * Get account information
   */
  abstract getAccountInfo(): Promise<AccountInfo>;

  /**
   * Validate the broker connection
   */
  abstract validateConnection(): Promise<boolean>;
}
