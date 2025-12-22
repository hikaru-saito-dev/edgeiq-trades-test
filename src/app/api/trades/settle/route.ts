import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import mongoose from 'mongoose';
import { Trade } from '@/models/Trade';
import { TradeFill } from '@/models/TradeFill';
import { User } from '@/models/User';
import { Log } from '@/models/Log';
import { settleTradeSchema } from '@/utils/tradeValidation';
import { isMarketOpen } from '@/utils/marketHours';
import { formatExpiryDateForAPI, getContractByTicker, getOptionContractSnapshot, getMarketFillPrice } from '@/lib/polygon';
import { notifyTradeSettled } from '@/lib/tradeNotifications';
// Broker sync handled via broker abstraction layer
import { z } from 'zod';

export const runtime = 'nodejs';

/**
 * POST /api/trades/settle
 * Create a SELL fill (scale-out/close)
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    // Read userId and companyId from headers
    const userId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find user with company membership
    const { getUserForCompany } = await import('@/lib/userHelpers');
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }
    const userResult = await getUserForCompany(userId, companyId);
    if (!userResult || !userResult.membership) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { user, membership } = userResult;

    // Check market hours
    const now = new Date();
    if (!isMarketOpen(now)) {
      return NextResponse.json({
        error: 'Market is closed. Trades can only be created/settled between 09:30–16:00 EST.',
      }, { status: 400 });
    }

    const body = await request.json();

    // Validate request data
    let validated;
    try {
      validated = settleTradeSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    // Atomically find and update trade to prevent race conditions
    // This ensures only one settlement can proceed if multiple requests arrive simultaneously
    const trade = await Trade.findOneAndUpdate(
      {
      _id: validated.tradeId,
      userId: user._id,
      whopUserId: user.whopUserId,
      side: 'BUY', // Only settle BUY trades
        status: 'OPEN', // Only allow settlement of OPEN trades
        remainingOpenContracts: { $gte: validated.contracts }, // Ensure enough contracts available
      },
      {
        $inc: { remainingOpenContracts: -validated.contracts }, // Atomically decrement
      },
      {
        new: false, // Return original document before update
        runValidators: true,
      }
    );

    if (!trade) {
      // Trade not found, not OPEN, or insufficient contracts
      // Check which condition failed for better error message
      const tradeCheck = await Trade.findOne({
        _id: validated.tradeId,
        userId: user._id,
        whopUserId: user.whopUserId,
        side: 'BUY',
      });

      if (!tradeCheck) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

      if (tradeCheck.status !== 'OPEN') {
      return NextResponse.json({
        error: 'Cannot settle trade that is not OPEN.',
      }, { status: 400 });
    }

      if (validated.contracts > tradeCheck.remainingOpenContracts) {
        return NextResponse.json({
          error: `Cannot sell ${validated.contracts} contracts. Only ${tradeCheck.remainingOpenContracts} contracts remaining.`,
        }, { status: 400 });
      }

      // Fallback error (shouldn't happen)
      return NextResponse.json({
        error: 'Unable to settle trade. Please try again.',
      }, { status: 400 });
    }

    // Always use market orders - fetch market price via Massive.com API
    // Use stored option contract if available, otherwise reconstruct
    const expiryDateAPI = formatExpiryDateForAPI(
      `${String(trade.expiryDate.getMonth() + 1).padStart(2, '0')}/${String(trade.expiryDate.getDate()).padStart(2, '0')}/${trade.expiryDate.getFullYear()}`
    );
    const contractType = trade.optionType === 'C' ? 'call' : 'put';

    let snapshot = null;

    if (trade.optionContract) {
      snapshot = await getContractByTicker(trade.ticker, trade.optionContract);
    }

    if (!snapshot) {
      const { snapshot: fetchedSnapshot, error: snapshotError } = await getOptionContractSnapshot(
        trade.ticker,
        trade.strike,
        expiryDateAPI,
        contractType
      );

      if (snapshotError || !fetchedSnapshot) {
        // Determine error message based on error type
        let errorMessage = 'Unable to fetch market data to settle trade. Please try again.';

        if (snapshotError) {
          switch (snapshotError.type) {
            case 'not_found':
              errorMessage = snapshotError.message;
              break;
            case 'invalid_input':
              errorMessage = snapshotError.message;
              break;
            case 'auth_error':
              errorMessage = 'Market data service authentication failed. Please contact support.';
              break;
            case 'network_error':
              errorMessage = 'Unable to connect to market data service. Please try again.';
              break;
            case 'api_error':
              errorMessage = 'Market data service error. Please try again.';
              break;
            default:
              errorMessage = snapshotError.message || errorMessage;
          }
        }

        return NextResponse.json({
          error: errorMessage,
        }, { status: 400 });
      }

      snapshot = fetchedSnapshot;
    }

    const marketFillPrice = getMarketFillPrice(snapshot);
    if (marketFillPrice === null) {
      return NextResponse.json({
        error: 'Unable to determine market price. Please try again.',
      }, { status: 400 });
    }

    const finalFillPrice = marketFillPrice;
    const referencePrice = snapshot.last_quote?.midpoint ?? snapshot.last_trade?.price ?? marketFillPrice;
    const refTimestamp = new Date();

    const optionContractTicker = snapshot.details?.ticker || snapshot.ticker || null;
    if (!trade.optionContract && optionContractTicker) {
      trade.optionContract = optionContractTicker;
    }

    // Calculate notional for this SELL fill
    const sellNotional = validated.contracts * finalFillPrice * 100;

    // Calculate new remaining contracts (already decremented atomically)
    const newRemainingContracts = trade.remainingOpenContracts - validated.contracts;

    // Start database session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
    // Sync settlement to broker BEFORE updating database
      // Only sync if the trade was actually placed with the broker (has valid brokerOrderId)
      // If broker sync fails, the transaction will rollback
      if (trade.brokerOrderId && trade.brokerOrderId !== 'unknown' && trade.brokerConnectionId) {
    try {
      const { BrokerConnection } = await import('@/models/BrokerConnection');
          const brokerConnection = await BrokerConnection.findOne({
          _id: trade.brokerConnectionId,
          userId: user._id,
          isActive: true,
          }).session(session);

      if (brokerConnection) {
        const { createBroker } = await import('@/lib/brokers/factory');
        const broker = createBroker(brokerConnection.brokerType, brokerConnection);
            // Pass market price as limit price for closing positions (required when no quote available)
        const result = await broker.placeOptionOrder(
          trade,
          'SELL',
              validated.contracts,
              finalFillPrice
        );

        if (!result.success) {
              await session.abortTransaction();
              await session.endSession();
          return NextResponse.json({
            error: result.error || 'Failed to place sell order with broker',
          }, { status: 400 });
        }
      }
    } catch (brokerError) {
          await session.abortTransaction();
          await session.endSession();
      const errorMessage = brokerError instanceof Error ? brokerError.message : 'Broker sync failed';
      console.error('Error syncing settlement to broker:', brokerError);
      return NextResponse.json({
        error: errorMessage,
      }, { status: 400 });
        }
    }

      // Create SELL fill within transaction
      const fill = await TradeFill.create([{
      tradeId: trade._id,
      side: 'SELL',
      contracts: validated.contracts,
      fillPrice: finalFillPrice,
      priceVerified: true,
      refPrice: referencePrice || undefined,
      refTimestamp,
      notional: sellNotional,
      isMarketOrder: true, // Always market orders
      }], { session });

      // Get all SELL fills for this trade to calculate totals (within transaction)
      const allFills = await TradeFill.find({ tradeId: trade._id }).session(session).lean();
    const totalSellNotional = allFills.reduce((sum, f) => sum + (f.notional || 0), 0);

    // Calculate net P&L
    const netPnl = totalSellNotional - (trade.totalBuyNotional || 0);

      // Update trade with totals and status (if closed)
      const updateData: {
        totalSellNotional: number;
        status?: 'CLOSED';
        netPnl?: number;
        outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN';
      } = {
        totalSellNotional,
      };

    // If all contracts are sold, close the trade and determine outcome
    if (newRemainingContracts === 0) {
        updateData.status = 'CLOSED';
        updateData.netPnl = netPnl;

      if (netPnl > 0) {
          updateData.outcome = 'WIN';
      } else if (netPnl < 0) {
          updateData.outcome = 'LOSS';
      } else {
          updateData.outcome = 'BREAKEVEN';
      }
    }

      // Atomically update trade with totals and status (within transaction)
      const updatedTrade = await Trade.findByIdAndUpdate(
        trade._id,
        updateData,
        { new: true, runValidators: true, session }
      );

      if (!updatedTrade) {
        await session.abortTransaction();
        await session.endSession();
        console.error('Failed to update trade after settlement:', trade._id);
        return NextResponse.json(
          { error: 'Failed to update trade. Please contact support.' },
          { status: 500 }
        );
      }

      // Log the action (within transaction)
      await Log.create([{
      userId: user._id,
      action: 'trade_settled',
      metadata: {
          tradeId: updatedTrade._id,
          fillId: fill[0]._id,
        contracts: validated.contracts,
        fillPrice: finalFillPrice,
        remainingContracts: newRemainingContracts,
          status: updatedTrade.status,
          outcome: updatedTrade.outcome,
      },
      }], { session });

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      // Send notification (outside transaction - fire and forget)
      notifyTradeSettled(updatedTrade, validated.contracts, finalFillPrice, user).catch((err) => {
        console.error('Error sending settlement notification:', err);
      });

    // Format message
      const expiryFormatted = `${String(updatedTrade.expiryDate.getMonth() + 1)}/${String(updatedTrade.expiryDate.getDate())}/${updatedTrade.expiryDate.getFullYear()}`;
      const optionTypeLabel = updatedTrade.optionType === 'C' ? 'C' : 'P';
      const message = `Sell Order: ${validated.contracts}x ${updatedTrade.ticker} ${updatedTrade.strike}${optionTypeLabel} ${expiryFormatted} @ $${finalFillPrice.toFixed(2)}`;

    return NextResponse.json({
        fill: fill[0],
        trade: updatedTrade,
      message,
      remainingContracts: newRemainingContracts,
      isClosed: newRemainingContracts === 0,
    }, { status: 201 });
    } catch (transactionError) {
      // Rollback transaction on any error
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      await session.endSession();

      // Re-throw to be handled by outer catch
      throw transactionError;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error settling trade:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

