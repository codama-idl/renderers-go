package main

import (
	"bytes"
	"testing"

	ag_binary "github.com/gagliardetto/binary"
	ag_solanago "github.com/gagliardetto/solana-go"

	jupiter "github.com/codama-idl/renderers-go/jupiter/generated"
)

// A route with every required account set and both optional accounts
// (destinationTokenAccount, platformFeeAccount) left unset.
func newRoute(t *testing.T) *jupiter.Route {
	t.Helper()
	step := jupiter.RoutePlanStep{Percent: 100, InputIndex: 0, OutputIndex: 1}
	step.Swap.Enum = jupiter.Swap_Crema
	step.Swap.Crema.AToB = true

	route := jupiter.NewRouteInstructionBuilder().
		SetRoutePlan([]jupiter.RoutePlanStep{step}).
		SetInAmount(1_000_000).
		SetQuotedOutAmount(990_000).
		SetSlippageBps(50).
		SetPlatformFeeBps(0).
		SetTokenProgramAccount(ag_solanago.TokenProgramID).
		SetUserTransferAuthorityAccount(ag_solanago.NewWallet().PublicKey()).
		SetUserSourceTokenAccountAccount(ag_solanago.NewWallet().PublicKey()).
		SetUserDestinationTokenAccountAccount(ag_solanago.NewWallet().PublicKey()).
		SetDestinationMintAccount(ag_solanago.NewWallet().PublicKey()).
		SetEventAuthorityAccount(ag_solanago.NewWallet().PublicKey()).
		SetProgramAccount(jupiter.ProgramID)
	if err := route.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	return route
}

func TestOptionalAccountsArePassedAsProgramID(t *testing.T) {
	t.Parallel()
	route := newRoute(t)

	// Builder state stays honest: unset optional accounts read back as nil.
	if route.GetDestinationTokenAccountAccount() != nil || route.GetPlatformFeeAccountAccount() != nil {
		t.Fatal("unset optional accounts must be nil on the builder")
	}

	accounts := route.Build().Accounts()
	if len(accounts) != 9 {
		t.Fatalf("got %d accounts, want 9", len(accounts))
	}
	for i, meta := range accounts {
		if meta == nil {
			t.Fatalf("account %d is nil", i)
		}
	}
	for _, i := range []int{4, 6} {
		if accounts[i].PublicKey != jupiter.ProgramID {
			t.Errorf("optional account %d: got %s, want program id placeholder", i, accounts[i].PublicKey)
		}
	}

	// Remaining accounts appended by the caller survive.
	extra := ag_solanago.NewWallet().PublicKey()
	route.Append(ag_solanago.Meta(extra))
	accounts = route.Build().Accounts()
	if len(accounts) != 10 || accounts[9].PublicKey != extra {
		t.Fatalf("remaining account was not preserved: %v", accounts)
	}
}

func TestRouteDataStartsWithAnchorDiscriminator(t *testing.T) {
	t.Parallel()
	ix := newRoute(t).Build()

	data, err := ix.Data()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(data, jupiter.RouteDiscriminator) {
		t.Fatalf("data does not start with the route discriminator: % x", data[:min(len(data), 9)])
	}
	if want := ag_binary.Sighash(ag_binary.SIGHASH_GLOBAL_NAMESPACE, "route"); !bytes.Equal(jupiter.RouteDiscriminator, want) {
		t.Fatalf("RouteDiscriminator % x != sighash(global:route) % x", jupiter.RouteDiscriminator, want)
	}
	if ix.TypeID != ag_binary.TypeIDFromBytes(jupiter.RouteDiscriminator) {
		t.Fatalf("TypeID not set from the discriminator: %v", ix.TypeID)
	}
}

func TestRouteRoundTrip(t *testing.T) {
	t.Parallel()
	route := newRoute(t)
	ix := route.Build()
	data, err := ix.Data()
	if err != nil {
		t.Fatal(err)
	}

	decoded, err := jupiter.DecodeInstruction(ix.Accounts(), data)
	if err != nil {
		t.Fatalf("DecodeInstruction: %v", err)
	}
	got, ok := decoded.Impl.(*jupiter.Route)
	if !ok {
		t.Fatalf("decoded %T, want *jupiter.Route", decoded.Impl)
	}
	if got.InAmount != route.InAmount || got.QuotedOutAmount != route.QuotedOutAmount ||
		got.SlippageBps != route.SlippageBps || got.PlatformFeeBps != route.PlatformFeeBps {
		t.Fatalf("args differ: got %+v, want %+v", got, route)
	}
	if len(got.RoutePlan) != 1 || got.RoutePlan[0].Swap.Enum != jupiter.Swap_Crema || !got.RoutePlan[0].Swap.Crema.AToB {
		t.Fatalf("route plan differs: %+v", got.RoutePlan)
	}
	if decoded.TypeID != ix.TypeID {
		t.Fatalf("TypeID: got %v, want %v", decoded.TypeID, ix.TypeID)
	}
	if len(decoded.Accounts()) != 9 {
		t.Fatalf("decoded accounts: got %d, want 9", len(decoded.Accounts()))
	}
}

func TestDecodeRejectsUnknownOrTruncatedData(t *testing.T) {
	t.Parallel()
	ix := newRoute(t).Build()
	data, err := ix.Data()
	if err != nil {
		t.Fatal(err)
	}

	corrupted := append([]byte(nil), data...)
	corrupted[0] ^= 0xff
	if _, err := jupiter.DecodeInstruction(ix.Accounts(), corrupted); err == nil {
		t.Error("corrupted discriminator must not decode")
	}
	if _, err := jupiter.DecodeInstruction(ix.Accounts(), nil); err == nil {
		t.Error("empty data must not decode")
	}
	if _, err := jupiter.DecodeInstruction(ix.Accounts(), data[:8]); err == nil {
		t.Error("truncated data must not decode")
	}
}

// Decoding needs every account up to the last required one; fewer must fail
// instead of producing an instruction with missing slots.
func TestDecodeRequiresTheRequiredAccounts(t *testing.T) {
	t.Parallel()
	ix := newRoute(t).Build()
	data, err := ix.Data()
	if err != nil {
		t.Fatal(err)
	}
	accounts := ix.Accounts()
	if _, err := jupiter.DecodeInstruction(accounts[:9], data); err != nil {
		t.Fatalf("full account list: %v", err)
	}
	if _, err := jupiter.DecodeInstruction(accounts[:3], data); err == nil {
		t.Fatal("missing required accounts must fail")
	}
}

func TestNewTransactionWithUnsetOptionalAccounts(t *testing.T) {
	t.Parallel()
	route := newRoute(t)
	payer := route.GetUserTransferAuthorityAccount().PublicKey

	tx, err := ag_solanago.NewTransaction(
		[]ag_solanago.Instruction{route.Build()},
		ag_solanago.Hash{},
		ag_solanago.TransactionPayer(payer),
	)
	if err != nil {
		t.Fatalf("NewTransaction: %v", err)
	}
	if len(tx.Message.Instructions) != 1 || len(tx.Message.Instructions[0].Accounts) != 9 {
		t.Fatalf("unexpected compiled message: %+v", tx.Message.Instructions)
	}
}

// The decoder is registered with solana-go at package init, without SetProgramID.
func TestDecoderRegisteredAtInit(t *testing.T) {
	t.Parallel()
	ix := newRoute(t).Build()
	data, err := ix.Data()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := ag_solanago.DecodeInstruction(jupiter.ProgramID, ix.Accounts(), data)
	if err != nil {
		t.Fatalf("registry decode: %v", err)
	}
	if _, ok := decoded.(*jupiter.Instruction); !ok {
		t.Fatalf("registry returned %T, want *jupiter.Instruction", decoded)
	}
}

func TestSwapEnumRoundTrip(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		value jupiter.Swap
		want  []byte
	}{
		{name: "empty variant", value: jupiter.Swap{Enum: jupiter.Swap_Saber}, want: []byte{byte(jupiter.Swap_Saber)}},
		{name: "data variant", value: func() jupiter.Swap {
			s := jupiter.Swap{Enum: jupiter.Swap_Crema}
			s.Crema.AToB = true
			return s
		}(), want: []byte{byte(jupiter.Swap_Crema), 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			buf := new(bytes.Buffer)
			if err := ag_binary.NewBorshEncoder(buf).Encode(tc.value); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(buf.Bytes(), tc.want) {
				t.Fatalf("encoded % x, want % x", buf.Bytes(), tc.want)
			}
			var decoded jupiter.Swap
			if err := ag_binary.NewBorshDecoder(buf.Bytes()).Decode(&decoded); err != nil {
				t.Fatal(err)
			}
			if decoded.Enum != tc.value.Enum || decoded.Crema != tc.value.Crema {
				t.Fatalf("decoded %+v, want %+v", decoded, tc.value)
			}
		})
	}
}
