import { IBrokerConnection } from '@/models/BrokerConnection';
import { ITrade } from '@/models/Trade';

export interface BrokerOrderResult {
    success: boolean;
    orderId?: string;
    error?: string;
    orderDetails?: Record<string, unknown>;
    costInfo?: {
        grossCost: number;
        commission: number;
        estimatedFees: Record<string, number>;
        totalCost: number;
    };
}

export interface IBroker {
    placeOptionOrder(
        trade: ITrade,
        side: 'BUY' | 'SELL',
        contracts: number,
        limitPrice?: number
    ): Promise<BrokerOrderResult>;

    getAccountInfo(): Promise<{
        buyingPower?: number;
        accountName?: string;
        accountNumber?: string;
    }>;
}

export function createBroker(
    brokerType: 'snaptrade',
    connection: IBrokerConnection
): IBroker {
    switch (brokerType) {
        case 'snaptrade': {
            // Dynamic import to avoid circular dependencies
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { SnapTradeBroker } = require('./snaptrade');
            return new SnapTradeBroker(connection);
        }
        default:
            throw new Error(`Unsupported broker type: ${brokerType}`);
    }
}

