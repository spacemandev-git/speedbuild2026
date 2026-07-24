use anchor_lang::prelude::*;

use crate::{
    constants::{CLEARANCE_SEED, CONFIG_SEED},
    error::ErrorCode,
    state::{ClearanceRecord, Config},
};

#[derive(Accounts)]
#[instruction(operative_id: String)]
pub struct PresentCode<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CLEARANCE_SEED, operative_id.as_bytes()],
        bump
    )]
    pub clearance_record: Account<'info, ClearanceRecord>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handle_present_code(
    ctx: Context<PresentCode>,
    _operative_id: String,
    code: String,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require!(
        code.as_bytes() == ctx.accounts.clearance_record.clearance_code,
        ErrorCode::CodeMismatch
    );

    let age = ctx
        .accounts
        .clock
        .slot
        .saturating_sub(ctx.accounts.clearance_record.issued_slot);
    require!(
        age <= ctx.accounts.config.code_window_slots,
        ErrorCode::CodeStale
    );
    require!(
        !ctx.accounts.clearance_record.presented,
        ErrorCode::CodeAlreadyPresented
    );

    ctx.accounts.clearance_record.presented = true;
    Ok(())
}
