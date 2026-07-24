pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;

declare_id!("B15pHuKQP2ay9Zx85JjpM1rSxy5e4Zd2J3MjLVkfsvSB");

#[program]
pub mod estate_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, deed_window_slots: u64) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, deed_window_slots)
    }

    pub fn init_claim(
        ctx: Context<InitClaim>,
        claim_number: String,
        probate_nonce: u64,
    ) -> Result<()> {
        instructions::init_claim::handle_init_claim(ctx, claim_number, probate_nonce)
    }

    pub fn mark_proven(ctx: Context<MarkProven>, claim_number: String) -> Result<()> {
        instructions::mark_proven::handle_mark_proven(ctx, claim_number)
    }

    pub fn init_claim_holdings(
        ctx: Context<InitClaimHoldings>,
        claim_number: String,
        registrar_key: Pubkey,
    ) -> Result<()> {
        instructions::init_claim_holdings::handle_init_claim_holdings(
            ctx,
            claim_number,
            registrar_key,
        )
    }

    pub fn mint_deed(
        ctx: Context<MintDeed>,
        claim_number: String,
        memo_hash: [u8; 32],
    ) -> Result<()> {
        instructions::mint_deed::handle_mint_deed(ctx, claim_number, memo_hash)
    }

    pub fn present_deed(
        ctx: Context<PresentDeed>,
        claim_number: String,
        code: String,
    ) -> Result<()> {
        instructions::present_deed::handle_present_deed(ctx, claim_number, code)
    }

    pub fn set_deed_window(ctx: Context<SetDeedWindow>, new_window: u64) -> Result<()> {
        instructions::set_deed_window::handle_set_deed_window(ctx, new_window)
    }
}
