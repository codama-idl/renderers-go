#!/usr/bin/env bash
set -eux

function test_project() {
    ./e2e/generate.cjs $1
    cd e2e/$1
    go mod tidy
    go build ./...
    go vet ./...
    go test ./...
    cd ../..
}

function test_anchor_project() {
    ./e2e/generate-anchor.cjs $1
    cd e2e/$1
    go build ./...
    go vet ./...
    go test ./...
    cd ../..
}

test_project dummy
test_project system
test_project memo
test_project pump-fun
test_project jupiter
# test_project meteora  # TODO: uncomment after some internal fixes
# test_anchor_project anchor
