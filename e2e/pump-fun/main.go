package main

import (
	"context"
	"fmt"
	"log"

	ag_binary "github.com/gagliardetto/binary"
	ag_solanago "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"

	"github.com/codama-idl/renderers-go/pump/generated"
)

func main() {
	client := rpc.New(rpc.MainNetBeta_RPC)

	pubkey := ag_solanago.MustPublicKeyFromBase58("DRghbpfmG174sfnoHVbnzUhNdjpE3Ki52TJ2osfimmGj")

	resp, err := client.GetAccountInfo(context.Background(), pubkey)
	if err != nil {
		log.Fatalf("Failed to get account info: %v", err)
	}

	var bc pump.BondingCurve
	decoder := ag_binary.NewBorshDecoder(resp.Value.Data.GetBinary())
	if err := bc.UnmarshalWithDecoder(decoder); err != nil {
		log.Fatalf("Failed to decode bonding curve: %v", err)
	}

	fmt.Printf("Bonding Curve:\n")
	fmt.Printf("  VirtualTokenReserves: %d\n", bc.VirtualTokenReserves)
	fmt.Printf("  VirtualSolReserves:   %d\n", bc.VirtualSolReserves)
	fmt.Printf("  RealTokenReserves:    %d\n", bc.RealTokenReserves)
	fmt.Printf("  RealSolReserves:      %d\n", bc.RealSolReserves)
	fmt.Printf("  TokenTotalSupply:     %d\n", bc.TokenTotalSupply)
	fmt.Printf("  Complete:             %v\n", bc.Complete)
	fmt.Printf("  Creator:              %s\n", bc.Creator)
	fmt.Printf("  IsMayhemMode:         %v\n", bc.IsMayhemMode)
}
