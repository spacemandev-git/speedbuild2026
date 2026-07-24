use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";

#[constant]
pub const HOLDINGS_SEED: &[u8] = b"holdings";

#[constant]
pub const DEED_SEED: &[u8] = b"deed";

pub const MAX_NAME_LEN: usize = 16;

pub const MEMO_PROGRAM_ID: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
