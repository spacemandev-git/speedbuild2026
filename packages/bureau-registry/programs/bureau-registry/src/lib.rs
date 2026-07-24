pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("B15pHuKQP2ay9Zx85JjpM1rSxy5e4Zd2J3MjLVkfsvSB");

#[program]
pub mod bureau_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, code_window_slots: u64) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, code_window_slots)
    }

    pub fn init_operative(
        ctx: Context<InitOperative>,
        operative_id: String,
        clearance_nonce: u64,
    ) -> Result<()> {
        instructions::init_operative::handle_init_operative(ctx, operative_id, clearance_nonce)
    }

    pub fn mark_verified(ctx: Context<MarkVerified>, operative_id: String) -> Result<()> {
        instructions::mark_verified::handle_mark_verified(ctx, operative_id)
    }

    pub fn init_operative_holdings(
        ctx: Context<InitOperativeHoldings>,
        operative_id: String,
        registrar_key: Pubkey,
    ) -> Result<()> {
        instructions::init_operative_holdings::handle_init_operative_holdings(
            ctx,
            operative_id,
            registrar_key,
        )
    }

    pub fn mint_code(
        ctx: Context<MintCode>,
        operative_id: String,
        memo_hash: [u8; 32],
    ) -> Result<()> {
        instructions::mint_code::handle_mint_code(ctx, operative_id, memo_hash)
    }

    pub fn present_code(
        ctx: Context<PresentCode>,
        operative_id: String,
        code: String,
    ) -> Result<()> {
        instructions::present_code::handle_present_code(ctx, operative_id, code)
    }

    pub fn set_code_window(ctx: Context<SetCodeWindow>, new_window: u64) -> Result<()> {
        instructions::set_code_window::handle_set_code_window(ctx, new_window)
    }
}
