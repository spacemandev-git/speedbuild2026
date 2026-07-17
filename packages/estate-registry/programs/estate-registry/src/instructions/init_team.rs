use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, MAX_NAME_LEN, TEAM_SEED},
    error::ErrorCode,
    state::{Config, TeamHoldings},
};

#[derive(Accounts)]
#[instruction(team_name: String)]
pub struct InitTeam<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + TeamHoldings::INIT_SPACE,
        seeds = [TEAM_SEED, team_name.as_bytes()],
        bump
    )]
    pub holdings: Account<'info, TeamHoldings>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_team(
    ctx: Context<InitTeam>,
    team_name: String,
    registrar_key: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    if team_name.len() > MAX_NAME_LEN {
        return Err(ProgramError::InvalidArgument.into());
    }

    ctx.accounts.holdings.registrar_key = registrar_key;
    ctx.accounts.holdings.deeds_minted = 0;
    Ok(())
}
