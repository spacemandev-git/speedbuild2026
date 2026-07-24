use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, OPERATIVE_SEED},
    error::ErrorCode,
    state::{Config, VerificationRecord},
};

#[derive(Accounts)]
#[instruction(operative_id: String)]
pub struct MarkVerified<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [OPERATIVE_SEED, operative_id.to_lowercase().as_bytes()],
        bump
    )]
    pub verification_record: Account<'info, VerificationRecord>,
}

pub fn handle_mark_verified(ctx: Context<MarkVerified>, _operative_id: String) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    ctx.accounts.verification_record.status = 1;
    Ok(())
}
