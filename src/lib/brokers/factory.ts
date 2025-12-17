import { BaseBroker } from './base';
import { AlpacaBroker } from './alpaca';
import { SnapTradeBroker } from './snaptrade';
import { IBrokerConnection } from '@/models/BrokerConnection';

export function createBroker(
  brokerType: 'alpaca' | 'webull' | 'snaptrade',
  connection: IBrokerConnection
): BaseBroker {
  switch (brokerType) {
    case 'alpaca':
      return new AlpacaBroker(connection);
    case 'webull':
      // Placeholder - implement later when Webull is available
      throw new Error('Webull broker not yet implemented');
    case 'snaptrade':
      return new SnapTradeBroker(connection);
    default:
      throw new Error(`Unknown broker type: ${brokerType}`);
  }
}
