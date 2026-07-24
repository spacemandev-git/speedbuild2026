use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, HOLDINGS_SEED, MAX_NAME_LEN},
    error::ErrorCode,
    state::{ClaimHoldings, Config},
};

#[derive(Accounts)]
#[instruction(claim_number: String)]
pub struct InitClaimHoldings<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + ClaimHoldings::INIT_SPACE,
        seeds = [HOLDINGS_SEED, claim_number.as_bytes()],
        bump
    )]
    pub holdings: Account<'info, ClaimHoldings>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_claim_holdings(
    ctx: Context<InitClaimHoldings>,
    claim_number: String,
    registrar_key: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    if claim_number.len() > MAX_NAME_LEN {
        return Err(ProgramError::InvalidArgument.into());
    }

    ctx.accounts.holdings.registrar_key = registrar_key;
    ctx.accounts.holdings.deeds_minted = 0;
    Ok(())
}
