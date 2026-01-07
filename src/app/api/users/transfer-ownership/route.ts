import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { User, CompanyMembership } from '@/models/User';
import { z } from 'zod';
import mongoose from 'mongoose';

export const runtime = 'nodejs';

const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string(),
});

/**
 * POST /api/users/transfer-ownership
 * Transfer company ownership from current companyOwner to another user
 * Only companyOwner can transfer ownership
 * Current owner becomes 'owner' role after transfer
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const headers = await import('next/headers').then(m => m.headers());

    // Read userId and companyId from headers
    const currentUserId = headers.get('x-user-id');
    const companyId = headers.get('x-company-id');

    if (!currentUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 });
    }

    // Find current user with company membership
    const { getUserForCompany } = await import('@/lib/userHelpers');
    const currentUserResult = await getUserForCompany(currentUserId, companyId);
    if (!currentUserResult || !currentUserResult.membership) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const currentUser = currentUserResult.user;
    const currentMembership = currentUserResult.membership;

    // Only companyOwner can transfer ownership
    if (currentMembership.role !== 'companyOwner') {
      return NextResponse.json({
        error: 'Forbidden: Only company owner can transfer ownership'
      }, { status: 403 });
    }

    const body = await request.json();
    const { newOwnerUserId } = transferOwnershipSchema.parse(body);

    if (newOwnerUserId === currentUserId) {
      return NextResponse.json({
        error: 'Cannot transfer ownership to yourself'
      }, { status: 400 });
    }

    // Find target user - must be in same company
    const newOwnerResult = await getUserForCompany(newOwnerUserId, companyId);
    if (!newOwnerResult || !newOwnerResult.membership) {
      return NextResponse.json({
        error: 'Target user not found in your company'
      }, { status: 404 });
    }
    const newOwner = newOwnerResult.user;
    const newOwnerMembership = newOwnerResult.membership;

    // Verify newOwner.whopUserId matches newOwnerUserId for consistency
    if (newOwner.whopUserId !== newOwnerUserId) {
      return NextResponse.json({
        error: 'User ID mismatch'
      }, { status: 400 });
    }

    // Check if new owner already has companyOwner role (edge case)
    if (newOwnerMembership.role === 'companyOwner') {
      return NextResponse.json({
        error: 'Target user already has company owner role'
      }, { status: 400 });
    }

    // Start transaction after all validations
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Verify Company exists and validate current ownership
      const { Company } = await import('@/models/Company');
      const company = await Company.findOne({ companyId }).session(session);
      if (!company) {
        await session.abortTransaction();
        await session.endSession();
        return NextResponse.json({
          error: 'Company not found'
        }, { status: 404 });
      }

      // Verify that companyOwnerWhopUserId matches currentUserId (consistency check)
      if (company.companyOwnerWhopUserId !== currentUserId) {
        await session.abortTransaction();
        await session.endSession();
        return NextResponse.json({
          error: 'Company ownership mismatch. Please refresh and try again.'
        }, { status: 409 });
      }

      // Update Company document to set new owner (within transaction)
      await Company.updateOne(
        { companyId },
        { companyOwnerWhopUserId: newOwnerUserId }
      ).session(session);

      // Transfer ownership: 
      // 1. New owner becomes companyOwner
      // 2. Current owner becomes 'owner' (loses companyOwner role but keeps owner privileges)
      // Note: updateCompanyMembership uses User.updateOne which doesn't support sessions directly
      // We need to update manually within the transaction
      await User.updateOne(
        {
          whopUserId: newOwnerUserId,
          'companyMemberships.companyId': companyId,
        },
        { $set: { 'companyMemberships.$.role': 'companyOwner' } }
      ).session(session);

      await User.updateOne(
        {
          whopUserId: currentUserId,
          'companyMemberships.companyId': companyId,
        },
        { $set: { 'companyMemberships.$.role': 'owner' } }
      ).session(session);

      // Update activeMembership if this is the active company for either user
      const newOwnerUser = await User.findOne({ whopUserId: newOwnerUserId }).session(session);
      if (newOwnerUser && newOwnerUser.activeCompanyId === companyId) {
        const updatedMembership = newOwnerUser.companyMemberships.find(
          (m: CompanyMembership) => m.companyId === companyId
        );
        if (updatedMembership) {
          await User.updateOne(
            { whopUserId: newOwnerUserId },
            { $set: { activeMembership: { ...updatedMembership, role: 'companyOwner' } } }
          ).session(session);
        }
      }

      const currentUserDoc = await User.findOne({ whopUserId: currentUserId }).session(session);
      if (currentUserDoc && currentUserDoc.activeCompanyId === companyId) {
        const updatedMembership = currentUserDoc.companyMemberships.find(
          (m: CompanyMembership) => m.companyId === companyId
        );
        if (updatedMembership) {
          await User.updateOne(
            { whopUserId: currentUserId },
            { $set: { activeMembership: { ...updatedMembership, role: 'owner' } } }
          ).session(session);
        }
      }

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      // Invalidate cache after successful transaction
      const { invalidateUserCache } = await import('@/lib/cache/userCache');
      invalidateUserCache(currentUserId, companyId);
      invalidateUserCache(newOwnerUserId, companyId);

      // Refresh to get updated data (after transaction commit)
      const updatedCurrentResult = await getUserForCompany(currentUserId, companyId);
      const updatedNewOwnerResult = await getUserForCompany(newOwnerUserId, companyId);

      return NextResponse.json({
        success: true,
        message: 'Company ownership transferred successfully',
        newOwner: {
          whopUserId: newOwner.whopUserId,
          alias: updatedNewOwnerResult?.membership?.alias || newOwnerMembership.alias,
          role: updatedNewOwnerResult?.membership?.role || 'companyOwner',
        },
        previousOwner: {
          whopUserId: currentUser.whopUserId,
          alias: updatedCurrentResult?.membership?.alias || currentMembership.alias,
          role: updatedCurrentResult?.membership?.role || 'owner',
        }
      });
    } catch (transactionError) {
      // Rollback transaction on any error
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      await session.endSession();
      throw transactionError;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Invalid request data',
        details: error.errors
      }, { status: 400 });
    }
    console.error('Error transferring ownership:', error);
    return NextResponse.json(
      { error: 'Failed to transfer ownership' },
      { status: 500 }
    );
  }
}

