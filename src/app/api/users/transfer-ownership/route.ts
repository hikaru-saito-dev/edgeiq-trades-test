import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { z } from 'zod';

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
    const { getUserForCompany, updateCompanyMembership } = await import('@/lib/userHelpers');
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

    // Update Company document to set new owner
    const { Company } = await import('@/models/Company');
    await Company.updateOne(
      { companyId },
      { companyOwnerWhopUserId: newOwnerUserId }
    );

    // Transfer ownership: 
    // 1. New owner becomes companyOwner
    // 2. Current owner becomes 'owner' (loses companyOwner role but keeps owner privileges)
    await Promise.all([
      updateCompanyMembership(newOwnerUserId, companyId, { role: 'companyOwner' }),
      updateCompanyMembership(currentUserId, companyId, { role: 'owner' }),
    ]);

    // Refresh to get updated data
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

