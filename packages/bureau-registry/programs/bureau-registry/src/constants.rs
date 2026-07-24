use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const OPERATIVE_SEED: &[u8] = b"claim";

#[constant]
pub const HOLDINGS_SEED: &[u8] = b"holdings";

#[constant]
pub const CLEARANCE_SEED: &[u8] = b"deed";

pub const MAX_OPERATIVE_ID_LEN: usize = 16;

pub const MEMO_PROGRAM_ID: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
