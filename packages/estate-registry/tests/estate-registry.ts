import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";
import { EstateRegistry } from "../target/types/estate_registry";

const { Keypair, PublicKey, SystemProgram, TransactionInstruction } = anchor.web3;
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const DEED_WINDOW = new anchor.BN(4_500);

describe("estate_registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.estateRegistry as Program<EstateRegistry>;
  const authority = provider.wallet.publicKey;
  const wrongAuthority = Keypair.generate();
  const registrar = Keypair.generate();
  const claimNumber = "CLAIMANT-07";
  const probateNonce = new anchor.BN("72623859790382856");
  const tributeAta = Keypair.generate().publicKey;
  const happyTeam = "red-team";
  const staleTeam = "blue-team";

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [claim] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), Buffer.from(claimNumber.toLowerCase())],
    program.programId
  );
  const [happyHoldings] = PublicKey.findProgramAddressSync(
    [Buffer.from("team"), Buffer.from(happyTeam)],
    program.programId
  );
  const [happyDeed] = PublicKey.findProgramAddressSync(
    [Buffer.from("deed"), Buffer.from(happyTeam)],
    program.programId
  );
  const [staleHoldings] = PublicKey.findProgramAddressSync(
    [Buffer.from("team"), Buffer.from(staleTeam)],
    program.programId
  );
  const [staleDeed] = PublicKey.findProgramAddressSync(
    [Buffer.from("deed"), Buffer.from(staleTeam)],
    program.programId
  );

  before(async () => {
    for (const recipient of [
      wrongAuthority.publicKey,
      registrar.publicKey,
      tributeAta,
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
      .initialize(DEED_WINDOW)
      .accountsPartial({
        authority,
        config,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.config.fetch(config);
    expect(account.authority.equals(authority)).to.equal(true);
    expect(account.deedWindowSlots.eq(DEED_WINDOW)).to.equal(true);
  });

  it("initializes a claim with the exact challenge byte layout", async () => {
    await program.methods
      .initClaim(claimNumber, probateNonce)
      .accountsPartial({
        authority,
        config,
        claim,
        tributeAta,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const info = await provider.connection.getAccountInfo(claim, "confirmed");
    expect(info).not.to.equal(null);
    const raw = Buffer.from(info!.data);

    expect(raw.length).to.equal(81);
    expect(raw.subarray(8, 40).equals(authority.toBuffer())).to.equal(true);
    expect(raw.readUInt8(40)).to.equal(0);
    expect(raw.readBigUInt64LE(41)).to.equal(BigInt(probateNonce.toString()));
    expect(raw.subarray(49, 81).equals(tributeAta.toBuffer())).to.equal(true);
  });

  it("rejects mark_proven from a non-authority signer", async () => {
    await expectAnchorError(
      program.methods
        .markProven(claimNumber)
        .accountsPartial({
          authority: wrongAuthority.publicKey,
          config,
          claim,
        })
        .signers([wrongAuthority])
        .rpc(),
      "Unauthorized"
    );

    expect((await program.account.claimRecord.fetch(claim)).status).to.equal(0);

    await program.methods
      .markProven(claimNumber)
      .accountsPartial({ authority, config, claim })
      .rpc();
    expect((await program.account.claimRecord.fetch(claim)).status).to.equal(1);
  });

  it("initializes team holdings", async () => {
    for (const [teamName, holdings] of [
      [happyTeam, happyHoldings],
      [staleTeam, staleHoldings],
    ] as const) {
      await program.methods
        .initTeam(teamName, registrar.publicKey)
        .accountsPartial({
          authority,
          config,
          holdings,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const raw = await provider.connection.getAccountInfo(happyHoldings, "confirmed");
    expect(raw!.data.length).to.equal(41);
    expect(Buffer.from(raw!.data).subarray(8, 40).equals(registrar.publicKey.toBuffer())).to.equal(
      true
    );
    expect(Buffer.from(raw!.data).readUInt8(40)).to.equal(0);
  });

  it("requires the registrar remaining account and exact memo", async () => {
    const memoHash = Buffer.alloc(32, 0x11);

    await expectAnchorError(
      mintDeed(happyTeam, happyHoldings, happyDeed, memoHash, SystemProgram.programId, true),
      "RegistrarMissing"
    );
    await expectAnchorError(
      mintDeed(happyTeam, happyHoldings, happyDeed, memoHash, registrar.publicKey, false),
      "MemoMissing"
    );
  });

  it("mints, validates, and presents a fresh deed", async () => {
    const memoHash = Buffer.from(
      "7fd1efb4cde456f53a4d98b0cb8490ad89a62f466e10c64d6d269c7a493d53ee",
      "hex"
    );
    await mintDeed(
      happyTeam,
      happyHoldings,
      happyDeed,
      memoHash,
      registrar.publicKey,
      true
    );

    let deed = await program.account.deed.fetch(happyDeed);
    const code = Buffer.from(deed.deedCode).toString("ascii");
    expect(code).to.match(/^[1-9A-HJ-NP-Za-km-z]{8}$/);
    expect(deed.team).to.equal(happyTeam);
    expect(deed.presented).to.equal(false);

    await expectAnchorError(
      program.methods
        .presentDeed(happyTeam, "wrong123")
        .accountsPartial({
          authority,
          config,
          deed: happyDeed,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc(),
      "CodeMismatch"
    );

    await program.methods
      .presentDeed(happyTeam, code)
      .accountsPartial({
        authority,
        config,
        deed: happyDeed,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
    deed = await program.account.deed.fetch(happyDeed);
    expect(deed.presented).to.equal(true);

    await expectAnchorError(
      mintDeed(
        happyTeam,
        happyHoldings,
        happyDeed,
        memoHash,
        registrar.publicKey,
        true
      ),
      "DeedAlreadyPresented"
    );
  });

  it("rejects a deed older than an authority-adjusted zero-slot window", async () => {
    await program.methods
      .setDeedWindow(new anchor.BN(0))
      .accountsPartial({ authority, config })
      .rpc();

    try {
      const memoHash = Buffer.alloc(32, 0x42);
      await mintDeed(
        staleTeam,
        staleHoldings,
        staleDeed,
        memoHash,
        registrar.publicKey,
        true
      );
      const deed = await program.account.deed.fetch(staleDeed);
      const issuedSlot = deed.issuedSlot.toNumber();
      await waitForLaterSlot(issuedSlot);
      const code = Buffer.from(deed.deedCode).toString("ascii");

      await expectAnchorError(
        program.methods
          .presentDeed(staleTeam, code)
          .accountsPartial({
            authority,
            config,
            deed: staleDeed,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .rpc(),
        "DeedStale"
      );
    } finally {
      await program.methods
        .setDeedWindow(DEED_WINDOW)
        .accountsPartial({ authority, config })
        .rpc();
    }
  });

  function mintDeed(
    teamName: string,
    holdings: PublicKey,
    deed: PublicKey,
    memoHash: Buffer,
    registrarAccount: PublicKey,
    includeMemo: boolean
  ): Promise<string> {
    const builder = program.methods
      .mintDeed(teamName, [...memoHash])
      .accountsPartial({
        payer: authority,
        holdings,
        deed,
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
