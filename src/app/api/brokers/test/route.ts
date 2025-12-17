import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { BrokerConnection, IBrokerConnection } from '@/models/BrokerConnection';
import { createBroker } from '@/lib/brokers/factory';
import { User } from '@/models/User';

export const runtime = 'nodejs';

type TestBody = {
  brokerType?: 'alpaca' | 'webull';
  apiKey?: string;
  apiSecret?: string;
  paperTrading?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findOne({ whopUserId: userId, companyId: companyId });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = (await request.json()) as TestBody;
    const brokerType = body.brokerType || 'alpaca';
    const apiKey = body.apiKey?.trim();
    const apiSecret = body.apiSecret?.trim();
    const paperTrading = body.paperTrading ?? true; // Default to paper trading for testing

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'apiKey and apiSecret are required' },
        { status: 400 }
      );
    }

    // Create a temporary connection object for testing (not saved to DB)
    const tempConnection = {
      userId: user._id,
      brokerType,
      apiKey,
      apiSecret,
      isActive: true,
      paperTrading,
      getDecryptedApiKey: () => apiKey,
      getDecryptedApiSecret: () => apiSecret,
      getDecryptedAccessToken: () => undefined,
    } as unknown as IBrokerConnection;

    try {
      const broker = createBroker(brokerType, tempConnection);
      const accountInfo = await broker.getAccountInfo();
      const isValid = await broker.validateConnection();

      return NextResponse.json({
        success: isValid,
        accountInfo,
        message: isValid
          ? 'Connection successful! You can now save these credentials.'
          : 'Connection failed. Please check your credentials.',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          message: `Connection test failed: ${errorMessage}`,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Broker test error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
