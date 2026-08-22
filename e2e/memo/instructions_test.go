package main

import (
	"testing"

	memo "github.com/codama-idl/renderers-go/memo/generated"
)

// The memo program has a single instruction and no discriminator, so
// DecodeInstruction decodes it directly.
func TestUndiscriminatedInstructionRoundTrip(t *testing.T) {
	t.Parallel()
	ix := memo.NewAddMemoInstructionBuilder().SetMemo("hello").Build()
	data, err := ix.Data()
	if err != nil {
		t.Fatal(err)
	}
	// The memo is a remainder string: raw bytes, no length prefix.
	if string(data) != "hello" {
		t.Fatalf("data % x, want the raw memo bytes", data)
	}
	decoded, err := memo.DecodeInstruction(nil, data)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := decoded.Impl.(*memo.AddMemo)
	if !ok {
		t.Fatalf("decoded %T, want *memo.AddMemo", decoded.Impl)
	}
	if got.Memo != "hello" {
		t.Fatalf("memo: got %q, want %q", got.Memo, "hello")
	}
	if accounts := decoded.Accounts(); len(accounts) != 0 {
		t.Fatalf("accounts: got %v, want none", accounts)
	}
}
