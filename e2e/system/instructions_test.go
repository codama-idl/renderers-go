package main

import (
	"bytes"
	"testing"

	ag_solanago "github.com/gagliardetto/solana-go"

	system "github.com/codama-idl/renderers-go/system/generated"
)

// The System program uses a little-endian u32 instruction index.
func TestU32DiscriminatorRoundTrip(t *testing.T) {
	t.Parallel()
	payer := ag_solanago.NewWallet().PublicKey()
	target := ag_solanago.NewWallet().PublicKey()

	cases := []struct {
		name       string
		ix         *system.Instruction
		wantPrefix []byte
		check      func(t *testing.T, impl interface{})
	}{
		{
			name: "createAccount",
			ix: system.NewCreateAccountInstructionBuilder().
				SetLamports(42).
				SetSpace(100).
				SetProgramAddress(ag_solanago.TokenProgramID).
				SetPayerAccount(payer).
				SetNewAccountAccount(target).
				Build(),
			wantPrefix: []byte{0, 0, 0, 0},
			check: func(t *testing.T, impl interface{}) {
				got, ok := impl.(*system.CreateAccount)
				if !ok {
					t.Fatalf("decoded %T, want *system.CreateAccount", impl)
				}
				if got.Lamports != 42 || got.Space != 100 || got.ProgramAddress != ag_solanago.TokenProgramID {
					t.Fatalf("args differ: %+v", got)
				}
			},
		},
		{
			name: "transferSol",
			ix: system.NewTransferSolInstructionBuilder().
				SetAmount(7).
				SetSourceAccount(payer).
				SetDestinationAccount(target).
				Build(),
			wantPrefix: []byte{2, 0, 0, 0},
			check: func(t *testing.T, impl interface{}) {
				got, ok := impl.(*system.TransferSol)
				if !ok {
					t.Fatalf("decoded %T, want *system.TransferSol", impl)
				}
				if got.Amount != 7 {
					t.Fatalf("amount: got %d, want 7", got.Amount)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			data, err := tc.ix.Data()
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.HasPrefix(data, tc.wantPrefix) {
				t.Fatalf("data % x does not start with % x", data, tc.wantPrefix)
			}
			decoded, err := system.DecodeInstruction(tc.ix.Accounts(), data)
			if err != nil {
				t.Fatalf("DecodeInstruction: %v", err)
			}
			tc.check(t, decoded.Impl)
			if len(decoded.Accounts()) != 2 {
				t.Fatalf("accounts: got %d, want 2", len(decoded.Accounts()))
			}
		})
	}
}
