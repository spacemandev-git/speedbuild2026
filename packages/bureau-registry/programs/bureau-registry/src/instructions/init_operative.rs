use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, MAX_OPERATIVE_ID_LEN, OPERATIVE_SEED},
    error::ErrorCode,
    state::{Config, VerificationRecord},
};

#[derive(Accounts)]
#[instruction(operative_id: String)]
pub struct InitOperative<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + VerificationRecord::INIT_SPACE,
        seeds = [OPERATIVE_SEED, operative_id.to_lowercase().as_bytes()],
        bump
    )]
    pub verification_record: Account<'info, VerificationRecord>,
    /// CHECK: The registry stores this address; the watcher interprets it as an ATA.
    pub clearance_ata: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_operative(
    ctx: Context<InitOperative>,
    operative_id: String,
    clearance_nonce: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require_max_len(&operative_id)?;

    let verification_record = &mut ctx.accounts.verification_record;
    verification_record.verifier = ctx.accounts.authority.key();
    verification_record.status = 0;
    verification_record.clearance_nonce = clearance_nonce;
    verification_record.clearance_ata = ctx.accounts.clearance_ata.key();
    Ok(())
}

fn require_max_len(value: &str) -> Result<()> {
    if value.len() > MAX_OPERATIVE_ID_LEN {
        return Err(ProgramError::InvalidArgument.into());
    }
    Ok(())
}
