use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, DEED_SEED},
    error::ErrorCode,
    state::{Config, Deed},
};

#[derive(Accounts)]
#[instruction(claim_number: String)]
pub struct PresentDeed<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [DEED_SEED, claim_number.as_bytes()],
        bump
    )]
    pub deed: Account<'info, Deed>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handle_present_deed(
    ctx: Context<PresentDeed>,
    _claim_number: String,
    code: String,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require!(
        code.as_bytes() == ctx.accounts.deed.deed_code,
        ErrorCode::CodeMismatch
    );

    let age = ctx
        .accounts
        .clock
        .slot
        .saturating_sub(ctx.accounts.deed.issued_slot);
    require!(
        age <= ctx.accounts.config.deed_window_slots,
        ErrorCode::DeedStale
    );
    require!(
        !ctx.accounts.deed.presented,
        ErrorCode::DeedAlreadyPresented
    );

    ctx.accounts.deed.presented = true;
    Ok(())
}
