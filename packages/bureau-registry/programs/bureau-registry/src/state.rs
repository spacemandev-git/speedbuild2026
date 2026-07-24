use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: field order is part of the public challenge protocol.
pub struct Config {
    pub authority: Pubkey,
    pub code_window_slots: u64,
}

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: verifier=8..40, status=40, clearance_nonce=41..49, clearance_ata=49..81.
pub struct VerificationRecord {
    pub verifier: Pubkey,
    pub status: u8,
    pub clearance_nonce: u64,
    pub clearance_ata: Pubkey,
}

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: registrar_key=8..40 and codes_minted=40.
pub struct OperativeHoldings {
    pub registrar_key: Pubkey,
    pub codes_minted: u8,
}

#[account]
#[derive(InitSpace)]
// LAYOUT-CRITICAL: keep operative first and preserve all field ordering.
pub struct ClearanceRecord {
    #[max_len(16)]
    pub operative: String,
    pub clearance_code: [u8; 8],
    pub issued_slot: u64,
    pub presented: bool,
}
