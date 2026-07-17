use anchor_lang::prelude::*;

use crate::{
    constants::{CLAIM_SEED, CONFIG_SEED},
    error::ErrorCode,
    state::{ClaimRecord, Config},
};

#[derive(Accounts)]
#[instruction(claim_number: String)]
pub struct MarkProven<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, claim_number.to_lowercase().as_bytes()],
        bump
    )]
    pub claim: Account<'info, ClaimRecord>,
}

pub fn handle_mark_proven(ctx: Context<MarkProven>, _claim_number: String) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    ctx.accounts.claim.status = 1;
    Ok(())
}
