import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";
import { BureauRegistry } from "../target/types/bureau_registry";

const { Keypair, PublicKey, SystemProgram, TransactionInstruction } = anchor.web3;
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const CODE_WINDOW = new anchor.BN(4_500);

describe("bureau_registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.bureauRegistry as Program<BureauRegistry>;
  const authority = provider.wallet.publicKey;
  const wrongAuthority = Keypair.generate();
  const registrar = Keypair.generate();
  const operativeId = "OPERATIVE-07";
  const clearanceNonce = new anchor.BN("72623859790382856");
  const clearanceAta = Keypair.generate().publicKey;
  const currentOperativeId = "OPERATIVE-01";
  const staleOperativeId = "OPERATIVE-02";

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [verificationRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), Buffer.from(operativeId.toLowerCase())],
    program.programId
  );
  const [currentHoldings] = PublicKey.findProgramAddressSync(
    [Buffer.from("holdings"), Buffer.from(currentOperativeId)],
    program.programId
  );
  const [currentClearanceRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("deed"), Buffer.from(currentOperativeId)],
    program.programId
  );
  const [staleHoldings] = PublicKey.findProgramAddressSync(
    [Buffer.from("holdings"), Buffer.from(staleOperativeId)],
    program.programId
  );
  const [staleClearanceRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("deed"), Buffer.from(staleOperativeId)],
    program.programId
  );

  before(async () => {
    for (const recipient of [
      wrongAuthority.publicKey,
      registrar.publicKey,
      clearanceAta,
    ]) {
      const signature = await provider.connection.requestAirdrop(
        recipient,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature, "confirmed");
    }
  });

  it("initializes the singleton config", async () => {
    await program.methods
      .initialize(CODE_WINDOW)
      .accountsPartial({
        authority,
        config,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.config.fetch(config);
    expect(account.authority.equals(authority)).to.equal(true);
    expect(account.codeWindowSlots.eq(CODE_WINDOW)).to.equal(true);
  });

  it("initializes an operative verification record with the exact byte layout", async () => {
    await program.methods
      .initOperative(operativeId, clearanceNonce)
      .accountsPartial({
        authority,
        config,
        verificationRecord,
        clearanceAta,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const info = await provider.connection.getAccountInfo(verificationRecord, "confirmed");
    expect(info).not.to.equal(null);
    const raw = Buffer.from(info!.data);

    expect(raw.length).to.equal(81);
    expect(raw.subarray(8, 40).equals(authority.toBuffer())).to.equal(true);
    expect(raw.readUInt8(40)).to.equal(0);
    expect(raw.readBigUInt64LE(41)).to.equal(BigInt(clearanceNonce.toString()));
    expect(raw.subarray(49, 81).equals(clearanceAta.toBuffer())).to.equal(true);
  });

  it("rejects mark_verified from a non-authority signer", async () => {
    await expectAnchorError(
      program.methods
        .markVerified(operativeId)
        .accountsPartial({
          authority: wrongAuthority.publicKey,
          config,
          verificationRecord,
        })
        .signers([wrongAuthority])
        .rpc(),
      "Unauthorized"
    );

    expect(
      (await program.account.verificationRecord.fetch(verificationRecord)).status
    ).to.equal(0);

    await program.methods
      .markVerified(operativeId)
      .accountsPartial({ authority, config, verificationRecord })
      .rpc();
    expect(
      (await program.account.verificationRecord.fetch(verificationRecord)).status
    ).to.equal(1);
  });

  it("initializes operative holdings", async () => {
    for (const [operativeId, holdings] of [
      [currentOperativeId, currentHoldings],
      [staleOperativeId, staleHoldings],
    ] as const) {
      await program.methods
        .initOperativeHoldings(operativeId, registrar.publicKey)
        .accountsPartial({
          authority,
          config,
          holdings,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const raw = await provider.connection.getAccountInfo(currentHoldings, "confirmed");
    expect(raw!.data.length).to.equal(41);
    expect(Buffer.from(raw!.data).subarray(8, 40).equals(registrar.publicKey.toBuffer())).to.equal(
      true
    );
    expect(Buffer.from(raw!.data).readUInt8(40)).to.equal(0);
  });

  it("requires the registrar remaining account and exact memo", async () => {
    const memoHash = Buffer.alloc(32, 0x11);

    await expectAnchorError(
      mintCode(
        currentOperativeId,
        currentHoldings,
        currentClearanceRecord,
        memoHash,
        SystemProgram.programId,
        true
      ),
      "RegistrarMissing"
    );
    await expectAnchorError(
      mintCode(
        currentOperativeId,
        currentHoldings,
        currentClearanceRecord,
        memoHash,
        registrar.publicKey,
        false
      ),
      "MemoMissing"
    );
  });

  it("mints, validates, and presents a current clearance code", async () => {
    const memoHash = Buffer.from(
      "7fd1efb4cde456f53a4d98b0cb8490ad89a62f466e10c64d6d269c7a493d53ee",
      "hex"
    );
    await mintCode(
      currentOperativeId,
      currentHoldings,
      currentClearanceRecord,
      memoHash,
      registrar.publicKey,
      true
    );

    let clearanceRecord = await program.account.clearanceRecord.fetch(currentClearanceRecord);
    const code = Buffer.from(clearanceRecord.clearanceCode).toString("ascii");
    expect(code).to.match(/^[1-9A-HJ-NP-Za-km-z]{8}$/);
    expect(clearanceRecord.operative).to.equal(currentOperativeId);
    expect(clearanceRecord.presented).to.equal(false);

    await expectAnchorError(
      program.methods
        .presentCode(currentOperativeId, "wrong123")
        .accountsPartial({
          authority,
          config,
          clearanceRecord: currentClearanceRecord,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc(),
      "CodeMismatch"
    );

    await program.methods
      .presentCode(currentOperativeId, code)
      .accountsPartial({
        authority,
        config,
        clearanceRecord: currentClearanceRecord,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
    clearanceRecord = await program.account.clearanceRecord.fetch(currentClearanceRecord);
    expect(clearanceRecord.presented).to.equal(true);

    await expectAnchorError(
      mintCode(
        currentOperativeId,
        currentHoldings,
        currentClearanceRecord,
        memoHash,
        registrar.publicKey,
        true
      ),
      "CodeAlreadyPresented"
    );
  });

  it("rejects a clearance code outside an authority-adjusted zero-slot window", async () => {
    await program.methods
      .setCodeWindow(new anchor.BN(0))
      .accountsPartial({ authority, config })
      .rpc();

    try {
      const memoHash = Buffer.alloc(32, 0x42);
      await mintCode(
        staleOperativeId,
        staleHoldings,
        staleClearanceRecord,
        memoHash,
        registrar.publicKey,
        true
      );
      const clearanceRecord = await program.account.clearanceRecord.fetch(
        staleClearanceRecord
      );
      const issuedSlot = clearanceRecord.issuedSlot.toNumber();
      await waitForLaterSlot(issuedSlot);
      const code = Buffer.from(clearanceRecord.clearanceCode).toString("ascii");

      await expectAnchorError(
        program.methods
          .presentCode(staleOperativeId, code)
          .accountsPartial({
            authority,
            config,
            clearanceRecord: staleClearanceRecord,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "CodeStale"
      );
    } finally {
      await program.methods
        .setCodeWindow(CODE_WINDOW)
        .accountsPartial({ authority, config })
        .rpc();
    }
  });

  function mintCode(
    operativeId: string,
    holdings: PublicKey,
    clearanceRecord: PublicKey,
    memoHash: Buffer,
    registrarAccount: PublicKey,
    includeMemo: boolean
  ): Promise<string> {
    const builder = program.methods
      .mintCode(operativeId, [...memoHash])
      .accountsPartial({
        payer: authority,
        holdings,
        clearanceRecord,
        instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: registrarAccount, isWritable: false, isSigner: false },
      ]);

    if (includeMemo) {
      builder.preInstructions([
        new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [],
          data: Buffer.from(memoHash.toString("hex"), "ascii"),
        }),
      ]);
    }
    return builder.rpc();
  }

  async function waitForLaterSlot(issuedSlot: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while ((await provider.connection.getSlot("confirmed")) <= issuedSlot) {
      if (Date.now() >= deadline) {
        throw new Error(`validator did not advance beyond slot ${issuedSlot}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});

async function expectAnchorError(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
    expect.fail(`expected Anchor error ${expected}`);
  } catch (caught) {
    const error = caught as {
      error?: { errorCode?: { code?: string } };
      errorCode?: { code?: string };
    };
    const code = error.error?.errorCode?.code ?? error.errorCode?.code;
    if (code !== undefined) {
      expect(code).to.equal(expected);
    } else {
      expect(String(caught)).to.contain(expected);
    }
  }
}
