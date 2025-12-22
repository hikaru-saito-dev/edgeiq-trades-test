# High-Level: AutoIQ (Paid Auto-Execution Layer)

Context

- We now have live broker API connections and can execute options trades.
- Goal of this next phase:
  - Keep trade import + stats free.
  - Paywall automated execution + follow logic under a new “AutoIQ” tab.
  - Lay groundwork for future risk controls and white-labeled versions for creators.

## 1) Access + Paywall Logic

- New tab in app: `AutoIQ`
- Access rules:
  - Any user with a connected broker can still:
    - Import trades
    - View stats / leaderboards
  - Only users with an active “AutoIQ” subscription can:
    - Access AutoIQ settings
    - Enable auto-execution in any form
- Implementation:
  - Add a simple `has_auto_iq` flag (from Whop subscription check).
  - Before any auto-execution is triggered, check:
    - `has_auto_iq == true`
    - Broker connection is valid
    - Trade type = supported (single-leg calls/puts)
    - Market hours logic reused from current trade creation

## 2) AutoIQ Tab – Initial Settings (MVP)

AutoIQ tab is purely configuration; no new trade creation UI here.
Core toggles:

- Global Mode
  - `Auto-Trade Follows` (radio option 1)
    - When ON:
      - Any trade created by a followed creator (via existing “Follow” logic) is:
        - Mirrored to the follower’s connected broker via API.
        - Uses follower’s own risk settings (once we add them).
      - Respect existing constraints:
        - Only single-leg options
        - Only during supported market hours
        - Only for creators the user has an active follow relationship with.
  - `Notify Only` (radio option 2)
    - Auto-trading disabled.
    - Follower continues to:
      - Receive follow trades in their “Following” tab.
      - Receive webhook notifications (Discord / Whop) as usual.
    - They must manually execute via the "Follow" Button and "Fade" button will have no action like right now

MVP Scope:

- For now, AutoIQ = single global setting per user:
  - Either Auto-Trade Follows OR Notify Only.
- No UI for risk parameters yet – just leave space in design for “Risk Settings (coming soon)” section.

## 3) Future Risk Settings (Design for later, don’t build now)

We’ll add a “Risk Settings” section inside AutoIQ once MVP is stable.

Very brief definitions so you can design around them:

- Trade Size
  - What it is:
    - How big each mirrored trade should be for the follower.
  - Implementation idea:
    - Option A: Fixed number of contracts per trade (e.g., “Always trade 1 contract”).
    - Option B (later): Percentage of creator size (e.g., “50% of their size”).
  - UI (later):
    - Field: `Default Contracts` (integer).

- Take Profit (TP)
  - What it is:
    - A target profit level where we auto-close the position.
    - E.g., “Close when option price is +50% from entry.”
  - Implementation idea:
    - Percent gain relative to user’s own fill price.
    - If they hold multiple contracts, they may set staggered TPs later (e.g., 50% at +30%, rest at +70%).
  - UI (later):
    - Field: `Take Profit %` (single value first, advanced ladder later).

- Stop Loss (SL)
  - What it is:
    - Maximum allowed loss before we auto-close.
    - E.g., “Close if option price is -30% from entry.”
  - Implementation idea:
    - Percent loss relative to fill price.
  - UI (later):
    - Field: `Stop Loss %`.

- Trailing Stop Loss (TSL)
  - What it is:
    - A dynamic stop that trails the best price reached.
    - E.g., “If option runs +80% then pulls back 20% from max, close.”
  - Implementation idea:
    - Track highest price since entry.
    - Close if drawdown from max ≥ configured %.
  - UI (later):
    - Field: `Trailing Stop %`.

All of these will run on follower-side logic:

- Creator opens trade -> follower’s AutoIQ decides position size + exit rules based on their own settings, not the creator’s.

## 4) White-Label + Affiliate Layer (later but keep in mind)

Once AutoIQ is stable, plan is to let creators white-label this:

- Each creator can:
  - Use EdgeIQ Trades as “their” app for their community.
  - Sell higher-tier memberships that include AutoIQ access.
  - Users receive all plays from the company they have a membership for by default - no pay to follow if they have a membership for their group already
- Affiliate logic:
  - Anyone entering from a creator’s link: `https://theedgeiq.com/?a=<companyOwnerUsername>`
  - When that user upgrades to AutoIQ, affiliate is paid to them and the user will have full access to autoIQ
- For now, just keep URLs + tracking in mind when designing settings and account models.

# Summary for you

- Add new `AutoIQ` tab.
- Gate everything inside AutoIQ behind an AutoIQ subscription flag.
- Implement two modes for follows:
  - Auto-Trade Follows (mirror trades via broker API)
  - Notify Only (no auto-execution)
- Leave design hooks / placeholders for:
  - Trade Size, TP%, SL%, TSL% risk settings
- Keep URL param `?a=username` in mind for future affiliate/white-label logic.
