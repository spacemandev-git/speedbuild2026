use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: field order is part of the public challenge protocol.
pub struct Config {
    pub authority: Pubkey,
    pub deed_window_slots: u64,
}

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: executor=8..40, status=40, nonce=41..49, ATA=49..81.
pub struct ClaimRecord {
    pub executor: Pubkey,
    pub status: u8,
    pub probate_nonce: u64,
    pub tribute_ata: Pubkey,
}

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: registrar_key=8..40 and deeds_minted=40.
pub struct TeamHoldings {
    pub registrar_key: Pubkey,
    pub deeds_minted: u8,
}

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: keep team first and preserve all field ordering.
pub struct Deed {
    #[max_len(16)]
    pub team: String,
    pub deed_code: [u8; 8],
    pub issued_slot: u64,
    pub presented: bool,
}
