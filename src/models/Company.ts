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
  primaryColor?: string; // Primary brand color (hex) - for leaderboard/follow pages
  secondaryColor?: string; // Secondary brand color (hex) - for leaderboard/follow pages
  // App theme customization (companyOwner only)
  appTitle?: string; // Customizable app title (default: "EdgeIQ Trades")
  themePrimaryColor?: string; // Primary theme color (hex, e.g., "#22c55e")
  themeGradientDirection?: number; // Gradient direction in degrees (0-360, default: 135)
  themeColorIntensity?: number; // Color intensity percentage (0-100, default: 60)
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
  // White-label customization (companyOwner only)
  primaryColor: { type: String, trim: true }, // Hex color code - for leaderboard/follow pages
  secondaryColor: { type: String, trim: true }, // Hex color code - for leaderboard/follow pages
  // App theme customization (companyOwner only)
  appTitle: { type: String, trim: true, maxlength: 100 },
  themePrimaryColor: { 
    type: String, 
    trim: true,
    validate: {
      validator: function(v: string) {
        return !v || /^#[0-9A-Fa-f]{6}$/i.test(v);
      },
      message: 'themePrimaryColor must be a valid hex color code (e.g., #22c55e)'
    }
  },
  themeGradientDirection: { 
    type: Number, 
    min: 0, 
    max: 360,
    default: 135
  },
  themeColorIntensity: { 
    type: Number, 
    min: 0, 
    max: 100,
    default: 60
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
CompanySchema.index({ companyOwnerWhopUserId: 1 });

export const Company = (mongoose.models && mongoose.models.Company) ||
  mongoose.model<ICompany>('Company', CompanySchema);

