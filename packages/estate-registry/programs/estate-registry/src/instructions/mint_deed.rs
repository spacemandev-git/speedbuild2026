use anchor_lang::prelude::*;
use solana_instructions_sysvar::{self as instructions, load_instruction_at_checked};
use solana_sha256_hasher::hashv;

use crate::{
    constants::{DEED_SEED, MAX_NAME_LEN, MEMO_PROGRAM_ID, TEAM_SEED},
    error::ErrorCode,
    state::{Deed, TeamHoldings},
};

#[derive(Accounts)]
#[instruction(team_name: String)]
pub struct MintDeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [TEAM_SEED, team_name.as_bytes()],
        bump
    )]
    pub holdings: Account<'info, TeamHoldings>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Deed::INIT_SPACE,
        seeds = [DEED_SEED, team_name.as_bytes()],
        bump
    )]
    pub deed: Account<'info, Deed>,
    /// CHECK: Address-constrained to the Instructions sysvar.
    #[account(address = instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_mint_deed(
    ctx: Context<MintDeed>,
    team_name: String,
    memo_hash: [u8; 32],
) -> Result<()> {
    if team_name.len() > MAX_NAME_LEN {
        return Err(ProgramError::InvalidArgument.into());
    }

    let registrar = ctx
        .remaining_accounts
        .first()
        .ok_or_else(|| error!(ErrorCode::RegistrarMissing))?;
    require_keys_eq!(
        registrar.key(),
        ctx.accounts.holdings.registrar_key,
        ErrorCode::RegistrarMissing
    );
    require!(
        memo_is_present(&ctx.accounts.instructions_sysvar, &memo_hash)?,
        ErrorCode::MemoMissing
    );
    require!(
        !ctx.accounts.deed.presented,
        ErrorCode::DeedAlreadyPresented
    );

    let issued_slot = Clock::get()?.slot;
    let slot_bytes = issued_slot.to_le_bytes();
    let digest = hashv(&[team_name.as_bytes(), &memo_hash, &slot_bytes]);
    let encoded = bs58::encode(digest.to_bytes()).into_string();
    let deed_code: [u8; 8] = encoded.as_bytes()[..8]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let deed = &mut ctx.accounts.deed;
    deed.team = team_name;
    deed.deed_code = deed_code;
    deed.issued_slot = issued_slot;
    deed.presented = false;
    ctx.accounts.holdings.deeds_minted = ctx
        .accounts
        .holdings
        .deeds_minted
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(())
}

fn memo_is_present(instructions_account: &AccountInfo<'_>, memo_hash: &[u8; 32]) -> Result<bool> {
    let expected = lowercase_hex(memo_hash);
    let mut index = 0usize;
    while let Ok(instruction) = load_instruction_at_checked(index, instructions_account) {
        if instruction.program_id == MEMO_PROGRAM_ID && instruction.data == expected {
            return Ok(true);
        }
        index += 1;
    }
    Ok(false)
}

fn lowercase_hex(bytes: &[u8; 32]) -> [u8; 64] {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = [0u8; 64];
    for (index, byte) in bytes.iter().enumerate() {
        output[index * 2] = HEX[(byte >> 4) as usize];
        output[index * 2 + 1] = HEX[(byte & 0x0f) as usize];
    }
    output
}
