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
  primaryColor?: string; // Primary brand color (hex format, e.g., "#00FF00")
  secondaryColor?: string; // Secondary brand color (hex format)
  accentColor?: string; // Accent color for highlights (hex format)
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
  primaryColor: { type: String, trim: true, match: /^#[0-9A-Fa-f]{6}$/ }, // Hex color validation
  secondaryColor: { type: String, trim: true, match: /^#[0-9A-Fa-f]{6}$/ },
  accentColor: { type: String, trim: true, match: /^#[0-9A-Fa-f]{6}$/ },
}, {
  timestamps: true,
});

// Indexes for efficient queries
CompanySchema.index({ companyOwnerWhopUserId: 1 });

export const Company = (mongoose.models && mongoose.models.Company) ||
  mongoose.model<ICompany>('Company', CompanySchema);

