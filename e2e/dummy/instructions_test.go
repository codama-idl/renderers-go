package main

import (
	"bytes"
	"testing"

	dummy "github.com/codama-idl/renderers-go/dummy/generated"
)

// instruction3 is the only dummy instruction with a discriminator (u32 42).
func TestDiscriminatedInstructionRoundTrip(t *testing.T) {
	t.Parallel()
	ix := dummy.NewInstruction3InstructionBuilder().Build()
	data, err := ix.Data()
	if err != nil {
		t.Fatal(err)
	}
	if want := []byte{42, 0, 0, 0}; !bytes.Equal(data, want) {
		t.Fatalf("data % x, want % x", data, want)
	}
	decoded, err := dummy.DecodeInstruction(nil, data)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := decoded.Impl.(*dummy.Instruction3); !ok {
		t.Fatalf("decoded %T, want *dummy.Instruction3", decoded.Impl)
	}
}

// instruction8 has a constant u8 discriminator (8) that is not an argument;
// instruction9 has a u8 field discriminator (9) after a leading version byte.
func TestConstantAndOffsetDiscriminators(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		ix    *dummy.Instruction
		want  []byte
		check func(t *testing.T, impl interface{})
	}{
		{
			name: "constant",
			ix:   dummy.NewInstruction8InstructionBuilder().SetValue(0x0201).Build(),
			want: []byte{8, 1, 2},
			check: func(t *testing.T, impl interface{}) {
				got, ok := impl.(*dummy.Instruction8)
				if !ok || got.Value != 0x0201 {
					t.Fatalf("decoded %#v, want *Instruction8{Value: 0x0201}", impl)
				}
			},
		},
		{
			name: "offset",
			ix:   dummy.NewInstruction9InstructionBuilder().SetVersion(3).Build(),
			want: []byte{3, 9},
			check: func(t *testing.T, impl interface{}) {
				got, ok := impl.(*dummy.Instruction9)
				if !ok || got.Version != 3 {
					t.Fatalf("decoded %#v, want *Instruction9{Version: 3}", impl)
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
			if !bytes.Equal(data, tc.want) {
				t.Fatalf("data % x, want % x", data, tc.want)
			}
			decoded, err := dummy.DecodeInstruction(nil, data)
			if err != nil {
				t.Fatal(err)
			}
			tc.check(t, decoded.Impl)
		})
	}
}

// instruction7 has a single optional account.
func TestUnsetOptionalAccountIsProgramID(t *testing.T) {
	t.Parallel()
	accounts := dummy.NewInstruction7InstructionBuilder().Build().Accounts()
	if len(accounts) != 1 || accounts[0] == nil || accounts[0].PublicKey != dummy.ProgramID {
		t.Fatalf("got %v, want [Meta(ProgramID)]", accounts)
	}
}
