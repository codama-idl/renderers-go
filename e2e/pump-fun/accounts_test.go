package main

import (
	"bytes"
	"testing"

	ag_binary "github.com/gagliardetto/binary"
	ag_solanago "github.com/gagliardetto/solana-go"

	pump "github.com/codama-idl/renderers-go/pump/generated"
)

// Accounts always serialize their IDL discriminator and reject data that
// does not start with it.
func TestAccountDiscriminator(t *testing.T) {
	t.Parallel()
	account := pump.BondingCurve{VirtualTokenReserves: 7, Creator: ag_solanago.NewWallet().PublicKey()}

	buf := new(bytes.Buffer)
	if err := ag_binary.NewBorshEncoder(buf).Encode(&account); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()
	if !bytes.HasPrefix(data, pump.BondingCurveDiscriminator) {
		t.Fatalf("data % x does not start with the discriminator", data[:8])
	}
	if want := ag_binary.Sighash(ag_binary.SIGHASH_ACCOUNT_NAMESPACE, "BondingCurve"); !bytes.Equal(pump.BondingCurveDiscriminator, want) {
		t.Fatalf("discriminator % x != sighash(account:BondingCurve) % x", pump.BondingCurveDiscriminator, want)
	}

	var decoded pump.BondingCurve
	if err := ag_binary.NewBorshDecoder(data).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.VirtualTokenReserves != 7 || decoded.Creator != account.Creator {
		t.Fatalf("decoded %+v, want %+v", decoded, account)
	}
	if !bytes.Equal(decoded.Discriminator[:], pump.BondingCurveDiscriminator) {
		t.Fatalf("discriminator field not populated: % x", decoded.Discriminator)
	}

	corrupted := append([]byte(nil), data...)
	corrupted[0] ^= 0xff
	if err := ag_binary.NewBorshDecoder(corrupted).Decode(&decoded); err == nil {
		t.Fatal("a wrong discriminator must not decode")
	}
}
