/**
 * Convert trade parameters to Alpaca option symbol format
 * Format: {TICKER}{YYMMDD}{C|P}{STRIKE*1000} (8 digits, zero-padded)
 * Example: SPY, 680 strike, 2025-12-19 expiry, CALL → SPY251219C00680000
 */
export function convertToAlpacaSymbol(
  ticker: string,
  strike: number,
  expiryDate: Date,
  optionType: 'C' | 'P'
): string {
  // Get YYMMDD format
  const year = expiryDate.getFullYear().toString().slice(-2);
  const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
  const day = String(expiryDate.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  // Convert strike to integer (multiply by 1000, round to avoid floating point issues)
  const strikeInt = Math.round(strike * 1000);
  const strikeStr = String(strikeInt).padStart(8, '0');

  // Option type: C for CALL, P for PUT
  const type = optionType === 'C' ? 'C' : 'P';

  // Combine: TICKER + YYMMDD + C/P + STRIKE (8 digits)
  return `${ticker.toUpperCase()}${dateStr}${type}${strikeStr}`;
}
