use anchor_lang::prelude::*;

use crate::{constants::CONFIG_SEED, error::ErrorCode, state::Config};

#[derive(Accounts)]
pub struct SetDeedWindow<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
}

pub fn handle_set_deed_window(ctx: Context<SetDeedWindow>, new_window: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    ctx.accounts.config.deed_window_slots = new_window;
    Ok(())
}
