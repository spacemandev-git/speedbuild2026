use anchor_lang::prelude::*;

use crate::{
    constants::{CLAIM_SEED, CONFIG_SEED, MAX_NAME_LEN},
    error::ErrorCode,
    state::{ClaimRecord, Config},
};

#[derive(Accounts)]
#[instruction(claim_number: String)]
pub struct InitClaim<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [CLAIM_SEED, claim_number.to_lowercase().as_bytes()],
        bump
    )]
    pub claim: Account<'info, ClaimRecord>,
    /// CHECK: The registry stores this address; the watcher interprets it as an ATA.
    pub tribute_ata: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_claim(
    ctx: Context<InitClaim>,
    claim_number: String,
    probate_nonce: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require_max_len(&claim_number)?;

    let claim = &mut ctx.accounts.claim;
    claim.executor = ctx.accounts.authority.key();
    claim.status = 0;
    claim.probate_nonce = probate_nonce;
    claim.tribute_ata = ctx.accounts.tribute_ata.key();
    Ok(())
}

fn require_max_len(value: &str) -> Result<()> {
    if value.len() > MAX_NAME_LEN {
        return Err(ProgramError::InvalidArgument.into());
    }
    Ok(())
}
