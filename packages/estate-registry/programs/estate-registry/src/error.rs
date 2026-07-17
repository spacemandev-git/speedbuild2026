use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The required team registrar account is missing")]
    RegistrarMissing,
    #[msg("The required memo instruction is missing")]
    MemoMissing,
    #[msg("This deed has already been presented")]
    DeedAlreadyPresented,
    #[msg("The supplied deed code does not match")]
    CodeMismatch,
    #[msg("This deed is stale")]
    DeedStale,
    #[msg("The signer is not the estate authority")]
    Unauthorized,
}
