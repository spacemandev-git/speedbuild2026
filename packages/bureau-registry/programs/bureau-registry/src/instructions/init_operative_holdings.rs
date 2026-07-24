use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, HOLDINGS_SEED, MAX_OPERATIVE_ID_LEN},
    error::ErrorCode,
    state::{Config, OperativeHoldings},
};

#[derive(Accounts)]
#[instruction(operative_id: String)]
pub struct InitOperativeHoldings<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + OperativeHoldings::INIT_SPACE,
        seeds = [HOLDINGS_SEED, operative_id.as_bytes()],
        bump
    )]
    pub holdings: Account<'info, OperativeHoldings>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_operative_holdings(
    ctx: Context<InitOperativeHoldings>,
    operative_id: String,
    registrar_key: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    if operative_id.len() > MAX_OPERATIVE_ID_LEN {
        return Err(ProgramError::InvalidArgument.into());
    }

    ctx.accounts.holdings.registrar_key = registrar_key;
    ctx.accounts.holdings.codes_minted = 0;
    Ok(())
}
