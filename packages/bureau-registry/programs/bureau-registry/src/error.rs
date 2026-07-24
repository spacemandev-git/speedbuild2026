use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The required registrar account is missing")]
    RegistrarMissing,
    #[msg("The required memo instruction is missing")]
    MemoMissing,
    #[msg("This clearance code has already been presented")]
    CodeAlreadyPresented,
    #[msg("The supplied clearance code does not match")]
    CodeMismatch,
    #[msg("This clearance code is stale")]
    CodeStale,
    #[msg("The signer is not the Bureau authority")]
    Unauthorized,
}
