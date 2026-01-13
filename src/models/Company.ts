import mongoose, { Schema, Document } from 'mongoose';
import { MembershipPlan } from './User';

export interface ICompany extends Document {
  companyId: string; // Primary key, unique
  companyName?: string;
  companyDescription?: string;
  membershipPlans?: MembershipPlan[]; // Array of membership plans for this company
  optIn?: boolean; // Leaderboard opt-in (default true - company appears on leaderboard)
  hideLeaderboardFromMembers?: boolean; // Company owner setting to hide leaderboard from members
  hideCompanyStatsFromMembers?: boolean; // Company owner setting to hide company stats toggle from members and admins
  companyOwnerWhopUserId: string; // Reference to owner (person-level)
  // White-label customization (companyOwner only)
  brandColor?: string; // Single brand color (hex) - used for overall app theming (all colors calculated from this)
  logoUrl?: string; // Company logo URL
  // Colors for specific UI elements (separate from brandColor)
  primaryColor?: string; // Primary color for alias text and progress bars (hex)
  secondaryColor?: string; // Secondary color for progress bar gradients (hex)
  createdAt: Date;
  updatedAt: Date;
}

const MembershipPlanSchema = new Schema<MembershipPlan>({
  id: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String },
  price: { type: String, required: true },
  url: { type: String, required: true },
  isPremium: { type: Boolean, default: false },
}, { _id: false });

const CompanySchema = new Schema<ICompany>({
  companyId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  companyName: { type: String, trim: true },
  companyDescription: { type: String, trim: true },
  membershipPlans: { type: [MembershipPlanSchema], default: [] },
  optIn: { type: Boolean, default: true }, // Default true - company appears on leaderboard
  hideLeaderboardFromMembers: { type: Boolean, default: false },
  hideCompanyStatsFromMembers: { type: Boolean, default: false },
  companyOwnerWhopUserId: { type: String, required: true },
  brandColor: { type: String, trim: true }, // Single brand color (hex) - used for overall app theming (all colors calculated from this)
  logoUrl: { type: String, trim: true }, // Company logo URL
  primaryColor: { type: String, trim: true }, // Primary color for alias text and progress bars (hex)
  secondaryColor: { type: String, trim: true }, // Secondary color for progress bar gradients (hex)
}, {
  timestamps: true,
});

// Indexes for efficient queries
CompanySchema.index({ companyOwnerWhopUserId: 1 });

export const Company = (mongoose.models && mongoose.models.Company) ||
  mongoose.model<ICompany>('Company', CompanySchema);

