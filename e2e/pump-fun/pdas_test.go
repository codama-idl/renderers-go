package main

import (
	"testing"

	ag_solanago "github.com/gagliardetto/solana-go"

	pump "github.com/codama-idl/renderers-go/pump-fun/generated"
)

// The canonical pump.fun global config account, verifiable on any explorer.
func TestFindGlobalPDAKnownAddress(t *testing.T) {
	t.Parallel()
	global, _, err := pump.FindGlobalPDA()
	if err != nil {
		t.Fatal(err)
	}
	if want := "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"; global.String() != want {
		t.Errorf("global PDA: got %s, want %s", global, want)
	}
}

// Generated helpers must agree with raw FindProgramAddress on the same seeds.
func TestPdaSelfConsistency(t *testing.T) {
	t.Parallel()

	mint := ag_solanago.MustPublicKeyFromBase58("So11111111111111111111111111111111111111112")
	user := ag_solanago.NewWallet().PublicKey()
	feeProgram := ag_solanago.MustPublicKeyFromBase58("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ")
	bondingCurve, _, err := pump.FindBondingCurvePDA(mint)
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name      string
		got       func() (ag_solanago.PublicKey, uint8, error)
		wantSeeds [][]byte
		wantProg  ag_solanago.PublicKey
	}{
		{
			name:      "bondingCurve",
			got:       func() (ag_solanago.PublicKey, uint8, error) { return pump.FindBondingCurvePDA(mint) },
			wantSeeds: [][]byte{[]byte("bonding-curve"), mint[:]},
			wantProg:  pump.ProgramID,
		},
		{
			name:      "userVolumeAccumulator",
			got:       func() (ag_solanago.PublicKey, uint8, error) { return pump.FindUserVolumeAccumulatorPDA(user) },
			wantSeeds: [][]byte{[]byte("user_volume_accumulator"), user[:]},
			wantProg:  pump.ProgramID,
		},
		{
			// feeConfig lives under the fee program and its second seed is
			// the pump program id bytes.
			name:      "feeConfig",
			got:       pump.FindFeeConfigPDA,
			wantSeeds: [][]byte{[]byte("fee_config"), pump.ProgramID[:]},
			wantProg:  feeProgram,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, gotBump, err := tc.got()
			if err != nil {
				t.Fatal(err)
			}
			want, wantBump, err := ag_solanago.FindProgramAddress(tc.wantSeeds, tc.wantProg)
			if err != nil {
				t.Fatal(err)
			}
			if got != want || gotBump != wantBump {
				t.Errorf("got %s/%d, want %s/%d", got, gotBump, want, wantBump)
			}
		})
	}

	// The canonical [wallet, tokenProgram, mint] ATA shape must agree with
	// solana-go's built-in derivation.
	t.Run("associatedBondingCurve", func(t *testing.T) {
		t.Parallel()
		got, _, err := pump.FindAssociatedBondingCurvePDA(bondingCurve, ag_solanago.TokenProgramID, mint)
		if err != nil {
			t.Fatal(err)
		}
		want, _, err := ag_solanago.FindAssociatedTokenAddress(bondingCurve, mint)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("got %s, want %s", got, want)
		}
	})
}

// Duplicate seed names become numbered parameters bound independently; the
// same value passed twice must match the raw double-seed derivation.
func TestDuplicateSeedParams(t *testing.T) {
	t.Parallel()
	bc := ag_solanago.NewWallet().PublicKey()
	mint := ag_solanago.NewWallet().PublicKey()
	ataProgram := ag_solanago.MustPublicKeyFromBase58("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

	got, _, err := pump.FindAssociatedBondingCurve3PDA(bc, mint, mint)
	if err != nil {
		t.Fatal(err)
	}
	want, _, err := ag_solanago.FindProgramAddress([][]byte{bc[:], mint[:], mint[:]}, ataProgram)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("associatedBondingCurve3: got %s, want %s", got, want)
	}
}
